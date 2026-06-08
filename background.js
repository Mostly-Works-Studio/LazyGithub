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
// For commentBody tokens: scans the comment line by line. Each line where the
// first commentBody token (anchor) matches is one candidate row. All other
// commentBody tokens are extracted from the same line — they co-vary naturally.
// Scalar-source tokens are resolved once and shared across all rows.
//
// Returns an array of token-value objects (one per matched row, or one for
// scalar-only cases). An empty array means no rows were found.
function extractRows(tokens, prCtx) {
  const commentBodyTokens = tokens.filter(t => t.source === 'commentBody');
  const scalarTokens      = tokens.filter(t => t.source !== 'commentBody');

  // Resolve scalar tokens once
  const scalarValues = {};
  for (const token of scalarTokens) {
    const raw = getSourceValue(token.source, prCtx);
    let value;
    if (token.regex) {
      try {
        const m = raw.match(new RegExp(token.regex));
        value = m?.[1] ?? m?.[0] ?? (token.default ?? '');
      } catch { value = token.default ?? ''; }
    } else {
      value = raw || (token.default ?? '');
    }
    scalarValues[token.name] = value;
  }

  // No commentBody tokens → single row from scalar values only
  if (commentBodyTokens.length === 0) {
    return [scalarValues];
  }

  // Line-by-line scan for commentBody tokens
  const anchorToken = commentBodyTokens[0];
  let anchorRe;
  try { anchorRe = new RegExp(anchorToken.regex); }
  catch { return []; }

  const rows = [];
  const seen = new Set();

  for (const line of (prCtx.commentBody ?? '').split('\n')) {
    const anchorMatch = line.match(anchorRe);
    if (!anchorMatch) continue;

    const anchorValue = anchorMatch[1] ?? anchorMatch[0];
    if (seen.has(anchorValue)) continue;

    const cleanLine = line.replace(/<[^>]*>/g, '');
    const row = { ...scalarValues };
    let skipRow = false;

    for (const token of commentBodyTokens) {
      let value;
      try {
        const m = cleanLine.match(new RegExp(token.regex));
        value = m?.[1] ?? m?.[0] ?? (token.default ?? '');
      } catch { value = token.default ?? ''; }

      if ((token.skip ?? []).includes(value)) { skipRow = true; break; }
      row[token.name] = value;
    }

    if (skipRow) continue;
    seen.add(anchorValue);
    rows.push(row);
  }

  return rows;
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
    const rows      = extractRows(tokens, prCtx);
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

    const rows        = extractRows(msg.tokens ?? [], prCtx);
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

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'openOptions') {
    const reason = msg.reason ?? 'no-token';
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html') + `?reason=${encodeURIComponent(reason)}` });
    return;
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
