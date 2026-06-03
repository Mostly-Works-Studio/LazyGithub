const step1     = document.getElementById('step-1');
const step2     = document.getElementById('step-2');
const step3     = document.getElementById('step-3');
const doneBanner = document.getElementById('done-banner');

function activateStep(el) {
  el.classList.remove('step--pending');
  el.classList.add('step--active');
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function completeStep(el) {
  el.classList.remove('step--active');
  el.classList.add('step--done');
}

function finishSetup() {
  if (step2.classList.contains('step--done')) return;
  completeStep(step2);
  activateStep(step3);
}

function completeOnboarding() {
  if (step3.classList.contains('step--done')) return;
  completeStep(step3);
  doneBanner.classList.add('visible');
}

// Step 1 → Step 2: user clicked the GitHub token link
document.getElementById('create-token-btn').addEventListener('click', () => {
  completeStep(step1);
  activateStep(step2);
  document.getElementById('ob-token-input').focus();
  window.open('https://github.com/settings/tokens/new?scopes=repo,workflow&description=LazyDeploy', '_blank');
});

// Step 2 → inline token input
const obTokenInput  = document.getElementById('ob-token-input');
const obTokenStatus = document.getElementById('ob-token-status');
let obValidateTimer = null;

function showObStatus(message, type) {
  obTokenStatus.textContent = message;
  obTokenStatus.className   = `ob-token-status${type ? ' ' + type : ''}`;
}

async function validateObToken(token) {
  showObStatus('🔍 Validating…', '');
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
      showObStatus(`✓ Authenticated as @${login}`, 'success');
    } else if (res.status === 401) {
      showObStatus('✗ Invalid token — check it was copied correctly.', 'error');
    } else if (res.status === 403) {
      showObStatus('✗ Token rejected — check it has the required scopes (repo, workflow).', 'error');
    } else {
      showObStatus(`✗ Validation failed (${res.status}).`, 'error');
    }
  } catch {
    showObStatus('✗ Could not reach GitHub — check your connection.', 'error');
  }
}

obTokenInput.addEventListener('input', () => {
  clearTimeout(obValidateTimer);
  obTokenStatus.textContent = '';
  obTokenStatus.className   = 'ob-token-status';
  const token = obTokenInput.value.trim();
  if (!token) return;
  if ((!token.startsWith('ghp_') && !token.startsWith('github_pat_')) || token.length < 20) return;
  obValidateTimer = setTimeout(() => validateObToken(token), 600);
});

obTokenInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('ob-save-btn').click();
});

document.getElementById('ob-save-btn').addEventListener('click', () => {
  clearTimeout(obValidateTimer);
  const token = obTokenInput.value.trim();
  if (!token) return;
  if ((!token.startsWith('ghp_') && !token.startsWith('github_pat_')) || token.length < 20) {
    showObStatus('Token looks incomplete — make sure you copied it in full.', 'error');
    return;
  }
  chrome.storage.sync.set({ githubToken: token }, finishSetup);
});


// Fallback: token saved from the full settings page while onboarding tab is open
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (changes.githubToken?.newValue) finishSetup();
  if (changes.extensionConfig?.newValue && step3.classList.contains('step--active')) completeOnboarding();
});

// If token already saved when page loads, skip straight to step 3 (or done if config exists too)
chrome.storage.sync.get(['githubToken', 'extensionConfig'], ({ githubToken, extensionConfig }) => {
  if (!githubToken) return;
  completeStep(step1);
  completeStep(step2);
  activateStep(step3);
  if (extensionConfig) completeOnboarding();
});

// ── Step 3: Configure from scratch ──
document.getElementById('ob-configure-btn').addEventListener('click', () => {
  completeOnboarding();
  chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
});

// ── Step 3: Paste config modal ──
const obPasteOverlay  = document.getElementById('ob-paste-overlay');
const obPasteTextarea = document.getElementById('ob-paste-textarea');
const obPasteStatus   = document.getElementById('ob-paste-status');

