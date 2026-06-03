let GLOBAL_CONFIG = DEFAULT_CONFIG;
let CONFIG = DEFAULT_CONFIG;

// ── Button Feedback Helpers ───────────────────────────────────────────────────

const PR_FB_DEFAULTS = {
  pending:      '⏳ Starting…',
  successLabel: '✓ Done',
  successToast: '',
  failureLabel: '✗ Failed',
  failureToast: '{error}',
};

const CA_FB_DEFAULTS = {
  pending:      'Running…',
  successLabel: '✓ {count} triggered',
  successToast: '{count} action(s) triggered successfully.',
  failureLabel: '✗ Failed',
  failureToast: '{error}',
};

function feedbackLabel(feedback, state, vars, defaults) {
  const raw = state === 'pending' ? feedback?.pending        :
              state === 'success' ? feedback?.success?.label :
                                    feedback?.failure?.label;
  const def = state === 'pending' ? defaults.pending        :
              state === 'success' ? defaults.successLabel   :
                                    defaults.failureLabel;
  return (raw || def || '').replace(/\{(\w+)\}/g, (_, k) => String(vars?.[k] ?? ''));
}

// Empty string returned = do not show a toast.
function feedbackToast(feedback, state, vars, defaults) {
  const raw = state === 'success' ? feedback?.success?.toast : feedback?.failure?.toast;
  const def = state === 'success' ? defaults.successToast    : defaults.failureToast;
  const tmpl = (raw != null && raw !== '') ? raw : (def ?? '');
  return tmpl ? tmpl.replace(/\{(\w+)\}/g, (_, k) => String(vars?.[k] ?? '')) : '';
}

// Handles post-success navigation. redirect values:
//   undefined/'none' → default behaviour (go to comment if commentUrl present, else nothing)
//   'comment'        → scroll to posted comment (no-op if no commentUrl)
//   'workflow_runs'  → navigate to /{repo}/actions
//   'deployments'    → navigate to /{repo}/deployments
function handleRedirect(redirect, res, repo) {
  if (!redirect || redirect === 'none') return;
  if (redirect === 'comment') {
    if (res.commentUrl) setTimeout(() => scrollToComment(res.commentUrl), 500);
    return;
  }
  const dest =
    redirect === 'workflow_runs' ? `https://github.com/${repo}/actions` :
    redirect === 'deployments'   ? `https://github.com/${repo}/deployments` :
    null;
  if (dest) setTimeout(() => { location.href = dest; }, 500);
}

// ── User-input prompt — {ask:"Label"} tokens ─────────────────────────────────
// Scan a value (string or conditional array) for {ask:"..."} patterns.

function scanAskLabels(value) {
  const re = /\{ask:"([^"]+)"\}/g;
  const labels = [];
  if (typeof value === 'string') {
    let m; while ((m = re.exec(value)) !== null) labels.push(m[1]);
  } else if (Array.isArray(value)) {
    for (const rule of value) labels.push(...scanAskLabels(rule.value ?? ''));
  }
  return labels;
}

function collectAskLabels(action) {
  const seen = new Set();
  const add = arr => arr.forEach(l => seen.add(l));
  add(scanAskLabels(action.comment ?? ''));
  add(scanAskLabels(action.file ?? ''));
  add(scanAskLabels(action.eventType ?? ''));
  add(scanAskLabels(action.environment ?? ''));
  for (const v of Object.values(action.inputs  ?? {})) add(scanAskLabels(v));
  for (const v of Object.values(action.payload  ?? {})) add(scanAskLabels(v));
  return [...seen];
}

function applyAskValues(action, values) {
  const subst = s => typeof s === 'string'
    ? s.replace(/\{ask:"([^"]+)"\}/g, (_, l) => values[l] ?? '') : s;
  const substConditional = v =>
    typeof v === 'string' ? subst(v) :
    Array.isArray(v) ? v.map(r => ({ ...r, value: subst(r.value ?? '') })) : v;
  const substObj = o => o
    ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, subst(String(v))])) : o;
  const r = { ...action };
  if (action.comment     != null) r.comment     = substConditional(action.comment);
  if (action.file        != null) r.file        = substConditional(action.file);
  if (action.eventType   != null) r.eventType   = substConditional(action.eventType);
  if (action.environment != null) r.environment = substConditional(action.environment);
  if (action.inputs )  r.inputs  = substObj(action.inputs);
  if (action.payload)  r.payload = substObj(action.payload);
  return r;
}

