const GITHUB_API_BASE = 'https://api.github.com';

const DEFAULT_CONFIG = {
  excludedRepos:       [],
  commentAuthorFilter: [],
  extraction: {
    versionRegex:    '\\d{12}-(?:PR\\d+-[a-f0-9]+|\\d+)',
    profileRegex:    'Profile\\s*:\\s*(\\S+)',
    defaultProfile:  'default',
    skippedProfiles: ['sdk'],
  },
  buildButton: {
    label:          '🔨 Build',
    color:          '#c95f0a',
    hiddenOnStates: ['merged', 'closed'],
    action: { type: 'comment', comment: '/deploy {branchName}' },
  },
  deployButtons: [
    {
      label: 'Deploy to Release',
      color: '#1f883d',
      workflows: [
        { if: 'version:contains:PR', file: 'deploy_to_release_hotfix.yaml' },
        { file: 'deploy_to_release.yaml' },
      ],
      inputs: {
        build_version:       '{version}',
        additional_comments: '{prTitle}',
        build_profile:       '{profile}',
      },
    },
    {
      label: 'Deploy to Prod',
      color: '#0969da',
      workflows: [{ file: 'deploy_to_prod.yaml' }],
      inputs: {
        build_version:       '{version}',
        additional_comments: '{prTitle}',
        build_profile:       '{profile}',
      },
    },
  ],
};

// ── Storage ──────────────────────────────────────────────────────────────────

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
    'Authorization':       `Bearer ${token}`,
    'Accept':              'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type':        'application/json',
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

// Supported condition syntax: "version:contains:VALUE" | "version:notContains:VALUE"
// Unknown conditions default to true (fail-open) so unrecognised rules never silently skip.
function evaluateCondition(condition, version) {
  if (!condition) return true;
  const [subject, op, ...rest] = condition.split(':');
  const value = rest.join(':');
  if (subject === 'version') {
    if (op === 'contains')    return version.includes(value);
    if (op === 'notContains') return !version.includes(value);
  }
  return true;
}

function selectWorkflow(version, buttonConfig) {
  for (const rule of buttonConfig.workflows) {
    if (evaluateCondition(rule.if, version)) return rule.file;
  }
  return buttonConfig.workflows.at(-1)?.file ?? '';
}

// ── Version Extraction ────────────────────────────────────────────────────────

function extractBuilds(commentBody, extraction) {
  let versionRe;
  try   { versionRe = new RegExp(extraction.versionRegex); }
  catch { return []; }

  let profileRe = null;
  try   { if (extraction.profileRegex) profileRe = new RegExp(extraction.profileRegex); }
  catch { /* ignore invalid profile regex */ }

  const skipped        = new Set(extraction.skippedProfiles ?? []);
  const defaultProfile = extraction.defaultProfile ?? 'default';
  const builds = [];
  const seen   = new Set();

  for (const line of commentBody.split('\n')) {
    const versionMatch = line.match(versionRe);
    if (!versionMatch) continue;

    const version = versionMatch[0];
    if (seen.has(version)) continue;

    const cleanLine    = line.replace(/<[^>]*>/g, '');
    const profileMatch = profileRe ? cleanLine.match(profileRe) : null;
    const profile      = profileMatch?.[1] ?? defaultProfile;

    if (skipped.has(profile)) continue;

    seen.add(version);
    builds.push({ version, profile });
  }

  return builds;
}

// ── Dispatch Workflows ────────────────────────────────────────────────────────