function showPasteStatus(msg, type) {
  obPasteStatus.textContent = msg;
  obPasteStatus.className   = `ob-modal-status${type ? ' ' + type : ''}`;
}

document.getElementById('ob-paste-btn').addEventListener('click', () => {
  obPasteTextarea.value   = '';
  obPasteStatus.textContent = '';
  obPasteStatus.className = 'ob-modal-status';
  obPasteOverlay.classList.add('visible');
  obPasteTextarea.focus();
});

document.getElementById('ob-paste-cancel').addEventListener('click', () => {
  obPasteOverlay.classList.remove('visible');
});

obPasteOverlay.addEventListener('click', e => {
  if (e.target === obPasteOverlay) obPasteOverlay.classList.remove('visible');
});

function isConditionalEmpty(v) {
  if (!v && v !== 0) return true;
  if (typeof v === 'string') return !v.trim();
  if (Array.isArray(v)) return v.length === 0 || v.every(r => !(r.value ?? '').trim());
  return true;
}

function validatePastedConfig(config) {
  const presets  = config.tokenPresets ?? [];
  const actions  = config.actions      ?? [];
  const groups   = config.groups       ?? [];
  const patterns = config.repoFilter?.patterns ?? [];

  for (let i = 0; i < presets.length; i++) {
    const p = presets[i];
    if (!p.id?.trim()) return `Token Preset ${i+1}: preset name cannot be empty.`;
    if (p.regex) { try { new RegExp(p.regex); } catch (e) { return `Token Preset "${p.id}": invalid regex — ${e.message}`; } }
  }

  for (let i = 0; i < actions.length; i++) {
    const a    = actions[i];
    const kind = a.trigger === 'comment' ? 'Comment' : 'PR Header';
    if (!a.label?.trim()) return `Action ${i+1} (${kind}): label cannot be empty.`;
    if (!/^#[0-9a-fA-F]{6}$/.test(a.color)) return `Action ${i+1} (${kind}): invalid color hex.`;
    for (let ti = 0; ti < (a.tokens ?? []).length; ti++) {
      if (!a.tokens[ti].name) return `Action ${i+1} (${kind}), Token ${ti+1}: token name cannot be empty.`;
      if (a.tokens[ti].regex) { try { new RegExp(a.tokens[ti].regex); } catch (e) { return `Action ${i+1} (${kind}), Token "${a.tokens[ti].name}": invalid regex — ${e.message}`; } }
    }
    const act = a.action ?? {};
    if (act.type === 'comment'            && isConditionalEmpty(act.comment))    return `Action ${i+1} (${kind}): comment text cannot be empty.`;
    if (act.type === 'workflow'           && isConditionalEmpty(act.file))        return `Action ${i+1} (${kind}): workflow file cannot be empty.`;
    if (act.type === 'repositoryDispatch' && isConditionalEmpty(act.eventType))   return `Action ${i+1} (${kind}): event type cannot be empty.`;
    if (act.type === 'deployment'         && isConditionalEmpty(act.environment)) return `Action ${i+1} (${kind}): environment cannot be empty.`;
  }

  for (const p of patterns) {
    try { new RegExp(p); } catch (e) { return `Invalid repo filter pattern "${p}": ${e.message}`; }
  }

  for (const group of groups) {
    for (const pattern of (group.repos ?? [])) {
      try { new RegExp(pattern); } catch (e) { return `Invalid repo pattern "${pattern}": ${e.message}`; }
    }
  }

  return null;
}

document.getElementById('ob-paste-apply').addEventListener('click', () => {
  const raw = obPasteTextarea.value.trim();
  if (!raw) { showPasteStatus('Paste a JSON config first.', 'error'); return; }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    showPasteStatus(`Invalid JSON: ${e.message}`, 'error');
    return;
  }

  const err = validatePastedConfig(parsed);
  if (err) { showPasteStatus(err, 'error'); return; }

  chrome.storage.sync.set({ extensionConfig: parsed }, () => {
    showPasteStatus('✓ Config saved!', 'success');
    setTimeout(() => {
      obPasteOverlay.classList.remove('visible');
      completeOnboarding();
    }, 800);
  });
});
