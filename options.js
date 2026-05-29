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
  },
  buildComment: '/deploy {branchName}',
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

// ── Open-reason banner ────────────────────────────────────────────────────────

const openReasonBanner = document.getElementById('open-reason-banner');
const openReasonText   = document.getElementById('open-reason-text');

const OPEN_REASON_MESSAGES = {
  'no-token': 'A LazyDeploy button was clicked, but no GitHub token is configured yet. Add your token below to start using the extension.',
};

const reason = new URLSearchParams(location.search).get('reason');
if (reason && OPEN_REASON_MESSAGES[reason]) {
  openReasonText.textContent  = OPEN_REASON_MESSAGES[reason];
  openReasonBanner.hidden     = false;
}

// ── Token ─────────────────────────────────────────────────────────────────────

const tokenBadge         = document.getElementById('token-badge');
const tokenConfiguredBox = document.getElementById('token-configured-box');
const tokenMask          = document.getElementById('token-mask');
const tokenInputSection  = document.getElementById('token-input-section');
const tokenInput         = document.getElementById('token-input');
const saveBtn            = document.getElementById('save-btn');
const updateBtn          = document.getElementById('update-btn');
const clearBtn           = document.getElementById('clear-btn');
const cancelBtn          = document.getElementById('cancel-btn');
const statusMsg          = document.getElementById('status-msg');

function showStatus(message, type) {
  statusMsg.textContent = message;
  statusMsg.className   = `status ${type}`;
  setTimeout(() => { statusMsg.textContent = ''; statusMsg.className = 'status'; }, 4000);
}

let validateTimer = null;

function clearValidationStatus() {
  clearTimeout(validateTimer);
  statusMsg.textContent = '';
  statusMsg.className   = 'status';
}

async function validateToken(token) {
  statusMsg.textContent = '🔍 Validating…';
  statusMsg.className   = 'status';
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization':        `Bearer ${token}`,
        'Accept':               'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (res.ok) {
      const { login } = await res.json();
      statusMsg.textContent = `✓ Authenticated as @${login}`;
      statusMsg.className   = 'status success';
    } else if (res.status === 401) {
      statusMsg.textContent = '✗ Invalid token — check it was copied correctly.';
      statusMsg.className   = 'status error';
    } else if (res.status === 403) {
      statusMsg.textContent = '✗ Token rejected — check it has the required scopes (repo, workflow).';
      statusMsg.className   = 'status error';
    } else {
      statusMsg.textContent = `✗ Validation failed (${res.status}).`;
      statusMsg.className   = 'status error';
    }
  } catch {
    statusMsg.textContent = '✗ Could not reach GitHub — check your connection.';
    statusMsg.className   = 'status error';
  }
}

function showTokenConfigured(token) {
  tokenConfiguredBox.hidden = false;
  tokenInputSection.hidden  = true;
  tokenBadge.hidden         = false;
  tokenMask.textContent     = `••••••••••••${token.slice(-4)}`;
  tokenInput.value          = '';
  cancelBtn.hidden          = true;
}

function showTokenInput(showCancel = false) {
  tokenConfiguredBox.hidden = true;
  tokenInputSection.hidden  = false;
  tokenBadge.hidden         = true;
  cancelBtn.hidden          = !showCancel;
  clearValidationStatus();
  tokenInput.focus();
}

chrome.storage.sync.get('githubToken', ({ githubToken }) => {
  if (githubToken) showTokenConfigured(githubToken);
  else showTokenInput(false);
});

updateBtn.addEventListener('click', () => showTokenInput(true));

cancelBtn.addEventListener('click', () => {
  clearValidationStatus();
  chrome.storage.sync.get('githubToken', ({ githubToken }) => {
    if (githubToken) showTokenConfigured(githubToken);
    else showTokenInput(false);
  });
  tokenInput.value = '';
});

saveBtn.addEventListener('click', () => {
  clearValidationStatus();
  const token = tokenInput.value.trim();
  if (!token) {
    showStatus('Please enter a token.', 'error');
    return;
  }
  if (!token.startsWith('ghp_') && !token.startsWith('github_pat_')) {
    showStatus('Token format looks incorrect — should start with ghp_ or github_pat_.', 'error');
    return;
  }
  if (token.length < 20) {
    showStatus('Token looks too short — make sure you copied it in full.', 'error');
    return;
  }
  chrome.storage.sync.set({ githubToken: token }, () => {
    showTokenConfigured(token);
    showStatus('Token saved successfully.', 'success');
  });
});

