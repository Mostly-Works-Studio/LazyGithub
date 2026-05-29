// ── Default Config (mirrors background.js DEFAULT_CONFIG) ────────────────────

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

let CONFIG = DEFAULT_CONFIG;
let TOKEN_CONFIGURED = false;

// ── Styles ────────────────────────────────────────────────────────────────────

const STYLES = `
  .wd-btn {
    display: none;
    margin-left: 5px;
    padding: 1px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: bold;
    cursor: pointer;
    vertical-align: middle;
    user-select: none;
    line-height: 1.6;
    color: white;
    opacity: 0;
    transform: translateY(-2px);
    transition: background 0.3s ease, opacity 0.3s ease, transform 0.2s ease;
  }
  .wd-btn.wd-visible {
    opacity: 1;
    transform: translateY(0);
  }
  .wd-btn.wd-loading {
    cursor: default;
    animation: wd-pulse 0.8s ease-in-out infinite;
  }
  .wd-btn.wd-success { animation: wd-pop   0.3s ease; }
  .wd-btn.wd-failure { animation: wd-shake 0.4s ease; }

  /* Build button (always visible, sits in PR header) */
  .wd-build-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 12px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    user-select: none;
    color: white;
    border: none;
    transition: background 0.2s ease, transform 0.15s ease, opacity 0.2s ease;
    vertical-align: middle;
    line-height: 1.5;
  }
  .wd-build-btn.wd-loading {
    cursor: default;
    opacity: 0.8;
    animation: wd-pulse 0.8s ease-in-out infinite;
  }
  .wd-build-btn.wd-success { background: #1a7f37; animation: wd-pop   0.3s ease; }
  .wd-build-btn.wd-failure { background: #cf222e; animation: wd-shake 0.4s ease; }

  @keyframes wd-pulse {
    0%, 100% { opacity: 1;   }
    50%       { opacity: 0.4; }
  }
  @keyframes wd-pop {
    0%   { transform: scale(1);    }
    50%  { transform: scale(1.15); }
    100% { transform: scale(1);    }
  }
  @keyframes wd-shake {
    0%, 100% { transform: translateX(0);   }
    25%      { transform: translateX(-3px); }
    75%      { transform: translateX(3px);  }
  }

  /* Offset comment anchors so the sticky GitHub header doesn't cover them */
  [id^="issuecomment-"] {
    scroll-margin-top: 80px;
  }

  /* Disabled state when no GitHub token is configured */
  body.wd-token-missing .wd-btn       { opacity: 0.4; cursor: not-allowed; }
  body.wd-token-missing [data-wd-build] { opacity: 0.4 !important; cursor: not-allowed !important; }

  /* Toast */
  #wd-toast-container {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 99999;
    display: flex;
    flex-direction: column;
    gap: 8px;
    pointer-events: none;
  }
  .wd-toast {
    pointer-events: all;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    min-width: 260px;
    max-width: 360px;
    padding: 12px 14px;
    border-radius: 8px;
    font-size: 13px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: white;
    box-shadow: 0 4px 16px rgba(0,0,0,0.25);
    animation: wd-toast-in 0.25s ease;
  }
  .wd-toast.wd-toast-success { background: #1a7f37; }
  .wd-toast.wd-toast-error   { background: #cf222e; }
  .wd-toast-icon  { font-size: 15px; flex-shrink: 0; margin-top: 1px; }
  .wd-toast-body  { flex: 1; line-height: 1.4; }
  .wd-toast-close { background: none; border: none; color: rgba(255,255,255,0.7); cursor: pointer; font-size: 16px; padding: 0; line-height: 1; flex-shrink: 0; }
  .wd-toast-close:hover { color: white; }
  @keyframes wd-toast-in {
    from { opacity: 0; transform: translateY(12px); }
    to   { opacity: 1; transform: translateY(0);    }
  }
`;

const styleEl = document.createElement('style');
styleEl.textContent = STYLES;
document.head.appendChild(styleEl);

// ── Toast ─────────────────────────────────────────────────────────────────────

function getOrCreateToastContainer() {
  let container = document.getElementById('wd-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'wd-toast-container';
    document.body.appendChild(container);
  }
  return container;
}

