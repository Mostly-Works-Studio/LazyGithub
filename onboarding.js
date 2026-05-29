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

document.getElementById('ob-settings-btn').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
});

// Fallback: token saved from the full settings page while onboarding tab is open
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes.githubToken) return;
  if (changes.githubToken.newValue) finishSetup();
});

// If token already saved when page loads, skip straight to done
chrome.storage.sync.get('githubToken', ({ githubToken }) => {
  if (githubToken) {
    completeStep(step1);
    completeStep(step2);
    activateStep(step3);
    completeStep(step3);
    doneBanner.classList.add('visible');
  }
});