clearBtn.addEventListener('click', () => {
  chrome.storage.sync.remove('githubToken', () => {
    showTokenInput(false);
    showStatus('Token removed.', 'success');
  });
});

tokenInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') saveBtn.click();
});

tokenInput.addEventListener('input', () => {
  clearTimeout(validateTimer);
  statusMsg.textContent = '';
  statusMsg.className   = 'status';
  const token = tokenInput.value.trim();
  if (!token) return;
  if ((!token.startsWith('ghp_') && !token.startsWith('github_pat_')) || token.length < 20) return;
  validateTimer = setTimeout(() => validateToken(token), 600);
});

// ── Config ────────────────────────────────────────────────────────────────────

const configInput     = document.getElementById('config-input');
const saveConfigBtn   = document.getElementById('save-config-btn');
const resetConfigBtn  = document.getElementById('reset-config-btn');
const configStatusMsg = document.getElementById('config-status-msg');

function showConfigStatus(message, type) {
  configStatusMsg.textContent = message;
  configStatusMsg.className   = `status ${type}`;
  setTimeout(() => { configStatusMsg.textContent = ''; configStatusMsg.className = 'status'; }, 4000);
}

chrome.storage.sync.get('extensionConfig', ({ extensionConfig }) => {
  configInput.value = JSON.stringify(extensionConfig ?? DEFAULT_CONFIG, null, 2);
});

saveConfigBtn.addEventListener('click', () => {
  let parsed;
  try {
    parsed = JSON.parse(configInput.value);
  } catch (err) {
    showConfigStatus(`Invalid JSON: ${err.message}`, 'error');
    return;
  }

  if (!parsed.buildButton || typeof parsed.buildButton.label !== 'string' || typeof parsed.buildButton.color !== 'string') {
    showConfigStatus('Config must have a "buildButton" object with "label" and "color" strings.', 'error');
    return;
  }
  if (!Array.isArray(parsed.buildButton.hiddenOnStates)) {
    showConfigStatus('Config must have a "buildButton.hiddenOnStates" array (can be empty).', 'error');
    return;
  }
  if (!Array.isArray(parsed.excludedRepos)) {
    showConfigStatus('Config must have an "excludedRepos" array (can be empty).', 'error');
    return;
  }
  if (!Array.isArray(parsed.commentAuthorFilter)) {
    showConfigStatus('Config must have a "commentAuthorFilter" array (can be empty).', 'error');
    return;
  }
  if (!parsed.extraction || typeof parsed.extraction.versionRegex !== 'string') {
    showConfigStatus('Config must have an "extraction" object with a "versionRegex" string.', 'error');
    return;
  }
  if (!Array.isArray(parsed.deployButtons) || parsed.deployButtons.length === 0) {
    showConfigStatus('Config must have a non-empty "deployButtons" array.', 'error');
    return;
  }
  if (typeof parsed.buildComment !== 'string') {
    showConfigStatus('Config must have a "buildComment" string.', 'error');
    return;
  }

  try { new RegExp(parsed.extraction.versionRegex); }
  catch (err) {
    showConfigStatus(`Invalid versionRegex: ${err.message}`, 'error');
    return;
  }

  for (const pattern of parsed.excludedRepos) {
    try { new RegExp(pattern); }
    catch (err) {
      showConfigStatus(`Invalid excludedRepos pattern "${pattern}": ${err.message}`, 'error');
      return;
    }
  }

  for (const pattern of parsed.commentAuthorFilter) {
    try { new RegExp(pattern); }
    catch (err) {
      showConfigStatus(`Invalid commentAuthorFilter pattern "${pattern}": ${err.message}`, 'error');
      return;
    }
  }

  chrome.storage.sync.set({ extensionConfig: parsed }, () => {
    showConfigStatus('Config saved. Reload your GitHub tab for changes to take effect.', 'success');
  });
});

resetConfigBtn.addEventListener('click', () => {
  configInput.value = JSON.stringify(DEFAULT_CONFIG, null, 2);
  chrome.storage.sync.remove('extensionConfig', () => {
    showConfigStatus('Reset to defaults.', 'success');
  });
});