function showToast({ success, message, duration = 5000 }) {
  const container = getOrCreateToastContainer();
  const toast = document.createElement('div');
  toast.className = `wd-toast ${success ? 'wd-toast-success' : 'wd-toast-error'}`;
  toast.innerHTML = `
    <span class="wd-toast-icon">${success ? '✓' : '✗'}</span>
    <span class="wd-toast-body">${message}</span>
    <button class="wd-toast-close" title="Dismiss">×</button>
  `;

  const dismiss = () => toast.remove();
  toast.querySelector('.wd-toast-close').addEventListener('click', dismiss);
  const timer = setTimeout(dismiss, duration);
  toast.addEventListener('mouseenter', () => clearTimeout(timer));
  toast.addEventListener('mouseleave', () => setTimeout(dismiss, 1500));
  container.appendChild(toast);
}

// Navigates to a comment URL after a build. On the same-pathname tab (Conversation)
// a plain hash change won't reload the page so the new comment might not be in the DOM;
// we set the hash then force a full reload. On a different-pathname tab (Files Changed
// etc.) location.href already triggers a full navigation so the server response will
// always include the new comment.
function scrollToComment(commentUrl) {
  const url = new URL(commentUrl);
  if (url.pathname === location.pathname) {
    history.replaceState(null, '', url.hash);
    location.reload();
  } else {
    location.href = commentUrl;
  }
}

// ── Build Button (PR header) ──────────────────────────────────────────────────

