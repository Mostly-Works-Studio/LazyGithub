importScripts('config-defaults.js');

const GITHUB_API_BASE = 'https://api.github.com';

function getStoredData() {
  return new Promise(resolve =>
    chrome.storage.sync.get(['githubToken', 'extensionConfig'], data => {
      resolve({
        token:  data.githubToken     ?? null,
        config: data.extensionConfig ?? DEFAULT_CONFIG,
      });
    })
  );
}

// ── GitHub API ────────────────────────────────────────────────────────────────

function buildHeaders(token) {
  return {
    'Authorization':        `Bearer ${token}`,
    'Accept':               'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type':         'application/json',
  };
}

async function githubRequest(path, token, options = {}) {
  const res = await fetch(`${GITHUB_API_BASE}${path}`, {
    headers: buildHeaders(token),
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub API ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

const githubGet  = (path, token)       => githubRequest(path, token);
const githubPost = (path, body, token) => githubRequest(path, token, {
  method: 'POST',
  body:   JSON.stringify(body),
});

// ── Workflow YAML Input Schema ────────────────────────────────────────────────

// Minimal state-machine parser for the on.workflow_dispatch.inputs block.
// Returns [{name, description, required, default, type}] or [] if not found.
function parseWorkflowDispatchInputs(yaml) {
  const lines = yaml.split(/\r?\n/);
  const result = [];

  let state = 'root';
  const d = {};
  let cur = null;

  for (const raw of lines) {
    const trimmed = raw.trimStart();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('- ')) continue;
    const indent = raw.length - trimmed.length;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const val = trimmed.slice(colonIdx + 1).trim().replace(/^['"]|['"]$/g, '').trim();

    switch (state) {
      case 'root':
        if (key === 'on') { state = 'on'; d.on = indent; }
        break;
      case 'on':
        if (indent <= d.on) { state = 'root'; if (key === 'on') { state = 'on'; d.on = indent; } break; }
        if (key === 'workflow_dispatch') { state = 'wfd'; d.wfd = indent; }
        break;
      case 'wfd':
        if (indent <= d.wfd) { state = 'on'; break; }
        if (key === 'inputs') { state = 'inputs'; d.inputs = indent; d.inputName = -1; }
        break;
      case 'inputs':
        if (indent <= d.inputs) {
          if (cur) { result.push({ ...cur }); cur = null; }
          state = 'wfd';
          break;
        }
        if (d.inputName === -1) d.inputName = indent;
        if (indent === d.inputName) {
          if (cur) result.push({ ...cur });
          cur = { name: key, description: key, required: false, default: '', type: 'string' };
        } else if (cur && indent > d.inputName) {
          if (key === 'description') cur.description = val || key;
          else if (key === 'required') cur.required = val === 'true';
          else if (key === 'default') cur.default = val;
          else if (key === 'type') cur.type = val;
        }
        break;
    }
  }
  if (cur) result.push({ ...cur });
  return result;
}

async function fetchWorkflowInputs(repo, workflowFile, token) {
  const filename = workflowFile.replace(/^.*\.github\/workflows\//, '');
  const res = await githubGet(`/repos/${repo}/contents/.github/workflows/${encodeURIComponent(filename)}`, token);
  if (!res?.content) return [];
  const yaml = atob(res.content.replace(/[\r\n\s]/g, ''));
  return parseWorkflowDispatchInputs(yaml);
}

// ── URL Parsing ───────────────────────────────────────────────────────────────

function parseCommentUrl(url) {
  const repoMatch    = url.match(/github\.com\/([^/]+\/[^/]+)/);
  const commentMatch = url.match(/issuecomment-(\d+)/);
  const prMatch      = url.match(/\/pull\/(\d+)/);
  if (!repoMatch || !commentMatch) return null;
  return {
    repo:      repoMatch[1],
    commentId: commentMatch[1],
    prNumber:  prMatch?.[1] ?? null,
  };
}

// ── Config Helpers ────────────────────────────────────────────────────────────

function resolveTemplate(template, ctx) {
  return String(template).replace(/\{(\w+)\}/g, (_, key) => ctx[key] ?? '');
}

// Condition syntax: "tokenName:contains:VALUE" | "tokenName:notContains:VALUE"
// Unknown conditions fail-open so unrecognised rules never silently skip.
function evaluateCondition(condition, ctx) {
  if (!condition) return true;
  const [subject, op, ...rest] = condition.split(':');
  const value        = rest.join(':');
  const subjectValue = String(ctx[subject] ?? '');
  if (op === 'contains')    return subjectValue.includes(value);
  if (op === 'notContains') return !subjectValue.includes(value);
  return true;
}

// Resolves a value that is either a plain string or a conditional rules array.
// Each rule is { if?: "tokenName:op:VALUE", value: "string" }; first matching
// rule wins. Also accepts old {file} key per rule for graceful migration.
function resolveConditional(value, ctx) {
  if (!Array.isArray(value)) return resolveTemplate(String(value ?? ''), ctx);
  for (const rule of value) {
    if (evaluateCondition(rule.if, ctx)) return resolveTemplate(rule.value ?? rule.file ?? '', ctx);
  }
  return '';
}

// ── Generic Token Extraction ──────────────────────────────────────────────────

function getSourceValue(source, prCtx) {
  switch (source) {
    case 'commentBody':   return prCtx.commentBody   ?? '';
    case 'commentAuthor': return prCtx.commentAuthor ?? '';
    case 'prTitle':       return prCtx.prTitle       ?? '';
    case 'prBranch':      return prCtx.branchName    ?? '';
    case 'prNumber':      return String(prCtx.prNumber ?? '');
    case 'prAuthor':      return prCtx.prAuthor      ?? '';
    case 'repo':          return prCtx.repo          ?? '';
    default:              return '';
  }
}

// Extracts token rows from the execution context.
//
// For commentBody tokens: scans the comment line by line. A line becomes a
// candidate row when at least one commentBody token's regex matches it.
// Tokens that don't match on a given line walk their ordered fallback list
// (see normalizeFallbacks/resolveTokenValue) — a literal value, an alternate
// pattern retried against the same line, or an "ask user" prompt.
// Scalar-source tokens are resolved once and shared across all rows.
//
// Returns { rows, pending }. `rows` is an array of token-value objects (one
// per matched row, or one for scalar-only cases). `pending` is an array of
// { id, label, context } prompts for any "ask user" fallback that has no
// answer yet in resolvedInputs — callers should surface these to the user
// and re-invoke with resolvedInputs filled in before trusting `rows`.
function applyReplaceSteps(value, replace) {
  if (!replace) return value;
  const steps = Array.isArray(replace) ? replace : [replace];
  return steps.reduce((v, r) => {
    try { return v.replace(new RegExp(r.pattern, r.flags ?? 'g'), r.with ?? ''); }
    catch { return v; }
  }, value);
}

// Normalizes a token's fallback chain to FallbackRule[]. Accepts the new
// `fallbacks` array, or falls back to reading the legacy `default` string
// as a single literal-value rule (graceful migration, same approach as
// resolveConditional's old {file} key).
function normalizeFallbacks(token) {
  if (Array.isArray(token.fallbacks)) return token.fallbacks;
  if (token.default) return [{ type: 'value', value: token.default }];
  return [];
}

// Resolves a single token's value against sourceText, walking its fallback
// chain on a miss. Returns one of:
//   { value, matched: true }   — token.regex (or raw source) matched directly
//   { value, matched: false }  — resolved via a value/pattern/input fallback
//   { pending: { id, label, context } } — an "ask user" fallback with no answer yet
//   { skip: true }             — nothing resolved; caller should drop this row
function resolveTokenValue(token, sourceText, resolvedInputs, promptIdPrefix) {
  if (token.regex) {
    try {
      const m = sourceText.match(new RegExp(token.regex));
      if (m !== null) return { value: m[1] ?? m[0], matched: true };
    } catch { /* fall through to fallbacks */ }
  } else if (sourceText) {
    return { value: sourceText, matched: true };
  }

  for (const fb of normalizeFallbacks(token)) {
    if (fb.type === 'value') {
      if (fb.value) return { value: fb.value, matched: false };
    } else if (fb.type === 'pattern') {
      try {
        const m = sourceText.match(new RegExp(fb.regex));
        if (m !== null) return { value: m[1] ?? m[0], matched: false };
      } catch { /* try next fallback */ }
    } else if (fb.type === 'input') {
      const id = `${promptIdPrefix}:${token.name}`;
      if (Object.prototype.hasOwnProperty.call(resolvedInputs, id)) {
        return { value: resolvedInputs[id], matched: false };
      }
      return { pending: { id, label: fb.label || token.name, context: sourceText } };
    }
  }

  return { skip: true };
}

function extractRows(tokens, prCtx, resolvedInputs = {}) {
  const commentBodyTokens = tokens.filter(t => t.source === 'commentBody');
  const scalarTokens      = tokens.filter(t => t.source !== 'commentBody');

  const pending = [];

  // Resolve scalar tokens once
  const scalarValues = {};
  let scalarSkip = false;
  for (const token of scalarTokens) {
    const raw = getSourceValue(token.source, prCtx);
    const resolved = resolveTokenValue(token, raw, resolvedInputs, 'scalar');
    if (resolved.pending) { pending.push(resolved.pending); continue; }
    if (resolved.skip) { scalarSkip = true; continue; }
    scalarValues[token.name] = applyReplaceSteps(resolved.value, token.replace);
  }

  // No commentBody tokens → single row from scalar values only
  if (commentBodyTokens.length === 0) {
    if (pending.length > 0) return { rows: [], pending };
    return { rows: scalarSkip ? [] : [scalarValues], pending: [] };
  }

  // Line-by-line scan: a line becomes a row when at least one token regex
  // matches directly. Tokens that miss walk their fallback chain; if that
  // chain hits an unanswered "ask user" rule, the prompt is collected (scan
  // continues so every prompt across the whole comment surfaces in one
  // batch) and the line is retried once resolvedInputs answers arrive.
  // Deduplication is keyed on the full set of extracted values (not a single anchor).
  const rows = [];
  const seen = new Set();

  const commentLines = (prCtx.commentBody ?? '').split('\n');
  for (let lineIndex = 0; lineIndex < commentLines.length; lineIndex++) {
    const cleanLine = commentLines[lineIndex].replace(/<[^>]*>/g, '');
    const row = { ...scalarValues };
    let anyMatched = false;
    let skipRow = false;
    let linePending = false;

    for (const token of commentBodyTokens) {
      const resolved = resolveTokenValue(token, cleanLine, resolvedInputs, String(lineIndex));

      if (resolved.pending) {
        pending.push(resolved.pending);
        linePending = true;
        continue;
      }
      if (resolved.skip) { skipRow = true; break; }
      if (resolved.matched) anyMatched = true;

      const value = applyReplaceSteps(resolved.value, token.replace);
      if ((token.skip ?? []).includes(value)) { skipRow = true; break; }
      row[token.name] = value;
    }

    if (linePending || scalarSkip || !anyMatched || skipRow) continue;

    const key = commentBodyTokens.map(t => row[t.name]).join('\x00');
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }

  return { rows, pending };
}

// ── Unified Action Executor ───────────────────────────────────────────────────

async function executeAction(action, ctx, repo, defaultBranch, token) {
  // Resolve optional target overrides — all fields are template-able
  const tgtRepo = resolveTemplate(String(action.target?.repo     ?? ''), ctx).trim();
  const tgtRef  = resolveTemplate(String(action.target?.ref      ?? ''), ctx).trim();
  const tgtPr   = resolveTemplate(String(action.target?.prNumber ?? ''), ctx).trim();
  const effectiveRepo = tgtRepo || repo;
  const effectiveRef  = tgtRef  || defaultBranch;
  const effectivePr   = tgtPr   || ctx.prNumber;

  function resolveObj(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj ?? {})) out[k] = resolveTemplate(String(v), ctx);
    return out;
  }

  if (action.type === 'comment') {
    const comment = await githubPost(
      `/repos/${effectiveRepo}/issues/${effectivePr}/comments`,
      { body: resolveConditional(action.comment ?? '', ctx) },
      token
    );
    return { success: true, commentUrl: comment.html_url };
  }

  if (action.type === 'workflow') {
    const file = resolveConditional(action.file ?? '', ctx);
    await githubPost(
      `/repos/${effectiveRepo}/actions/workflows/${file}/dispatches`,
      { ref: effectiveRef, inputs: resolveObj(action.inputs) },
      token
    );
    return { success: true };
  }

  if (action.type === 'repositoryDispatch') {
    await githubPost(
      `/repos/${effectiveRepo}/dispatches`,
      { event_type: resolveConditional(action.eventType ?? '', ctx), client_payload: resolveObj(action.payload) },
      token
    );
    return { success: true };
  }

  if (action.type === 'deployment') {
    await githubPost(
      `/repos/${effectiveRepo}/deployments`,
      {
        ref:               tgtRef || ctx.branchName,
        environment:       resolveConditional(action.environment ?? 'production', ctx),
        payload:           resolveObj(action.payload),
        auto_merge:        false,
        required_contexts: [],
      },
      token
    );
    return { success: true };
  }

  throw new Error(`Unknown action type "${action.type}". Use: comment, workflow, repositoryDispatch, deployment.`);
}

// ── Unified Action Handler ────────────────────────────────────────────────────

async function handleAction(msg, token) {
  if (msg.trigger === 'comment') {
    const parsed = parseCommentUrl(msg.url);
    if (!parsed) return { success: false, error: 'Not a valid GitHub comment URL.' };

    const { repo, commentId, prNumber } = parsed;
    const tokens     = msg.tokens     ?? [];
    const onMultiple = msg.onMultiple ?? 'all';

    const [commentResult, prResult, repoResult] = await Promise.allSettled([
      githubGet(`/repos/${repo}/issues/comments/${commentId}`, token),
      prNumber ? githubGet(`/repos/${repo}/pulls/${prNumber}`, token) : Promise.resolve(null),
      githubGet(`/repos/${repo}`, token),
    ]);

    if (commentResult.status === 'rejected') {
      return { success: false, error: 'Could not fetch comment. Check token permissions.' };
    }

    const commentBody   = commentResult.value.body         ?? '';
    const commentAuthor = commentResult.value.user?.login  ?? '';
    const pr            = prResult.status === 'fulfilled' ? prResult.value : null;
    const prTitle       = pr?.title         ?? '';
    const branchName    = pr?.head?.ref     ?? '';
    const prAuthor      = pr?.user?.login   ?? '';
    const defaultBranch = repoResult.status === 'fulfilled' ? repoResult.value.default_branch : 'master';

    const prCtx     = { commentBody, commentAuthor, prTitle, branchName, prNumber, prAuthor, repo };
    const { rows, pending } = extractRows(tokens, prCtx, msg.resolvedInputs ?? {});

    if (pending.length > 0) {
      return { needsInput: true, prompts: pending };
    }

    const activeRows = onMultiple === 'first' ? rows.slice(0, 1) : rows;

    if (activeRows.length === 0) {
      return { success: false, error: 'No matching tokens found in this comment.' };
    }

    const failed = [];
    let lastResult = null;
    for (let i = 0; i < activeRows.length; i++) {
      const ctx = { ...prCtx, ...activeRows[i] };
      try {
        lastResult = await executeAction(msg.action, ctx, repo, defaultBranch, token);
      } catch (err) {
        const rowId = tokens[0] ? String(activeRows[i][tokens[0].name] ?? `row ${i + 1}`) : `row ${i + 1}`;
        failed.push(rowId);
      }
      if (i < activeRows.length - 1) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    return failed.length > 0
      ? { success: false, error: `Failed to trigger: ${failed.join(', ')}` }
      : { success: true, count: activeRows.length, ...(lastResult?.commentUrl ? { commentUrl: lastResult.commentUrl } : {}) };

  } else {
    // prHeader trigger
    const [prResult, repoResult] = await Promise.allSettled([
      githubGet(`/repos/${msg.repo}/pulls/${msg.prNumber}`, token),
      githubGet(`/repos/${msg.repo}`, token),
    ]);

    if (prResult.status === 'rejected') throw prResult.reason;

    const pr            = prResult.value;
    const defaultBranch = repoResult.status === 'fulfilled' ? repoResult.value.default_branch : 'main';

    const prCtx = {
      prTitle:       pr.title       ?? '',
      branchName:    pr.head.ref,
      prNumber:      msg.prNumber,
      prAuthor:      pr.user?.login ?? '',
      repo:          msg.repo,
      commentBody:   '',
      commentAuthor: '',
    };

    const { rows, pending } = extractRows(msg.tokens ?? [], prCtx, msg.resolvedInputs ?? {});

    if (pending.length > 0) {
      return { needsInput: true, prompts: pending };
    }

    const tokenValues = rows[0] ?? {};
    const ctx         = { ...prCtx, ...tokenValues };

    return executeAction(msg.action, ctx, msg.repo, defaultBranch, token);
  }
}

// ── Message Router ────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
  }
});


// ── Retry failed checks / jobs ────────────────────────────────────────────────

// Check-run / job conclusions that make sense to re-run. `action_required`,
// `skipped`, `neutral` and in-flight states are deliberately excluded.
const RETRYABLE_CONCLUSIONS = new Set(['failure', 'timed_out', 'cancelled']);

const runIdFromUrl = url => url?.match(/\/actions\/runs\/(\d+)/)?.[1] ?? null;

// Turn "GitHub API 403: {"message":"..."}" into something a toast can show.
function apiErrorMessage(err) {
  const m = String(err?.message ?? err).match(/^GitHub API (\d+): ([\s\S]*)$/);
  if (!m) return String(err?.message ?? err);
  try {
    const parsed = JSON.parse(m[2]);
    if (parsed?.message) return `${parsed.message} (HTTP ${m[1]})`;
  } catch { /* not JSON */ }
  return `HTTP ${m[1]}`;
}

// Failed GitHub Actions check runs on the PR's current head commit. For Actions,
// a check run id *is* the job id, so each entry can be re-run via /actions/jobs/{id}/rerun.
async function fetchFailedChecksForPr(repo, prNumber, token) {
  const pr  = await githubGet(`/repos/${repo}/pulls/${prNumber}`, token);
  const sha = pr.head?.sha;
  if (!sha) return { headSha: null, checks: [] };

  const checks = [];
  for (let page = 1; page <= 3; page++) {
    const res  = await githubGet(`/repos/${repo}/commits/${sha}/check-runs?per_page=100&page=${page}`, token);
    const runs = res.check_runs ?? [];
    for (const cr of runs) {
      if (cr.app?.slug !== 'github-actions') continue;          // external CI can't be re-run from here
      if (!RETRYABLE_CONCLUSIONS.has(cr.conclusion)) continue;
      checks.push({ jobId: String(cr.id), runId: runIdFromUrl(cr.details_url), name: cr.name, conclusion: cr.conclusion });
    }
    if (runs.length < 100) break;
  }

  // The new merge box shows checks as "<workflow name> / <job name> (<event>)" with no link,
  // so content.js matches rows by that text. Attach workflow name + event per run.
  const runIds = [...new Set(checks.map(c => c.runId).filter(Boolean))].slice(0, 10);
  const runInfo = {};
  await Promise.all(runIds.map(async id => {
    try {
      const r = await githubGet(`/repos/${repo}/actions/runs/${id}`, token);
      runInfo[id] = { workflowName: r.name ?? '', event: r.event ?? '' };
    } catch { /* leave unknown; name-only matching still works */ }
  }));
  for (const c of checks) Object.assign(c, runInfo[c.runId] ?? {});

  return { headSha: sha, checks };
}

// Status + conclusion for the given run ids. One list call covers the recent runs
// shown on /actions; anything older (filtered views) is fetched individually, capped.
async function fetchRunStatuses(repo, runIds, token) {
  const wanted   = new Set(runIds.map(String));
  const statuses = {};
  try {
    const list = await githubGet(`/repos/${repo}/actions/runs?per_page=100`, token);
    for (const r of list.workflow_runs ?? []) {
      if (wanted.has(String(r.id))) statuses[r.id] = { status: r.status, conclusion: r.conclusion };
    }
  } catch { /* fall through to individual fetches */ }

  const missing = runIds.map(String).filter(id => !statuses[id]).slice(0, 20);
  await Promise.all(missing.map(async id => {
    try {
      const r = await githubGet(`/repos/${repo}/actions/runs/${id}`, token);
      statuses[id] = { status: r.status, conclusion: r.conclusion };
    } catch { /* leave unknown */ }
  }));
  return statuses;
}

// Read-only lookups and re-run commands used by the retry buttons in content.js.
// Every handler receives the message and a token and returns the response object.
const RETRY_HANDLERS = {
  getFailedChecks: async (msg, token) => ({ success: true, ...(await fetchFailedChecksForPr(msg.repo, msg.prNumber, token)) }),
  getRunStatuses:  async (msg, token) => ({ success: true, statuses: await fetchRunStatuses(msg.repo, msg.runIds ?? [], token) }),
  rerunFailedJobs: async (msg, token) => { await githubPost(`/repos/${msg.repo}/actions/runs/${msg.runId}/rerun-failed-jobs`, {}, token); return { success: true }; },
  rerunRun:        async (msg, token) => { await githubPost(`/repos/${msg.repo}/actions/runs/${msg.runId}/rerun`, {}, token); return { success: true }; },
  rerunJob:        async (msg, token) => { await githubPost(`/repos/${msg.repo}/actions/jobs/${msg.jobId}/rerun`, {}, token); return { success: true }; },  // Re-run several workflow runs at once (the merge box "retry all" button). `mode`
  // 'failed' re-runs only each run's failed jobs; 'all' re-runs every job. Partial
  // failures are reported, not thrown, so one bad run doesn't hide the others.
  rerunRuns: async (msg, token) => {
    const runIds = [...new Set((msg.runIds ?? []).map(String))];
    const errors = [];
    for (const runId of runIds) {
      const path = msg.mode === 'all'
        ? `/repos/${msg.repo}/actions/runs/${runId}/rerun`
        : `/repos/${msg.repo}/actions/runs/${runId}/rerun-failed-jobs`;
      try { await githubPost(path, {}, token); }
      catch (err) { errors.push(`run ${runId}: ${apiErrorMessage(err)}`); }
    }
    if (errors.length === runIds.length && runIds.length) return { success: false, error: errors.join('; ') };
    return { success: true, count: runIds.length - errors.length, errors };
  },
};

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'openOptions') {
    const reason = msg.reason ?? 'no-token';
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html') + `?reason=${encodeURIComponent(reason)}` });
    return;
  }

  if (msg.type === 'getPrBranch') {
    (async () => {
      const { token } = await getStoredData();
      if (!token) { sendResponse(null); return; }
      try {
        const pr = await githubRequest(`/repos/${msg.repo}/pulls/${msg.prNumber}`, token);
        sendResponse({
          repo:      pr.base?.repo?.full_name ?? msg.repo,
          repoUrl:   pr.base?.repo?.html_url  ?? `https://github.com/${msg.repo}`,
          headRef:   pr.head?.ref             ?? '',
          headUrl:   pr.head?.repo?.html_url && pr.head?.ref
                       ? `${pr.head.repo.html_url}/tree/${pr.head.ref}` : '',
          baseRef:   pr.base?.ref             ?? '',
          baseUrl:   pr.base?.repo?.html_url && pr.base?.ref
                       ? `${pr.base.repo.html_url}/tree/${pr.base.ref}` : '',
          author:    pr.user?.login           ?? '',
          authorUrl: pr.user?.login ? `https://github.com/${pr.user.login}` : '',
        });
      } catch {
        sendResponse(null);
      }
    })();
    return true;
  }

  if (msg.type === 'refreshPrBase') {
    (async () => {
      const { token } = await getStoredData();
      if (!token) { sendResponse({ success: false, error: 'No token' }); return; }
      try {
        const pr = await githubRequest(`/repos/${msg.repo}/pulls/${msg.prNumber}`, token);
        const base = pr.base?.ref;
        if (!base) { sendResponse({ success: false, error: 'Could not read base branch' }); return; }
        await githubRequest(`/repos/${msg.repo}/pulls/${msg.prNumber}`, token, {
          method: 'PATCH',
          body: JSON.stringify({ base }),
        });
        sendResponse({ success: true });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }

  if (msg.type === 'getWorkflowInputs') {
    (async () => {
      const { token } = await getStoredData();
      if (!token) { sendResponse({ success: false, inputs: [] }); return; }
      try {
        const inputs = await fetchWorkflowInputs(msg.repo, msg.workflowFile, token);
        sendResponse({ success: true, inputs });
      } catch {
        sendResponse({ success: false, inputs: [] });
      }
    })();
    return true;
  }

  if (RETRY_HANDLERS[msg.type]) {
    (async () => {
      const { token } = await getStoredData();
      if (!token) { sendResponse({ success: false, error: 'No GitHub token configured.' }); return; }
      try {
        sendResponse(await RETRY_HANDLERS[msg.type](msg, token));
      } catch (err) {
        sendResponse({ success: false, error: apiErrorMessage(err) });
      }
    })();
    return true;
  }

  if (msg.type !== 'action') return;

  (async () => {
    const { token } = await getStoredData();
    if (!token) {
      sendResponse({ success: false, error: 'No GitHub token configured. Open extension options to add one.' });
      return;
    }

    try {
      const result = await handleAction(msg, token);
      sendResponse(result);
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true;
});