// Shows a modal dialog collecting values for each label. Returns a Promise that
// resolves with {label: value} or rejects if the user cancels.
function showAskModal(labels) {
  return new Promise((resolve, reject) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;';

    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:#fff;border-radius:12px;padding:24px;min-width:320px;max-width:460px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.25);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';

    const title = document.createElement('h3');
    title.textContent = 'Action requires input';
    title.style.cssText = 'margin:0 0 16px;font-size:15px;font-weight:600;color:#1f2328;';
    dialog.append(title);

    const inputEls = {};
    for (const label of labels) {
      const group = document.createElement('div');
      group.style.marginBottom = '12px';
      const lbl = document.createElement('label');
      lbl.textContent = label;
      lbl.style.cssText = 'display:block;font-size:12px;font-weight:500;color:#57606a;margin-bottom:4px;';
      const inp = document.createElement('input');
      inp.type = 'text'; inp.autocomplete = 'off';
      inp.style.cssText = 'width:100%;padding:6px 10px;box-sizing:border-box;border:1px solid #d0d7de;border-radius:6px;font-size:13px;outline:none;';
      inp.addEventListener('focus', () => { inp.style.borderColor = '#0969da'; inp.style.boxShadow = '0 0 0 3px rgba(9,105,218,0.12)'; });
      inp.addEventListener('blur',  () => { inp.style.borderColor = '#d0d7de'; inp.style.boxShadow = 'none'; });
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') confirm(); });
      group.append(lbl, inp);
      dialog.append(group);
      inputEls[label] = inp;
    }

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:20px;';
    const cancelBtn  = document.createElement('button');
    cancelBtn.textContent  = 'Cancel';
    cancelBtn.style.cssText = 'padding:6px 14px;border-radius:6px;font-size:13px;font-weight:500;cursor:pointer;border:1px solid #d0d7de;background:#fff;color:#1f2328;';
    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = 'Continue';
    confirmBtn.style.cssText = 'padding:6px 14px;border-radius:6px;font-size:13px;font-weight:500;cursor:pointer;border:none;background:#1f883d;color:#fff;';

    const dismiss = ok => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      if (ok) { const v = {}; for (const [l, el] of Object.entries(inputEls)) v[l] = el.value; resolve(v); }
      else reject(new Error('cancelled'));
    };
    const confirm = () => dismiss(true);
    cancelBtn.addEventListener('click', () => dismiss(false));
    confirmBtn.addEventListener('click', confirm);
    overlay.addEventListener('click', e => { if (e.target === overlay) dismiss(false); });
    const onKey = e => { if (e.key === 'Escape') dismiss(false); };
    document.addEventListener('keydown', onKey);

    btnRow.append(cancelBtn, confirmBtn);
    dialog.append(btnRow);
    overlay.append(dialog);
    document.body.append(overlay);
    Object.values(inputEls)[0]?.focus();
  });
}

// ── Config Resolution ─────────────────────────────────────────────────────────

function deepMergeConfig(base, override) {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    if (key === 'actionsMode' || key === 'prActionsMode' || key === 'commentActionsMode') continue;

    if (key === 'actions') {
      const mode = override.actionsMode ?? 'replace';
      result.actions = mode === 'extend'
        ? [...(base.actions ?? []), ...(override.actions ?? [])]
        : override.actions;
      continue;
    }

    // Group/repo overrides store prActions and commentActions as separate keys
    // so each trigger type can be toggled and mode'd independently.
    if (key === 'prActions') {
      const mode    = override.prActionsMode ?? 'replace';
      const basePr  = (result.actions ?? []).filter(a => a.trigger !== 'comment');
      const baseCa  = (result.actions ?? []).filter(a => a.trigger === 'comment');
      const newPr   = (override.prActions ?? []).map(a => ({ ...a, trigger: 'prHeader' }));
      result.actions = [
        ...(mode === 'extend' ? [...basePr, ...newPr] : newPr),
        ...baseCa,
      ];
      continue;
    }

    if (key === 'commentActions') {
      const mode   = override.commentActionsMode ?? 'replace';
      const curPr  = (result.actions ?? []).filter(a => a.trigger !== 'comment');
      const curCa  = (result.actions ?? []).filter(a => a.trigger === 'comment');
      const newCa  = (override.commentActions ?? []).map(a => ({ ...a, trigger: 'comment' }));
      result.actions = [
        ...curPr,
        ...(mode === 'extend' ? [...curCa, ...newCa] : newCa),
      ];
      continue;
    }

    if (
      result[key] !== null &&
      typeof result[key] === 'object' &&
      !Array.isArray(result[key]) &&
      override[key] !== null &&
      typeof override[key] === 'object' &&
      !Array.isArray(override[key])
    ) {
      result[key] = { ...result[key], ...override[key] };
    } else {
      result[key] = override[key];
    }
  }
  return result;
}