function parsePrFromUrl() {
  const match = location.pathname.match(/^\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  if (!match) return null;
  return { repo: match[1], prNumber: match[2] };
}

function isPullRequestPage() {
  return /\/pull\/\d+/.test(location.pathname);
}

function attachBuildButton() {
  if (!isPullRequestPage()) return;
  if (isRepoExcluded()) return;

  const pr = parsePrFromUrl();
  if (!pr) return;

  const hiddenStates = CONFIG.buildButton?.hiddenOnStates ?? [];
  if (hiddenStates.length > 0) {
    const state = getPrState();
    if (hiddenStates.some(s => state.includes(s.toLowerCase()))) return;
  }

  const containers = [
    ...document.querySelectorAll('[data-component="PH_Actions"]'),
    ...document.querySelectorAll('.gh-header-actions'),
  ];

  for (const container of containers) {
    if (container.dataset.wdBuildBtn) continue;
    container.dataset.wdBuildBtn = '1';
    const sibling = [...container.querySelectorAll('button')]
      .find(b => !b.textContent.toLowerCase().includes('experience'));
    container.prepend(makeBuildButton(pr, sibling));
  }

  const stickyHeader =
    [...document.querySelectorAll('[class*="stickyHeader"]')].find(el => el.children.length > 0) ??
    document.querySelector('.pr-toolbar');

  if (stickyHeader) {
    const titleArea  = stickyHeader.querySelector('[data-component="TitleArea"]');
    const stateLabel =
      stickyHeader.querySelector('[class*="StateLabel-Icon"]')?.parentElement ??
      stickyHeader.querySelector('.State') ??
      document.querySelector('[class*="StateLabel-Icon"]')?.parentElement ??
      document.querySelector('.State');
    const anchor     = titleArea ?? stickyHeader;

    if (!anchor.dataset.wdBuildBtn) {
      anchor.dataset.wdBuildBtn = '1';
      const stickyBtn = makeStickyBuildButton(pr);
      if (stateLabel && anchor.contains(stateLabel)) {
        stateLabel.after(stickyBtn);
      } else {
        anchor.appendChild(stickyBtn);
      }
    }
  }
}

function makeStickyBuildButton(pr) {
  const btn = document.createElement('button');
  btn.innerHTML        = CONFIG.buildButton.label;
  btn.title            = 'Post build comment and start build';
  btn.dataset.wdBuild  = '1';

  const stateLabel =
    document.querySelector('[class*="StateLabel-Icon"]')?.parentElement ??
    document.querySelector('.State');

  function applyStyle(bg, cursor = 'pointer', opacity = '1') {
    if (stateLabel) {
      const s = window.getComputedStyle(stateLabel);
      btn.style.cssText = `
        -webkit-appearance:none; appearance:none;
        display:inline-flex; align-items:center; align-self:center; flex-shrink:0;
        padding:${s.padding}; border-radius:${s.borderRadius};
        font-size:${s.fontSize}; font-weight:${s.fontWeight};
        line-height:${s.lineHeight}; height:${s.height};
        margin-left:6px; margin-right:6px; background:${bg}; color:white;
        border:none; cursor:${cursor}; opacity:${opacity};
      `;
    } else {
      btn.style.cssText = `
        -webkit-appearance:none; appearance:none;
        display:inline-flex; align-items:center; align-self:center; flex-shrink:0;
        padding:3px 10px; border-radius:6px;
        font-size:12px; font-weight:600; line-height:1.5;
        margin-left:6px; margin-right:6px; background:${bg}; color:white;
        border:none; cursor:${cursor}; opacity:${opacity};
      `;
    }
  }

  applyStyle(CONFIG.buildButton.color);

  btn.addEventListener('click', () => {
    if (!TOKEN_CONFIGURED) {
      showToast({ success: false, message: 'No GitHub token configured. Open LazyDeploy settings to add one.' });
      chrome.runtime.sendMessage({ type: 'openOptions' });
      return;
    }
    btn.innerHTML = '⏳ Starting Build…';
    applyStyle(CONFIG.buildButton.color, 'default', '0.7');
    btn.disabled = true;

    chrome.runtime.sendMessage({
      type: 'build', repo: pr.repo, prNumber: pr.prNumber,
      buildComment: CONFIG.buildComment,
    }, res => {
      if (res?.success) {
        btn.innerHTML = '✓ Build Started';
        applyStyle('#1a7f37');
        setTimeout(() => scrollToComment(res.commentUrl), 500);
        setTimeout(() => { btn.innerHTML = CONFIG.buildButton.label; applyStyle(CONFIG.buildButton.color); btn.disabled = false; }, 5000);
      } else {
        btn.innerHTML = '✗ Failed';
        applyStyle('#cf222e');
        btn.disabled = false;
        showToast({ success: false, message: res?.error ?? 'Failed to post build comment.' });
        setTimeout(() => { btn.innerHTML = CONFIG.buildButton.label; applyStyle(CONFIG.buildButton.color); }, 3000);
      }
    });
  });

  btn.addEventListener('mouseenter', () => {
    if (btn.disabled) return;
    if (!TOKEN_CONFIGURED) btn.innerHTML = '⚠️ Token required';
  });
  btn.addEventListener('mouseleave', () => {
    if (btn.disabled) return;
    btn.innerHTML = CONFIG.buildButton.label;
  });

  return btn;
}

function makeBuildButton(pr, sibling) {
  const btn = document.createElement('button');
  btn.innerHTML        = CONFIG.buildButton.label;
  btn.title            = 'Post build comment and start build';
  btn.dataset.wdBuild  = '1';

  if (sibling) {
    const s = window.getComputedStyle(sibling);

    function applyStyle(bg, color, cursor = 'pointer', opacity = '1') {
      btn.style.cssText = `
        -webkit-appearance:none; appearance:none;
        display:inline-flex; align-items:center; gap:4px; flex-shrink:0;
        padding:${s.padding}; border-radius:${s.borderRadius};
        font-size:${s.fontSize}; font-weight:${s.fontWeight};
        line-height:${s.lineHeight}; height:${s.height};
        background:${bg}; color:${color}; border:${s.border};
        cursor:${cursor}; opacity:${opacity}; margin-right:4px;
      `;
    }

    applyStyle(CONFIG.buildButton.color, 'white');

    btn.addEventListener('click', () => {
      if (!TOKEN_CONFIGURED) {
        showToast({ success: false, message: 'No GitHub token configured. Open LazyDeploy settings to add one.' });
        chrome.runtime.sendMessage({ type: 'openOptions' });
        return;
      }
      btn.innerHTML = '⏳ Starting Build…';
      applyStyle(CONFIG.buildButton.color, 'white', 'default', '0.7');
      btn.disabled = true;

      chrome.runtime.sendMessage({
        type: 'build', repo: pr.repo, prNumber: pr.prNumber,
        buildComment: CONFIG.buildComment,
      }, res => {
        if (res?.success) {
          btn.innerHTML = '✓ Build Started';
          applyStyle('#1a7f37', 'white');
          setTimeout(() => scrollToComment(res.commentUrl), 500);
          setTimeout(() => { btn.innerHTML = CONFIG.buildButton.label; applyStyle(CONFIG.buildButton.color, 'white'); btn.disabled = false; }, 5000);
        } else {
          btn.innerHTML = '✗ Failed';
          applyStyle('#cf222e', 'white');
          btn.disabled = false;
          showToast({ success: false, message: res?.error ?? 'Failed to post build comment.' });
          setTimeout(() => { btn.innerHTML = CONFIG.buildButton.label; applyStyle(CONFIG.buildButton.color, 'white'); }, 3000);
        }
      });
    });

    btn.addEventListener('mouseenter', () => {
      if (btn.disabled) return;
      if (!TOKEN_CONFIGURED) btn.innerHTML = '⚠️ Token required';
    });
    btn.addEventListener('mouseleave', () => {
      if (btn.disabled) return;
      btn.innerHTML = CONFIG.buildButton.label;
    });
  } else {
    btn.className          = 'wd-build-btn';
    btn.style.background   = CONFIG.buildButton.color;
    btn.addEventListener('mouseenter', () => {
      if (btn.disabled) return;
      if (!TOKEN_CONFIGURED) btn.innerHTML = '⚠️ Token required';
      else btn.style.filter = 'brightness(0.85)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.filter = '';
      if (btn.disabled) return;
      btn.innerHTML = CONFIG.buildButton.label;
    });

    btn.addEventListener('click', () => {
      if (!TOKEN_CONFIGURED) {
        showToast({ success: false, message: 'No GitHub token configured. Open LazyDeploy settings to add one.' });
        chrome.runtime.sendMessage({ type: 'openOptions' });
        return;
      }
      btn.innerHTML = '⏳ Starting Build…';
      btn.className = 'wd-build-btn wd-loading';
      btn.style.background = CONFIG.buildButton.color;
      btn.disabled  = true;

      chrome.runtime.sendMessage({
        type: 'build', repo: pr.repo, prNumber: pr.prNumber,
        buildComment: CONFIG.buildComment,
      }, res => {
        if (res?.success) {
          btn.innerHTML = '✓ Build Started';
          btn.className = 'wd-build-btn wd-success';
          setTimeout(() => scrollToComment(res.commentUrl), 500);
          setTimeout(() => { btn.innerHTML = CONFIG.buildButton.label; btn.className = 'wd-build-btn'; btn.style.background = CONFIG.buildButton.color; btn.disabled = false; }, 5000);
        } else {
          btn.innerHTML = '✗ Failed';
          btn.className = 'wd-build-btn wd-failure';
          btn.disabled  = false;
          showToast({ success: false, message: res?.error ?? 'Failed to post build comment.' });
          setTimeout(() => { btn.innerHTML = CONFIG.buildButton.label; btn.className = 'wd-build-btn'; btn.style.background = CONFIG.buildButton.color; }, 3000);
        }
      });
    });
  }

  return btn;
}

// ── Deploy Buttons (comment links) ────────────────────────────────────────────

function createDeployButton({ label, color }) {
  const btn = document.createElement('span');
  btn.className        = 'wd-btn';
  btn.textContent      = label;
  btn.dataset.label    = label;
  btn.title            = label;
  btn.style.background = color;
  btn.addEventListener('mouseenter', () => {
    if (!TOKEN_CONFIGURED) btn.textContent = '⚠️ Token required';
  });
  btn.addEventListener('mouseleave', () => {
    btn.textContent = btn.dataset.label;
  });
  return btn;
}

function attachHoverBehaviour(link, buttons) {
  let showTimer, hideTimer;

  const showAll = () => {
    buttons.forEach(b => { b.style.display = 'inline'; });
    requestAnimationFrame(() => buttons.forEach(b => b.classList.add('wd-visible')));
  };

  const startHideCountdown = () => {
    hideTimer = setTimeout(() => {
      buttons.forEach(b => b.classList.remove('wd-visible'));
      setTimeout(() => buttons.forEach(b => { b.style.display = 'none'; }), 300);
    }, 5000);
  };

  const cancelHideCountdown = () => clearTimeout(hideTimer);

  link.addEventListener('mouseenter', () => {
    cancelHideCountdown();
    showTimer = setTimeout(showAll, 500);
  });
  link.addEventListener('mouseleave', () => {
    clearTimeout(showTimer);
    if (buttons[0].classList.contains('wd-visible')) startHideCountdown();
  });

  buttons.forEach(btn => {
    btn.addEventListener('mouseenter', cancelHideCountdown);
    btn.addEventListener('mouseleave', startHideCountdown);
  });
}

function attachDeployClickHandler(btn, link, btnConfig) {
  btn.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();

    if (!TOKEN_CONFIGURED) {
      showToast({ success: false, message: 'No GitHub token configured. Open LazyDeploy settings to add one.' });
      chrome.runtime.sendMessage({ type: 'openOptions' });
      return;
    }

    btn.textContent      = 'Deploying…';
    btn.className        = 'wd-btn wd-visible wd-loading';
    btn.style.background = btnConfig.color;

    chrome.runtime.sendMessage({ type: 'trigger', url: link.href, buttonConfig: btnConfig }, res => {
      if (res?.success) {
        const count     = res.count ?? 1;
        btn.textContent = `✓ ${count} triggered`;
        btn.className   = 'wd-btn wd-visible wd-success';
        btn.style.background = btnConfig.color;
        showToast({ success: true, message: `${count} workflow${count > 1 ? 's' : ''} triggered successfully.` });
      } else {
        btn.textContent = '✗ Failed';
        btn.className   = 'wd-btn wd-visible wd-failure';
        btn.style.background = '#cf222e';
        showToast({ success: false, message: res?.error ?? 'Something went wrong. Check extension options.' });
      }

      setTimeout(() => {
        btn.textContent      = btnConfig.label;
        btn.className        = 'wd-btn wd-visible';
        btn.style.background = btnConfig.color;
        btn.title            = btnConfig.label;
      }, 3000);
    });
  });
}