async function handleTrigger(msg, token, config) {
  const parsed = parseCommentUrl(msg.url);
  if (!parsed) return { success: false, error: 'Not a valid GitHub comment URL.' };

  const { repo, commentId, prNumber } = parsed;
  const buttonConfig = msg.buttonConfig;

  const [commentResult, prResult, repoResult] = await Promise.allSettled([
    githubGet(`/repos/${repo}/issues/comments/${commentId}`, token),
    prNumber ? githubGet(`/repos/${repo}/pulls/${prNumber}`, token) : Promise.resolve(null),
    githubGet(`/repos/${repo}`, token),
  ]);

  if (commentResult.status === 'rejected') {
    return { success: false, error: 'Could not fetch comment. Check token permissions.' };
  }

  const commentBody   = commentResult.value.body ?? '';
  const prTitle       = prResult.status === 'fulfilled' ? prResult.value?.title ?? '' : '';
  const defaultBranch = repoResult.status === 'fulfilled' ? repoResult.value.default_branch : 'master';

  const builds = extractBuilds(commentBody, config.extraction);
  if (builds.length === 0) {
    return { success: false, error: 'No deployable build versions found in this comment.' };
  }

  const failed = [];
  for (const build of builds) {
    const workflow = selectWorkflow(build.version, buttonConfig);
    const ctx      = { version: build.version, profile: build.profile, prTitle };

    const resolvedInputs = {};
    for (const [key, val] of Object.entries(buttonConfig.inputs)) {
      resolvedInputs[key] = resolveTemplate(val, ctx);
    }

    try {
      await githubPost(
        `/repos/${repo}/actions/workflows/${workflow}/dispatches`,
        { ref: defaultBranch, inputs: resolvedInputs },
        token
      );
    } catch {
      failed.push(build.version);
    }

    if (builds.indexOf(build) < builds.length - 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  return failed.length > 0
    ? { success: false, error: `Failed to trigger: ${failed.join(', ')}` }
    : { success: true, count: builds.length };
}

// ── Build Action ──────────────────────────────────────────────────────────────

async function handleBuild(msg, token) {
  const [prResult, repoResult] = await Promise.allSettled([
    githubGet(`/repos/${msg.repo}/pulls/${msg.prNumber}`, token),
    githubGet(`/repos/${msg.repo}`, token),
  ]);

  if (prResult.status === 'rejected') throw prResult.reason;

  const pr            = prResult.value;
  const defaultBranch = repoResult.status === 'fulfilled' ? repoResult.value.default_branch : 'main';
  const ctx           = {
    branchName: pr.head.ref,
    prTitle:    pr.title ?? '',
    prNumber:   msg.prNumber,
    repo:       msg.repo,
  };
  const action = msg.buildAction;

  function resolveObj(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj ?? {})) out[k] = resolveTemplate(String(v), ctx);
    return out;
  }

  if (action.type === 'comment') {
    const comment = await githubPost(
      `/repos/${msg.repo}/issues/${msg.prNumber}/comments`,
      { body: resolveTemplate(action.comment ?? '', ctx) },
      token
    );
    return { success: true, commentUrl: comment.html_url };
  }

  if (action.type === 'workflow') {
    await githubPost(
      `/repos/${msg.repo}/actions/workflows/${action.file}/dispatches`,
      { ref: defaultBranch, inputs: resolveObj(action.inputs) },
      token
    );
    return { success: true };
  }

  if (action.type === 'repositoryDispatch') {
    await githubPost(
      `/repos/${msg.repo}/dispatches`,
      { event_type: resolveTemplate(action.eventType ?? '', ctx), client_payload: resolveObj(action.payload) },
      token
    );
    return { success: true };
  }

  if (action.type === 'deployment') {
    await githubPost(
      `/repos/${msg.repo}/deployments`,
      {
        ref:               ctx.branchName,
        environment:       resolveTemplate(action.environment ?? 'production', ctx),
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
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html') + '?reason=no-token' });
    return;
  }
  if (msg.type !== 'trigger' && msg.type !== 'build') return;

  (async () => {
    const { token, config } = await getStoredData();
    if (!token) {
      sendResponse({ success: false, error: 'No GitHub token configured. Open extension options to add one.' });
      return;
    }

    try {
      const result = msg.type === 'build'
        ? await handleBuild(msg, token)
        : await handleTrigger(msg, token, config);
      sendResponse(result);
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true;
});