function resolveConfig(globalConfig, repo) {
  let resolved = { ...globalConfig };

  for (const group of globalConfig.groups ?? []) {
    const matched = (group.repos ?? []).some(pattern => {
      if (pattern === repo) return true;
      try { return new RegExp(pattern).test(repo); }
      catch { return false; }
    });
    if (matched) {
      resolved = deepMergeConfig(resolved, group.config ?? {});
      break;
    }
  }

  const repoConfig = (globalConfig.repos ?? {})[repo];
  if (repoConfig) resolved = deepMergeConfig(resolved, repoConfig);

  return resolved;
}

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

// ── PR Action Buttons (PR header) ─────────────────────────────────────────────

function parsePrFromUrl() {
  const match = location.pathname.match(/^\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  if (!match) return null;
  return { repo: match[1], prNumber: match[2] };
}

function isPullRequestPage() {
  return /\/pull\/\d+/.test(location.pathname);
}

function attachPrActionButtons() {
  if (!isPullRequestPage()) return;
  if (isRepoExcluded()) return;

  const pr = parsePrFromUrl();
  if (!pr) return;

  const prState = getPrState();
  const visibleActions = (CONFIG.actions ?? []).filter(a => {
    if (a.trigger !== 'prHeader') return false;
    const hidden = a.filter?.hideOnStates ?? [];
    return !hidden.some(s => prState.includes(s.toLowerCase()));
  });

  if (visibleActions.length === 0) return;

  const containers = [
    ...document.querySelectorAll('[data-component="PH_Actions"]'),
    ...document.querySelectorAll('.gh-header-actions'),
  ];

  for (const container of containers) {
    if (container.dataset.wdBuildBtn) continue;
    container.dataset.wdBuildBtn = '1';
    const sibling = [...container.querySelectorAll('button')]
      .find(b => !b.textContent.toLowerCase().includes('experience'));
    // Reverse so after prepend they appear in config order (first = leftmost)
    for (const prAction of [...visibleActions].reverse()) {
      container.prepend(makePrActionBtn(pr, prAction, sibling));
    }
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
    const anchor = titleArea ?? stickyHeader;

    if (!anchor.dataset.wdBuildBtn) {
      anchor.dataset.wdBuildBtn = '1';
      for (const prAction of visibleActions) {
        const stickyBtn = makeStickyPrActionBtn(pr, prAction);
        if (stateLabel && anchor.contains(stateLabel)) {
          stateLabel.after(stickyBtn);
        } else {
          anchor.appendChild(stickyBtn);
        }
      }
    }
  }
}

function makeStickyPrActionBtn(pr, prAction) {
  const btn = document.createElement('button');
  btn.innerHTML       = prAction.label;
  btn.title           = prAction.label;
  btn.dataset.wdBuild = '1';

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

  applyStyle(prAction.color);

  btn.addEventListener('click', () => {
    if (!TOKEN_CONFIGURED) {
      showToast({ success: false, message: 'GitHub token not set up yet — opening LazyDeploy settings.' });
      chrome.runtime.sendMessage({ type: 'openOptions' });
      return;
    }
    (async () => {
      let action = prAction.action;
      const askLabels = collectAskLabels(action);
      if (askLabels.length) {
        try { action = applyAskValues(action, await showAskModal(askLabels)); }
        catch { return; }
      }
      btn.innerHTML = feedbackLabel(prAction.feedback, 'pending', {}, PR_FB_DEFAULTS);
      applyStyle(prAction.color, 'default', '0.7');
      btn.disabled = true;

      chrome.runtime.sendMessage(
        { type: 'action', trigger: 'prHeader', repo: pr.repo, prNumber: pr.prNumber, action, tokens: prAction.tokens ?? [] },
        res => {
          if (res?.success) {
            btn.innerHTML = feedbackLabel(prAction.feedback, 'success', {}, PR_FB_DEFAULTS);
            applyStyle('#1a7f37');
            const sToast = feedbackToast(prAction.feedback, 'success', {}, PR_FB_DEFAULTS);
            if (sToast) showToast({ success: true, message: sToast });
            handleRedirect(prAction.feedback?.success?.redirect, res, pr.repo);
            setTimeout(() => { btn.innerHTML = prAction.label; applyStyle(prAction.color); btn.disabled = false; }, 5000);
          } else {
            const errVars = { error: res?.error || 'Action failed.' };
            btn.innerHTML = feedbackLabel(prAction.feedback, 'failure', errVars, PR_FB_DEFAULTS);
            applyStyle('#cf222e');
            btn.disabled = false;
            const fToast = feedbackToast(prAction.feedback, 'failure', errVars, PR_FB_DEFAULTS);
            if (fToast) showToast({ success: false, message: fToast });
            setTimeout(() => { btn.innerHTML = prAction.label; applyStyle(prAction.color); }, 3000);
          }
        }
      );
    })();
  });

  btn.addEventListener('mouseenter', () => { if (!btn.disabled && !TOKEN_CONFIGURED) btn.innerHTML = 'Setup'; });
  btn.addEventListener('mouseleave', () => { if (!btn.disabled) btn.innerHTML = TOKEN_CONFIGURED ? prAction.label : 'Setup'; });

  return btn;
}

function makePrActionBtn(pr, prAction, sibling) {
  const btn = document.createElement('button');
  btn.innerHTML       = prAction.label;
  btn.title           = prAction.label;
  btn.dataset.wdBuild = '1';

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

    applyStyle(prAction.color, 'white');

    btn.addEventListener('click', () => {
      if (!TOKEN_CONFIGURED) {
        showToast({ success: false, message: 'GitHub token not set up yet — opening LazyDeploy settings.' });
        chrome.runtime.sendMessage({ type: 'openOptions' });
        return;
      }
      (async () => {
        let action = prAction.action;
        const askLabels = collectAskLabels(action);
        if (askLabels.length) {
          try { action = applyAskValues(action, await showAskModal(askLabels)); }
          catch { return; }
        }
        btn.innerHTML = feedbackLabel(prAction.feedback, 'pending', {}, PR_FB_DEFAULTS);
        applyStyle(prAction.color, 'white', 'default', '0.7');
        btn.disabled = true;

        chrome.runtime.sendMessage(
          { type: 'action', trigger: 'prHeader', repo: pr.repo, prNumber: pr.prNumber, action, tokens: prAction.tokens ?? [] },
          res => {
            if (res?.success) {
              btn.innerHTML = feedbackLabel(prAction.feedback, 'success', {}, PR_FB_DEFAULTS);
              applyStyle('#1a7f37', 'white');
              const sToast = feedbackToast(prAction.feedback, 'success', {}, PR_FB_DEFAULTS);
              if (sToast) showToast({ success: true, message: sToast });
              handleRedirect(prAction.feedback?.success?.redirect, res, pr.repo);
              setTimeout(() => { btn.innerHTML = prAction.label; applyStyle(prAction.color, 'white'); btn.disabled = false; }, 5000);
            } else {
              const errVars = { error: res?.error || 'Action failed.' };
              btn.innerHTML = feedbackLabel(prAction.feedback, 'failure', errVars, PR_FB_DEFAULTS);
              applyStyle('#cf222e', 'white');
              btn.disabled = false;
              const fToast = feedbackToast(prAction.feedback, 'failure', errVars, PR_FB_DEFAULTS);
              if (fToast) showToast({ success: false, message: fToast });
              setTimeout(() => { btn.innerHTML = prAction.label; applyStyle(prAction.color, 'white'); }, 3000);
            }
          }
        );
      })();
    });

    btn.addEventListener('mouseenter', () => { if (!btn.disabled && !TOKEN_CONFIGURED) btn.innerHTML = 'Setup'; });
    btn.addEventListener('mouseleave', () => { if (!btn.disabled) btn.innerHTML = TOKEN_CONFIGURED ? prAction.label : 'Setup'; });
  } else {
    btn.className        = 'wd-build-btn';
    btn.style.background = prAction.color;

    btn.addEventListener('mouseenter', () => {
      if (btn.disabled) return;
      if (!TOKEN_CONFIGURED) btn.innerHTML = 'Setup';
      else btn.style.filter = 'brightness(0.85)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.filter = '';
      if (!btn.disabled) btn.innerHTML = prAction.label;
    });

    btn.addEventListener('click', () => {
      if (!TOKEN_CONFIGURED) {
        showToast({ success: false, message: 'GitHub token not set up yet — opening LazyDeploy settings.' });
        chrome.runtime.sendMessage({ type: 'openOptions' });
        return;
      }
      (async () => {
        let action = prAction.action;
        const askLabels = collectAskLabels(action);
        if (askLabels.length) {
          try { action = applyAskValues(action, await showAskModal(askLabels)); }
          catch { return; }
        }
        btn.innerHTML        = feedbackLabel(prAction.feedback, 'pending', {}, PR_FB_DEFAULTS);
        btn.className        = 'wd-build-btn wd-loading';
        btn.style.background = prAction.color;
        btn.disabled         = true;

        chrome.runtime.sendMessage(
          { type: 'action', trigger: 'prHeader', repo: pr.repo, prNumber: pr.prNumber, action, tokens: prAction.tokens ?? [] },
          res => {
            if (res?.success) {
              btn.innerHTML = feedbackLabel(prAction.feedback, 'success', {}, PR_FB_DEFAULTS);
              btn.className = 'wd-build-btn wd-success';
              const sToast = feedbackToast(prAction.feedback, 'success', {}, PR_FB_DEFAULTS);
              if (sToast) showToast({ success: true, message: sToast });
              handleRedirect(prAction.feedback?.success?.redirect, res, pr.repo);
              setTimeout(() => { btn.innerHTML = prAction.label; btn.className = 'wd-build-btn'; btn.style.background = prAction.color; btn.disabled = false; }, 5000);
            } else {
              const errVars = { error: res?.error || 'Action failed.' };
              btn.innerHTML = feedbackLabel(prAction.feedback, 'failure', errVars, PR_FB_DEFAULTS);
              btn.className = 'wd-build-btn wd-failure';
              btn.disabled  = false;
              const fToast = feedbackToast(prAction.feedback, 'failure', errVars, PR_FB_DEFAULTS);
              if (fToast) showToast({ success: false, message: fToast });
              setTimeout(() => { btn.innerHTML = prAction.label; btn.className = 'wd-build-btn'; btn.style.background = prAction.color; }, 3000);
            }
          }
        );
      })();
    });
  }

  return btn;
}