function attachDeployButtons(link) {
  if (link.dataset.wdAttached) return;
  if (isRepoExcluded()) return;

  const author = getCommentAuthor(link);
  if (!isAuthorAllowed(author)) return;

  link.dataset.wdAttached = '1';

  const buttons = CONFIG.deployButtons.map(btnConfig => {
    const btn = createDeployButton(btnConfig);
    attachDeployClickHandler(btn, link, btnConfig);
    return btn;
  });

  buttons.reduce((prev, btn) => { prev.after(btn); return btn; }, link);
  attachHoverBehaviour(link, buttons);
}

// ── Validation Helpers ────────────────────────────────────────────────────────

function isRepoExcluded() {
  const match = location.pathname.match(/^\/([^/]+\/[^/]+)/);
  if (!match) return false;
  const repo = match[1];
  for (const pattern of CONFIG.excludedRepos ?? []) {
    try { if (new RegExp(pattern).test(repo)) return true; }
    catch { /* ignore invalid regex */ }
  }
  return false;
}

function getPrState() {
  return (
    document.querySelector('[class*="StateLabel"]')?.textContent ??
    document.querySelector('.State')?.textContent ??
    ''
  ).trim().toLowerCase();
}

function getCommentAuthor(link) {
  const commentId = link.href.match(/issuecomment-(\d+)/)?.[1];
  if (!commentId) return null;
  const commentEl = document.getElementById(`issuecomment-${commentId}`);
  if (!commentEl) return null;
  const authorEl =
    commentEl.querySelector('[data-hovercard-type="user"]') ??
    commentEl.querySelector('.author');
  return authorEl?.textContent?.trim() ?? null;
}