// ── Comment Action Buttons (next to version strings in comments) ──────────────

function createCommentActionBtn({ label, color }) {
  const btn = document.createElement('span');
  btn.className        = 'wd-btn';
  btn.textContent      = label;
  btn.dataset.label    = label;
  btn.title            = label;
  btn.style.background = color;
  btn.addEventListener('mouseenter', () => {
    if (!TOKEN_CONFIGURED) btn.textContent = 'Setup';
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

function attachCommentClickHandler(btn, link, caConfig) {
  btn.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();

    if (!TOKEN_CONFIGURED) {
      showToast({ success: false, message: 'GitHub token not set up yet — opening LazyDeploy settings.' });
      chrome.runtime.sendMessage({ type: 'openOptions' });
      return;
    }

    (async () => {
      let action = caConfig.action;
      const askLabels = collectAskLabels(action);
      if (askLabels.length) {
        try { action = applyAskValues(action, await showAskModal(askLabels)); }
        catch { return; }
      }

      btn.textContent      = feedbackLabel(caConfig.feedback, 'pending', {}, CA_FB_DEFAULTS);
      btn.className        = 'wd-btn wd-visible wd-loading';
      btn.style.background = caConfig.color;

      chrome.runtime.sendMessage({ type: 'action', trigger: 'comment', url: link.href, action, tokens: caConfig.tokens ?? [], onMultiple: caConfig.onMultiple ?? 'all' }, res => {
      if (res?.success) {
        const count      = res.count ?? 1;
        btn.textContent  = feedbackLabel(caConfig.feedback, 'success', { count }, CA_FB_DEFAULTS);
        btn.className    = 'wd-btn wd-visible wd-success';
        btn.style.background = caConfig.color;
        const sToast = feedbackToast(caConfig.feedback, 'success', { count }, CA_FB_DEFAULTS);
        if (sToast) showToast({ success: true, message: sToast });
        handleRedirect(caConfig.feedback?.success?.redirect, res, link.href.match(/github\.com\/([^/]+\/[^/]+)/)?.[1] ?? '');
      } else {
        const errVars    = { error: res?.error || 'Something went wrong. Check extension options.' };
        btn.textContent  = feedbackLabel(caConfig.feedback, 'failure', errVars, CA_FB_DEFAULTS);
        btn.className    = 'wd-btn wd-visible wd-failure';
        btn.style.background = '#cf222e';
        const fToast = feedbackToast(caConfig.feedback, 'failure', errVars, CA_FB_DEFAULTS);
        if (fToast) showToast({ success: false, message: fToast });
      }

      setTimeout(() => {
        btn.textContent      = caConfig.label;
        btn.className        = 'wd-btn wd-visible';
        btn.style.background = caConfig.color;
        btn.title            = caConfig.label;
      }, 3000);
    });
    })();
  });
}

function attachCommentButtons(link) {
  if (link.dataset.wdAttached) return;
  if (isRepoExcluded()) return;

  link.dataset.wdAttached = '1';

  const author = getCommentAuthor(link);

  const buttons = (CONFIG.actions ?? [])
    .filter(caConfig => caConfig.trigger === 'comment')
    .filter(caConfig => isActionAuthorAllowed(caConfig, author))
    .map(caConfig => {
      const btn = createCommentActionBtn(caConfig);
      attachCommentClickHandler(btn, link, caConfig);
      return btn;
    });

  if (buttons.length === 0) return;

  buttons.reduce((prev, btn) => { prev.after(btn); return btn; }, link);
  attachHoverBehaviour(link, buttons);
}

// ── Validation Helpers ────────────────────────────────────────────────────────

function isRepoExcluded() {
  const match = location.pathname.match(/^\/([^/]+\/[^/]+)/);
  if (!match) return false;
  const repo = match[1];
  // Repo-specific config entry always bypasses the filter
  if ((GLOBAL_CONFIG.repos ?? {})[repo]) return false;

  // Support old excludedRepos key for backward compat
  const filter = CONFIG.repoFilter ?? { mode: 'exclude', patterns: CONFIG.excludedRepos ?? [] };
  const { mode = 'exclude', patterns = [] } = filter;

  const matches = pat => { try { return new RegExp(pat).test(repo); } catch { return pat === repo; } };

  if (mode === 'include') {
    // Inject only on repos that match at least one pattern; empty list = no restriction
    return patterns.length > 0 && !patterns.some(matches);
  }

  // exclude mode: skip repos that match any pattern
  return patterns.some(matches);
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

function isActionAuthorAllowed(caConfig, author) {
  const filters = caConfig.filter?.authors ?? [];
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
  attachPrActionButtons();
  document.querySelectorAll('a[href*="#issuecomment-"]').forEach(attachCommentButtons);
}

function init() {
  chrome.storage.sync.get(['extensionConfig', 'githubToken'], data => {
    GLOBAL_CONFIG    = data.extensionConfig ?? DEFAULT_CONFIG;
    const pr         = parsePrFromUrl();
    CONFIG           = resolveConfig(GLOBAL_CONFIG, pr?.repo ?? '');
    TOKEN_CONFIGURED = !!data.githubToken;
    document.body.classList.toggle('wd-token-missing', !TOKEN_CONFIGURED);
    scan();
    new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  });

  chrome.storage.onChanged.addListener(changes => {
    if (changes.extensionConfig) {
      GLOBAL_CONFIG = changes.extensionConfig.newValue ?? DEFAULT_CONFIG;
      const pr      = parsePrFromUrl();
      CONFIG        = resolveConfig(GLOBAL_CONFIG, pr?.repo ?? '');
    }
    if (changes.githubToken) {
      TOKEN_CONFIGURED = !!changes.githubToken.newValue;
      document.body.classList.toggle('wd-token-missing', !TOKEN_CONFIGURED);
    }
  });
}

init();