function isAuthorAllowed(author) {
  const filters = CONFIG.commentAuthorFilter ?? [];
  if (filters.length === 0) return true;
  if (!author) return false;
  for (const pattern of filters) {
    try { if (new RegExp(`^${pattern}$`, 'i').test(author)) return true; }
    catch { if (pattern.toLowerCase() === author.toLowerCase()) return true; }
  }
  return false;
}

// ── Scanner (runs on load + DOM changes) ─────────────────────────────────────

function scan() {
  attachBuildButton();
  document.querySelectorAll('a[href*="#issuecomment-"]').forEach(attachDeployButtons);
}

function init() {
  chrome.storage.sync.get(['extensionConfig', 'githubToken'], data => {
    CONFIG           = data.extensionConfig ?? DEFAULT_CONFIG;
    TOKEN_CONFIGURED = !!data.githubToken;
    document.body.classList.toggle('wd-token-missing', !TOKEN_CONFIGURED);
    scan();
    new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  });

  chrome.storage.onChanged.addListener(changes => {
    if (changes.extensionConfig) {
      CONFIG = changes.extensionConfig.newValue ?? DEFAULT_CONFIG;
    }
    if (changes.githubToken) {
      TOKEN_CONFIGURED = !!changes.githubToken.newValue;
      document.body.classList.toggle('wd-token-missing', !TOKEN_CONFIGURED);
    }
  });
}

init();
