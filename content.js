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

// ── User-input prompt — {input:"Label"} tokens ────────────────────────────────
// Scan a value (string or conditional array) for {input:"..."} patterns.

function scanInputLabels(value) {
  const re = /\{input:"([^"]+)"\}/g;
  const labels = [];
  if (typeof value === 'string') {
    let m; while ((m = re.exec(value)) !== null) labels.push(m[1]);
  } else if (Array.isArray(value)) {
    for (const rule of value) labels.push(...scanInputLabels(rule.value ?? ''));
  }
  return labels;
}

function collectInputLabels(action) {
  const seen = new Set();
  const add = arr => arr.forEach(l => seen.add(l));
  add(scanInputLabels(action.comment ?? ''));
  add(scanInputLabels(action.file ?? ''));
  add(scanInputLabels(action.eventType ?? ''));
  add(scanInputLabels(action.environment ?? ''));
  for (const v of Object.values(action.inputs  ?? {})) add(scanInputLabels(v));
  for (const v of Object.values(action.payload  ?? {})) add(scanInputLabels(v));
  return [...seen];
}

function applyInputValues(action, values) {
  const subst = s => typeof s === 'string'
    ? s.replace(/\{input:"([^"]+)"\}/g, (_, l) => values[l] ?? '') : s;
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

// Shows a modal dialog collecting values for each prompt. Each prompt is
// { id, label, context? } — `context` (e.g. the comment line that triggered
// an "ask user" fallback) is rendered as a hint under the field. Returns a
// Promise that resolves with {id: value} or rejects if the user cancels.
function showInputModal(prompts) {
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
    for (const prompt of prompts) {
      const group = document.createElement('div');
      group.style.marginBottom = '12px';
      const lbl = document.createElement('label');
      lbl.textContent = prompt.label;
      lbl.style.cssText = 'display:block;font-size:12px;font-weight:500;color:#57606a;margin-bottom:4px;';
      group.append(lbl);
      if (prompt.context && prompt.context.trim()) {
        const ctx = document.createElement('div');
        ctx.textContent = prompt.context.trim();
        ctx.style.cssText = 'font-size:11px;color:#8c959f;margin-bottom:4px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;word-break:break-word;';
        group.append(ctx);
      }
      const inp = document.createElement('input');
      inp.type = 'text'; inp.autocomplete = 'off';
      inp.style.cssText = 'width:100%;padding:6px 10px;box-sizing:border-box;border:1px solid #d0d7de;border-radius:6px;font-size:13px;outline:none;';
      inp.addEventListener('focus', () => { inp.style.borderColor = '#0969da'; inp.style.boxShadow = '0 0 0 3px rgba(9,105,218,0.12)'; });
      inp.addEventListener('blur',  () => { inp.style.borderColor = '#d0d7de'; inp.style.boxShadow = 'none'; });
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') confirm(); });
      group.append(inp);
      dialog.append(group);
      inputEls[prompt.id] = inp;
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
      if (ok) { const v = {}; for (const [id, el] of Object.entries(inputEls)) v[id] = el.value; resolve(v); }
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

// Sends an `action` message to background, transparently handling the
// needsInput round-trip: if background reports it needs an "ask user"
// fallback answered, shows one modal (title = the fallback's label, context
// = the matched line) and resends the same message with resolvedInputs
// attached. No speculative/preview call — background always does its real
// fetch first; this only fires when that fetch actually surfaced a gap.
function dispatchActionMessage(msg, callback) {
  chrome.runtime.sendMessage(msg, res => {
    if (chrome.runtime.lastError) { callback({ success: false, error: chrome.runtime.lastError.message }); return; }
    if (res?.needsInput) {
      showInputModal(res.prompts).then(values => {
        dispatchActionMessage({ ...msg, resolvedInputs: { ...(msg.resolvedInputs ?? {}), ...values } }, callback);
      }).catch(() => {
        callback({ success: false, error: 'cancelled' });
      });
      return;
    }
    callback(res);
  });
}

// An action is unconfigured when its core dispatch field is still empty.
// comment → needs a body; workflow → needs a file; repositoryDispatch → needs an eventType.
// deployment has sensible defaults (PR branch + 'production') so it's never blocked.
function isActionUnconfigured(prAction) {
  const a = prAction?.action;
  if (!a) return true;
  if (a.type === 'comment')            return !String(a.comment   ?? '').trim();
  if (a.type === 'workflow')           return !String(a.file      ?? '').trim();
  if (a.type === 'repositoryDispatch') return !String(a.eventType ?? '').trim();
  return false;
}


function fetchWorkflowSchema(repo, workflowFile) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'getWorkflowInputs', repo, workflowFile }, res => {
      if (chrome.runtime.lastError || !res?.success) { reject(); return; }
      resolve(res.inputs);
    });
  });
}

// Resolves all user prompts for an action before dispatch:
//   1. Collects explicit {input:"..."} labels from action fields
//   2. For workflow actions with a static file path, fetches the workflow's
//      input schema and adds any required inputs that aren't already configured
//   3. Auto-fills optional workflow inputs that have a default value
//   4. Shows the modal if there's anything to collect
// Returns the fully resolved action, or throws if the user cancels.
async function resolveActionForDispatch(action, repo) {
  const inputLabels = collectInputLabels(action);
  const workflowPrompts = [];

  if (
    action.type === 'workflow' &&
    typeof action.file === 'string' &&
    action.file.trim() &&
    !/{/.test(action.file)
  ) {
    try {
      const schema = await fetchWorkflowSchema(repo, action.file);
      const defaults = {};
      for (const inp of schema) {
        const configured = (action.inputs ?? {})[inp.name];
        const hasValue = configured != null && String(configured).trim() !== '';
        if (hasValue) continue;
        if (inp.required) {
          workflowPrompts.push({ name: inp.name, label: inp.description || inp.name });
        } else if (inp.default) {
          defaults[inp.name] = inp.default;
        }
      }
      if (Object.keys(defaults).length) {
        action = { ...action, inputs: { ...defaults, ...(action.inputs ?? {}) } };
      }
    } catch { /* silently skip if schema fetch fails */ }
  }

  const allPrompts = [
    ...inputLabels.map(l => ({ id: l, label: l })),
    ...workflowPrompts.map(p => ({ id: p.label, label: p.label })),
  ];
  if (allPrompts.length) {
    const values = await showInputModal(allPrompts); // throws on cancel
    action = applyInputValues(action, values);
    if (workflowPrompts.length) {
      const extra = {};
      for (const p of workflowPrompts) extra[p.name] = values[p.label] ?? '';
      action = { ...action, inputs: { ...(action.inputs ?? {}), ...extra } };
    }
  }

  return action;
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

  /* Action dropdown menu */
  .wd-action-menu {
    position: fixed; z-index: 99999;
    background: white; border: 1px solid #d0d7de;
    border-radius: 8px; padding: 4px;
    min-width: 160px; max-width: 240px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.15);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .wd-action-menu-item {
    display: flex; align-items: center; gap: 8px;
    width: 100%; padding: 7px 10px; border: none;
    background: none; border-radius: 5px; cursor: pointer;
    font-size: 12px; font-weight: 500; color: #1f2328;
    text-align: left; white-space: nowrap;
  }
  .wd-action-menu-item:hover { background: #f6f8fa; }
  .wd-action-menu-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }


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

  /* PR Info Box */
  @keyframes wd-info-slide-in {
    from { transform: translateX(calc(100% + 24px)); opacity: 0.5; }
    to   { transform: translateX(0);                 opacity: 1;   }
  }
  @keyframes wd-info-slide-out {
    0%   { transform: translateX(0);                  opacity: 1;   }
    16%  { transform: translateX(-8px);               opacity: 1;   }
    100% { transform: translateX(calc(100% + 8px));   opacity: 0.6; }
  }
  #wd-info-box {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 99998;
    display: flex;
    flex-direction: row;
    background: white;
    border: 1px solid #d0d7de;
    border-radius: 10px;
    box-shadow: 0 6px 20px rgba(0,0,0,0.13);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: #1f2328;
    overflow: hidden;
    transform: translateX(0);
    transition: transform 0.38s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  #wd-info-box.wd-info-entering {
    animation: wd-info-slide-in 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) both;
  }
  #wd-info-box.wd-info-exiting {
    animation: wd-info-slide-out 0.38s cubic-bezier(0.55, 0, 0.75, 0) both;
  }
  #wd-info-box.wd-info-collapsed { transform: translateX(calc(100% + 8px)); }
  #wd-info-box:hover { box-shadow: 0 10px 30px rgba(0,0,0,0.18); }
  #wd-info-box:not(.wd-info-collapsed):not(.wd-info-exiting):not(.wd-info-entering):hover {
    transform: translateY(-2px);
    transition: transform 0.2s ease, box-shadow 0.2s ease;
  }

  /* Expanded: pill on RIGHT edge; Collapsed: pill on LEFT edge (peeks from screen right) */
  .wd-info-side-tab {
    order: 2;
    width: 16px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    user-select: none;
  }
  #wd-info-box.wd-info-collapsed .wd-info-side-tab { order: 1; }
  #wd-info-box.wd-info-collapsed .wd-info-body    { order: 2; }

  .wd-info-side-pill {
    display: flex;
    transition: transform 0.3s ease, opacity 0.15s ease;
  }
  .wd-info-side-tab:hover .wd-info-side-pill { opacity: 0.55; }
  #wd-info-box.wd-info-collapsed .wd-info-side-pill { transform: scaleX(-1); }

  .wd-info-body {
    order: 1;
    padding: 10px 12px 12px;
    display: flex;
    flex-direction: column;
    gap: 7px;
    overflow: hidden;
    min-width: 190px;
  }
  .wd-info-title {
    font-size: 11px;
    font-weight: 600;
    color: #57606a;
    padding-bottom: 7px;
    border-bottom: 1px solid #eaedef;
    margin-bottom: 1px;
  }

  .wd-info-row { display: flex; align-items: flex-start; gap: 7px; }
  .wd-info-row-icon { font-size: 12px; margin-top: 2px; flex-shrink: 0; }
  .wd-info-row-content { min-width: 0; }
  .wd-info-row-label {
    font-size: 9px;
    font-weight: 700;
    color: #8c959f;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 1px;
    line-height: 1;
  }
  .wd-info-row-value {
    font-size: 12px;
    color: #1f2328;
    font-weight: 500;
    word-break: break-all;
    line-height: 1.35;
    cursor: pointer;
    border-radius: 3px;
    transition: color 0.15s ease;
  }
  .wd-info-row-value:hover { color: #0969da; }

  @keyframes wd-spin { to { transform: rotate(360deg); } }
  .wd-info-refresh-btn {
    border: none;
    background: none;
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    padding: 0 2px;
    color: #8c959f;
    flex-shrink: 0;
    transition: color 0.15s ease;
    margin-left: 2px;
    align-self: flex-end;
    margin-bottom: 1px;
  }
  .wd-info-refresh-btn:hover { color: #0969da; }
  .wd-info-refresh-btn:disabled { cursor: default; }
  .wd-info-refresh-btn.wd-spinning { animation: wd-spin 0.8s linear infinite; color: #8c959f; }

  /* Retry icon buttons on failed checks (PR merge box) and failed runs (Actions list) */
  .wd-retry-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    margin: 0 4px;
    padding: 0;
    border-radius: 6px;
    vertical-align: middle;
    color: var(--fgColor-muted, #59636e);
    background: transparent;
    border: 1px solid transparent;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
  }
  .wd-retry-btn svg { width: 16px; height: 16px; fill: currentColor; }
  .wd-retry-btn:hover:not(:disabled) {
    color: var(--fgColor-accent, #0969da);
    background: var(--control-transparent-bgColor-hover, rgba(208, 215, 222, 0.32));
    border-color: var(--borderColor-default, #d0d7de);
  }
  .wd-retry-btn:disabled { cursor: default; }
  .wd-retry-btn.wd-loading { color: var(--fgColor-accent, #0969da); }
  .wd-retry-btn.wd-loading svg { animation: wd-spin 0.8s linear infinite; }
  .wd-retry-btn.wd-success { color: #1a7f37; }
  .wd-retry-btn.wd-failure { color: #cf222e; }
  /* Compact variant that lives inside a row's title (merge-box heading, Actions list link). */
  .wd-retry-btn.wd-retry-inline { width: 24px; height: 24px; margin: -4px 6px -4px 6px; flex-shrink: 0; }
  /* Merge-box header variant: same icon, bordered so it reads as a button, and raised above
     GitHub's full-width expand/collapse overlay (hence the z-index). */
  .wd-retry-btn.wd-retry-all {
    margin: 0 8px 0 0;
    align-self: center;
    position: relative;
    z-index: 1;
    color: var(--fgColor-default, #1f2328);
    background: var(--button-default-bgColor-rest, #f6f8fa);
    border-color: var(--borderColor-default, #d0d7de);
  }
  .wd-retry-btn.wd-retry-all:hover:not(:disabled) { background: var(--button-default-bgColor-hover, #eef1f4); }
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

// ── Action dropdown menu ──────────────────────────────────────────────────────

function openActionMenu(anchor, actions, onSelect) {
  document.querySelector('.wd-action-menu')?.remove();

  const menu = document.createElement('div');
  menu.className = 'wd-action-menu';

  for (const action of actions) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'wd-action-menu-item';
    const dot = document.createElement('span');
    dot.className = 'wd-action-menu-dot';
    dot.style.background = action.color;
    item.append(dot, document.createTextNode(action.label));
    item.addEventListener('click', () => { menu.remove(); onSelect(action); });
    menu.append(item);
  }

  document.body.append(menu);

  const rect = anchor.getBoundingClientRect();
  const mH = menu.offsetHeight, mW = menu.offsetWidth;
  let top  = rect.bottom + 4;
  if (top + mH > window.innerHeight - 8) top = rect.top - mH - 4;
  menu.style.top  = Math.max(8, top) + 'px';
  menu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - mW - 8)) + 'px';

  const dismiss = e => {
    if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', dismiss, true); }
  };
  setTimeout(() => document.addEventListener('mousedown', dismiss, true), 0);
}

// ── Stack + individual grouping ───────────────────────────────────────────────

function groupIntoButtonGroups(actions, stacksDef) {
  const groups = [];
  const definedIds = new Set((stacksDef ?? []).map(s => s.id));

  for (const stack of stacksDef ?? []) {
    const stackActions = actions.filter(a => (a.stacks ?? []).includes(stack.id));
    if (stackActions.length === 0) continue;
    groups.push({ type: 'stack', stack, actions: stackActions });
  }

  for (const action of actions) {
    const inAnyStack = (action.stacks ?? []).some(id => definedIds.has(id));
    if (!inAnyStack) groups.push({ type: 'individual', action });
  }

  return groups;
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

// Extracts the head branch name from the PR page DOM.
// GitHub renders it in different elements depending on UI version.
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

  const prThreshold  = CONFIG.prDropdownThreshold ?? 3;
  const buttonGroups = groupIntoButtonGroups(visibleActions, CONFIG.stacks ?? []);

  const containers = [
    ...document.querySelectorAll('[data-component="PH_Actions"]'),
    ...document.querySelectorAll('.gh-header-actions'),
  ];

  for (const container of containers) {
    if (container.dataset.wdBuildBtn) continue;
    container.dataset.wdBuildBtn = '1';
    const sibling = [...container.querySelectorAll('button')]
      .find(b => !b.textContent.toLowerCase().includes('experience'));
    if (buttonGroups.length >= prThreshold) {
      container.prepend(makePrActionsDropdownBtn(pr, visibleActions, sibling));
    } else {
      const btns = buttonGroups.map(g =>
        g.type === 'stack'
          ? makePrStackBtn(pr, g.stack, g.actions, sibling)
          : makePrActionBtn(pr, g.action, sibling)
      );
      container.prepend(...btns);
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
      if (buttonGroups.length >= prThreshold) {
        const stickyBtn = makeStickyPrActionsDropdownBtn(pr, visibleActions);
        if (stateLabel && anchor.contains(stateLabel)) {
          stateLabel.after(stickyBtn);
        } else {
          anchor.appendChild(stickyBtn);
        }
      } else {
        const stickyBtns = buttonGroups.map(g =>
          g.type === 'stack'
            ? makeStickyPrStackBtn(pr, g.stack, g.actions)
            : makeStickyPrActionBtn(pr, g.action)
        );
        if (stateLabel && anchor.contains(stateLabel)) {
          let ref = stateLabel;
          for (const btn of stickyBtns) { ref.after(btn); ref = btn; }
        } else {
          for (const btn of stickyBtns) anchor.appendChild(btn);
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
      showToast({ success: false, message: 'GitHub token not set up yet — opening LazyGitHub settings.' });
      chrome.runtime.sendMessage({ type: 'openOptions', reason: 'no-token' });
      return;
    }
    if (isActionUnconfigured(prAction)) {
      chrome.runtime.sendMessage({ type: 'openOptions', reason: 'not-configured' });
      return;
    }
    (async () => {
      let action;
      try { action = await resolveActionForDispatch(prAction.action, pr.repo); }
      catch { return; }
      btn.innerHTML = feedbackLabel(prAction.feedback, 'pending', {}, PR_FB_DEFAULTS);
      applyStyle(prAction.color, 'default', '0.7');
      btn.disabled = true;

      dispatchActionMessage(
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
        showToast({ success: false, message: 'GitHub token not set up yet — opening LazyGitHub settings.' });
        chrome.runtime.sendMessage({ type: 'openOptions', reason: 'no-token' });
        return;
      }
      if (isActionUnconfigured(prAction)) {
        chrome.runtime.sendMessage({ type: 'openOptions', reason: 'not-configured' });
        return;
      }
      (async () => {
        let action;
        try { action = await resolveActionForDispatch(prAction.action, pr.repo); }
        catch { return; }
        btn.innerHTML = feedbackLabel(prAction.feedback, 'pending', {}, PR_FB_DEFAULTS);
        applyStyle(prAction.color, 'white', 'default', '0.7');
        btn.disabled = true;

        dispatchActionMessage(
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

  } else {
    btn.className        = 'wd-build-btn';
    btn.style.background = prAction.color;

    btn.addEventListener('mouseenter', () => { if (!btn.disabled) btn.style.filter = 'brightness(0.85)'; });
    btn.addEventListener('mouseleave', () => { btn.style.filter = ''; });

    btn.addEventListener('click', () => {
      if (!TOKEN_CONFIGURED) {
        showToast({ success: false, message: 'GitHub token not set up yet — opening LazyGitHub settings.' });
        chrome.runtime.sendMessage({ type: 'openOptions', reason: 'no-token' });
        return;
      }
      if (isActionUnconfigured(prAction)) {
        chrome.runtime.sendMessage({ type: 'openOptions', reason: 'not-configured' });
        return;
      }
      (async () => {
        let action;
        try { action = await resolveActionForDispatch(prAction.action, pr.repo); }
        catch { return; }
        btn.innerHTML        = feedbackLabel(prAction.feedback, 'pending', {}, PR_FB_DEFAULTS);
        btn.className        = 'wd-build-btn wd-loading';
        btn.style.background = prAction.color;
        btn.disabled         = true;

        dispatchActionMessage(
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

// ── PR action dropdown buttons (used when visibleActions.length >= prDropdownThreshold) ──────────

const DROPDOWN_COLOR = '#24292f';

function makeStickyPrActionsDropdownBtn(pr, visibleActions, { btnLabel, btnColor } = {}) {
  const dropLabel = btnLabel ?? (CONFIG.prDropdownLabel || 'LazyGitHub ▾');
  const dropColor = btnColor ?? DROPDOWN_COLOR;
  const btn = document.createElement('button');
  btn.innerHTML       = dropLabel;
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
        padding:3px 10px; border-radius:6px; font-size:12px; font-weight:600; line-height:1.5;
        margin-left:6px; margin-right:6px; background:${bg}; color:white;
        border:none; cursor:${cursor}; opacity:${opacity};
      `;
    }
  }

  applyStyle(dropColor);

  btn.addEventListener('click', () => {
    if (!TOKEN_CONFIGURED) {
      showToast({ success: false, message: 'GitHub token not set up yet — opening LazyGitHub settings.' });
      chrome.runtime.sendMessage({ type: 'openOptions', reason: 'no-token' });
      return;
    }
    openActionMenu(btn, visibleActions, async prAction => {
      if (isActionUnconfigured(prAction)) { chrome.runtime.sendMessage({ type: 'openOptions', reason: 'not-configured' }); return; }
      let action;
      try { action = await resolveActionForDispatch(prAction.action, pr.repo); } catch { return; }
      btn.innerHTML = feedbackLabel(prAction.feedback, 'pending', {}, PR_FB_DEFAULTS);
      applyStyle(prAction.color, 'default', '0.7');
      btn.disabled = true;
      dispatchActionMessage(
        { type: 'action', trigger: 'prHeader', repo: pr.repo, prNumber: pr.prNumber, action, tokens: prAction.tokens ?? [] },
        res => {
          btn.disabled = false;
          if (res?.success) {
            btn.innerHTML = feedbackLabel(prAction.feedback, 'success', {}, PR_FB_DEFAULTS);
            applyStyle('#1a7f37');
            const sToast = feedbackToast(prAction.feedback, 'success', {}, PR_FB_DEFAULTS);
            if (sToast) showToast({ success: true, message: sToast });
            handleRedirect(prAction.feedback?.success?.redirect, res, pr.repo);
            setTimeout(() => { btn.innerHTML = dropLabel; applyStyle(DROPDOWN_COLOR); }, 5000);
          } else {
            const errVars = { error: res?.error || 'Action failed.' };
            btn.innerHTML = feedbackLabel(prAction.feedback, 'failure', errVars, PR_FB_DEFAULTS);
            applyStyle('#cf222e');
            const fToast = feedbackToast(prAction.feedback, 'failure', errVars, PR_FB_DEFAULTS);
            if (fToast) showToast({ success: false, message: fToast });
            setTimeout(() => { btn.innerHTML = dropLabel; applyStyle(DROPDOWN_COLOR); }, 3000);
          }
        }
      );
    });
  });

  return btn;
}

function makePrActionsDropdownBtn(pr, visibleActions, sibling, { btnLabel, btnColor } = {}) {
  const dropLabel = btnLabel ?? (CONFIG.prDropdownLabel || 'LazyGitHub ▾');
  const dropColor = btnColor ?? DROPDOWN_COLOR;
  const btn = document.createElement('button');
  btn.innerHTML       = dropLabel;
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

    applyStyle(dropColor, 'white');

    btn.addEventListener('click', () => {
      if (!TOKEN_CONFIGURED) {
        showToast({ success: false, message: 'GitHub token not set up yet — opening LazyGitHub settings.' });
        chrome.runtime.sendMessage({ type: 'openOptions', reason: 'no-token' });
        return;
      }
      openActionMenu(btn, visibleActions, async prAction => {
        if (isActionUnconfigured(prAction)) { chrome.runtime.sendMessage({ type: 'openOptions', reason: 'not-configured' }); return; }
        let action;
        try { action = await resolveActionForDispatch(prAction.action, pr.repo); } catch { return; }
        btn.innerHTML = feedbackLabel(prAction.feedback, 'pending', {}, PR_FB_DEFAULTS);
        applyStyle(prAction.color, 'white', 'default', '0.7');
        btn.disabled = true;
        dispatchActionMessage(
          { type: 'action', trigger: 'prHeader', repo: pr.repo, prNumber: pr.prNumber, action, tokens: prAction.tokens ?? [] },
          res => {
            btn.disabled = false;
            if (res?.success) {
              btn.innerHTML = feedbackLabel(prAction.feedback, 'success', {}, PR_FB_DEFAULTS);
              applyStyle('#1a7f37', 'white');
              const sToast = feedbackToast(prAction.feedback, 'success', {}, PR_FB_DEFAULTS);
              if (sToast) showToast({ success: true, message: sToast });
              handleRedirect(prAction.feedback?.success?.redirect, res, pr.repo);
              setTimeout(() => { btn.innerHTML = dropLabel; applyStyle(dropColor, 'white'); }, 5000);
            } else {
              const errVars = { error: res?.error || 'Action failed.' };
              btn.innerHTML = feedbackLabel(prAction.feedback, 'failure', errVars, PR_FB_DEFAULTS);
              applyStyle('#cf222e', 'white');
              const fToast = feedbackToast(prAction.feedback, 'failure', errVars, PR_FB_DEFAULTS);
              if (fToast) showToast({ success: false, message: fToast });
              setTimeout(() => { btn.innerHTML = dropLabel; applyStyle(dropColor, 'white'); }, 3000);
            }
          }
        );
      });
    });

  } else {
    btn.className        = 'wd-build-btn';
    btn.style.background = dropColor;

    btn.addEventListener('mouseenter', () => { if (!btn.disabled) btn.style.filter = 'brightness(0.85)'; });
    btn.addEventListener('mouseleave', () => { btn.style.filter = ''; });

    btn.addEventListener('click', () => {
      if (!TOKEN_CONFIGURED) {
        showToast({ success: false, message: 'GitHub token not set up yet — opening LazyGitHub settings.' });
        chrome.runtime.sendMessage({ type: 'openOptions', reason: 'no-token' });
        return;
      }
      openActionMenu(btn, visibleActions, async prAction => {
        if (isActionUnconfigured(prAction)) { chrome.runtime.sendMessage({ type: 'openOptions', reason: 'not-configured' }); return; }
        let action;
        try { action = await resolveActionForDispatch(prAction.action, pr.repo); } catch { return; }
        btn.innerHTML        = feedbackLabel(prAction.feedback, 'pending', {}, PR_FB_DEFAULTS);
        btn.className        = 'wd-build-btn wd-loading';
        btn.style.background = prAction.color;
        btn.disabled         = true;
        dispatchActionMessage(
          { type: 'action', trigger: 'prHeader', repo: pr.repo, prNumber: pr.prNumber, action, tokens: prAction.tokens ?? [] },
          res => {
            btn.disabled = false;
            if (res?.success) {
              btn.innerHTML = feedbackLabel(prAction.feedback, 'success', {}, PR_FB_DEFAULTS);
              btn.className = 'wd-build-btn wd-success';
              const sToast = feedbackToast(prAction.feedback, 'success', {}, PR_FB_DEFAULTS);
              if (sToast) showToast({ success: true, message: sToast });
              handleRedirect(prAction.feedback?.success?.redirect, res, pr.repo);
              setTimeout(() => { btn.innerHTML = dropLabel; btn.className = 'wd-build-btn'; btn.style.background = dropColor; }, 5000);
            } else {
              const errVars = { error: res?.error || 'Action failed.' };
              btn.innerHTML = feedbackLabel(prAction.feedback, 'failure', errVars, PR_FB_DEFAULTS);
              btn.className = 'wd-build-btn wd-failure';
              const fToast = feedbackToast(prAction.feedback, 'failure', errVars, PR_FB_DEFAULTS);
              if (fToast) showToast({ success: false, message: fToast });
              setTimeout(() => { btn.innerHTML = dropLabel; btn.className = 'wd-build-btn'; btn.style.background = dropColor; }, 3000);
            }
          }
        );
      });
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
      showToast({ success: false, message: 'GitHub token not set up yet — opening LazyGitHub settings.' });
      chrome.runtime.sendMessage({ type: 'openOptions', reason: 'no-token' });
      return;
    }
    if (isActionUnconfigured(caConfig)) {
      chrome.runtime.sendMessage({ type: 'openOptions', reason: 'not-configured' });
      return;
    }

    (async () => {
      const repo = link.href.match(/github\.com\/([^/]+\/[^/]+)/)?.[1] ?? '';
      let action;
      try { action = await resolveActionForDispatch(caConfig.action, repo); }
      catch { return; }

      btn.textContent      = feedbackLabel(caConfig.feedback, 'pending', {}, CA_FB_DEFAULTS);
      btn.className        = 'wd-btn wd-visible wd-loading';
      btn.style.background = caConfig.color;

      dispatchActionMessage({ type: 'action', trigger: 'comment', url: link.href, action, tokens: caConfig.tokens ?? [], onMultiple: caConfig.onMultiple ?? 'all' }, res => {
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
  const caConfigs = (CONFIG.actions ?? [])
    .filter(ca => ca.trigger === 'comment')
    .filter(ca => isActionAuthorAllowed(ca, author));

  if (caConfigs.length === 0) return;

  const caThreshold  = CONFIG.commentDropdownThreshold ?? 4;
  const buttonGroups = groupIntoButtonGroups(caConfigs, CONFIG.stacks ?? []);

  if (buttonGroups.length >= caThreshold) {
    const trigger = makeCommentActionsDropdownTrigger(link, caConfigs);
    link.after(trigger);
    attachHoverBehaviour(link, [trigger]);
  } else if (buttonGroups.length === 1 && buttonGroups[0].type === 'individual') {
    const btn = createCommentActionBtn(buttonGroups[0].action);
    attachCommentClickHandler(btn, link, buttonGroups[0].action);
    link.after(btn);
    attachHoverBehaviour(link, [btn]);
  } else {
    const buttons = buttonGroups.map(g =>
      g.type === 'stack'
        ? makeCommentStackTrigger(link, g.stack, g.actions)
        : (() => { const b = createCommentActionBtn(g.action); attachCommentClickHandler(b, link, g.action); return b; })()
    );
    for (const btn of [...buttons].reverse()) link.after(btn);
    attachHoverBehaviour(link, buttons);
  }
}

function makeCommentActionsDropdownTrigger(link, caConfigs, { btnLabel, btnColor } = {}) {
  const TRIGGER_LABEL = btnLabel ?? (CONFIG.commentDropdownLabel || 'Actions ▾');
  const TRIGGER_COLOR = btnColor ?? '#57606a';

  const btn = document.createElement('span');
  btn.className        = 'wd-btn';
  btn.textContent      = TRIGGER_LABEL;
  btn.dataset.label    = TRIGGER_LABEL;
  btn.style.background = TRIGGER_COLOR;

  btn.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();

    if (!TOKEN_CONFIGURED) {
      showToast({ success: false, message: 'GitHub token not set up yet — opening LazyGitHub settings.' });
      chrome.runtime.sendMessage({ type: 'openOptions', reason: 'no-token' });
      return;
    }

    openActionMenu(btn, caConfigs, async caConfig => {
      if (isActionUnconfigured(caConfig)) { chrome.runtime.sendMessage({ type: 'openOptions', reason: 'not-configured' }); return; }

      const repo = link.href.match(/github\.com\/([^/]+\/[^/]+)/)?.[1] ?? '';
      let action;
      try { action = await resolveActionForDispatch(caConfig.action, repo); } catch { return; }

      btn.textContent      = feedbackLabel(caConfig.feedback, 'pending', {}, CA_FB_DEFAULTS);
      btn.className        = 'wd-btn wd-visible wd-loading';
      btn.style.background = caConfig.color;

      dispatchActionMessage(
        { type: 'action', trigger: 'comment', url: link.href, action, tokens: caConfig.tokens ?? [], onMultiple: caConfig.onMultiple ?? 'all' },
        res => {
          if (res?.success) {
            const count = res.count ?? 1;
            btn.textContent  = feedbackLabel(caConfig.feedback, 'success', { count }, CA_FB_DEFAULTS);
            btn.className    = 'wd-btn wd-visible wd-success';
            btn.style.background = caConfig.color;
            const sToast = feedbackToast(caConfig.feedback, 'success', { count }, CA_FB_DEFAULTS);
            if (sToast) showToast({ success: true, message: sToast });
            handleRedirect(caConfig.feedback?.success?.redirect, res, repo);
          } else {
            const errVars   = { error: res?.error || 'Something went wrong.' };
            btn.textContent = feedbackLabel(caConfig.feedback, 'failure', errVars, CA_FB_DEFAULTS);
            btn.className   = 'wd-btn wd-visible wd-failure';
            btn.style.background = '#cf222e';
            const fToast = feedbackToast(caConfig.feedback, 'failure', errVars, CA_FB_DEFAULTS);
            if (fToast) showToast({ success: false, message: fToast });
          }
          setTimeout(() => {
            btn.textContent      = TRIGGER_LABEL;
            btn.className        = 'wd-btn wd-visible';
            btn.style.background = TRIGGER_COLOR;
          }, 3000);
        }
      );
    });
  });

  return btn;
}

// ── Stack button helpers ──────────────────────────────────────────────────────

function makePrStackBtn(pr, stack, stackActions, sibling) {
  if (stackActions.length === 1) {
    return makePrActionBtn(pr, { ...stackActions[0], label: stack.label || stackActions[0].label, color: stack.color || stackActions[0].color }, sibling);
  }
  return makePrActionsDropdownBtn(pr, stackActions, sibling, { btnLabel: stack.label, btnColor: stack.color });
}

function makeStickyPrStackBtn(pr, stack, stackActions) {
  if (stackActions.length === 1) {
    return makeStickyPrActionBtn(pr, { ...stackActions[0], label: stack.label || stackActions[0].label, color: stack.color || stackActions[0].color });
  }
  return makeStickyPrActionsDropdownBtn(pr, stackActions, { btnLabel: stack.label, btnColor: stack.color });
}

function makeCommentStackTrigger(link, stack, stackActions) {
  if (stackActions.length === 1) {
    const btn = createCommentActionBtn({ label: stack.label || stackActions[0].label, color: stack.color || stackActions[0].color });
    attachCommentClickHandler(btn, link, stackActions[0]);
    return btn;
  }
  return makeCommentActionsDropdownTrigger(link, stackActions, { btnLabel: stack.label, btnColor: stack.color });
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

// ── PR Info Box ───────────────────────────────────────────────────────────────

function injectInfoBox() {
  if (!(CONFIG.showPrInfoBox ?? true) || !isPullRequestPage()) {
    const existing = document.getElementById('wd-info-box');
    if (existing) existing.remove();
    document.body.removeAttribute('data-wd-info-fetching');
    return;
  }

  const pr = parsePrFromUrl();
  if (!pr) return;

  // Box already rendered or fetch already in flight
  if (document.getElementById('wd-info-box')) return;
  if (document.body.dataset.wdInfoFetching === pr.prNumber) return;
  document.body.dataset.wdInfoFetching = pr.prNumber;

  chrome.runtime.sendMessage({ type: 'getPrBranch', repo: pr.repo, prNumber: pr.prNumber }, info => {
    document.body.removeAttribute('data-wd-info-fetching');
    if (!info || document.getElementById('wd-info-box')) return;

    const collapsed = localStorage.getItem('wd-info-box-collapsed') === '1';

    const box = document.createElement('div');
    box.id = 'wd-info-box';
    if (collapsed) {
      box.classList.add('wd-info-collapsed');
    } else {
      box.classList.add('wd-info-entering');
      box.addEventListener('animationend', () => box.classList.remove('wd-info-entering'), { once: true });
    }

    const sideTab = document.createElement('div');
    sideTab.className = 'wd-info-side-tab';
    sideTab.title = 'LazyGitHub — click to toggle';

    const sidePill = document.createElement('div');
    sidePill.className = 'wd-info-side-pill';

    const svgNS = 'http://www.w3.org/2000/svg';
    const chevronSvg = document.createElementNS(svgNS, 'svg');
    chevronSvg.setAttribute('width', '10');
    chevronSvg.setAttribute('height', '28');
    chevronSvg.setAttribute('viewBox', '0 0 10 28');
    chevronSvg.setAttribute('fill', 'none');
    const chevronPath = document.createElementNS(svgNS, 'polyline');
    chevronPath.setAttribute('points', '1.5,1 7.5,14 1.5,27');
    chevronPath.setAttribute('stroke', 'rgba(0,0,0,0.25)');
    chevronPath.setAttribute('stroke-width', '3');
    chevronPath.setAttribute('stroke-linecap', 'round');
    chevronPath.setAttribute('stroke-linejoin', 'round');
    chevronSvg.appendChild(chevronPath);
    sidePill.appendChild(chevronSvg);

    sideTab.append(sidePill);
    sideTab.addEventListener('click', () => {
      if (box.classList.contains('wd-info-collapsed')) {
        box.classList.remove('wd-info-collapsed');
        localStorage.setItem('wd-info-box-collapsed', '0');
      } else if (!box.classList.contains('wd-info-exiting')) {
        box.classList.add('wd-info-exiting');
        box.addEventListener('animationend', () => {
          box.classList.remove('wd-info-exiting');
          box.classList.add('wd-info-collapsed');
        }, { once: true });
        localStorage.setItem('wd-info-box-collapsed', '1');
      }
    });

    const body = document.createElement('div');
    body.className = 'wd-info-body';

    const title = document.createElement('div');
    title.className = 'wd-info-title';
    const titleIcon = document.createElement('img');
    titleIcon.src = chrome.runtime.getURL('icon16.png');
    titleIcon.style.cssText = 'width:14px;height:14px;vertical-align:middle;margin-right:5px;border-radius:3px;';
    title.append(titleIcon, 'LazyGitHub · PR Info');

    function makeInfoRow(icon, label, value, url) {
      const row = document.createElement('div');
      row.className = 'wd-info-row';

      const iconEl = document.createElement('span');
      iconEl.className = 'wd-info-row-icon';
      iconEl.textContent = icon;

      const content = document.createElement('div');
      content.className = 'wd-info-row-content';

      const labelEl = document.createElement('div');
      labelEl.className = 'wd-info-row-label';
      labelEl.textContent = label;

      const valueEl = document.createElement('div');
      valueEl.className = 'wd-info-row-value';
      valueEl.textContent = value;
      valueEl.title = `Open ${label} page`;
      valueEl.addEventListener('click', () => window.open(url, '_blank'));

      content.append(labelEl, valueEl);
      row.append(iconEl, content);
      return row;
    }

    body.append(title);
    if (CONFIG.prInfoBoxShowRepo    ?? true) body.append(makeInfoRow('📦', 'Repo',   info.repo,    info.repoUrl));
    if (CONFIG.prInfoBoxShowAuthor  ?? true) body.append(makeInfoRow('👤', 'Author', info.author,  info.authorUrl));
    if (CONFIG.prInfoBoxShowHead    ?? true) body.append(makeInfoRow('⬆', 'Head',   info.headRef, info.headUrl));

    if (CONFIG.prInfoBoxShowBase ?? true) {
      const baseRow = makeInfoRow('⬇', 'Base', info.baseRef, info.baseUrl);
      const refreshBtn = document.createElement('button');
      refreshBtn.className = 'wd-info-refresh-btn';
      refreshBtn.title = 'Refresh base to latest commit';
      refreshBtn.textContent = '↻';
      refreshBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (refreshBtn.disabled) return;
        refreshBtn.classList.add('wd-spinning');
        refreshBtn.disabled = true;
        chrome.runtime.sendMessage({ type: 'refreshPrBase', repo: pr.repo, prNumber: pr.prNumber }, res => {
          refreshBtn.classList.remove('wd-spinning');
          refreshBtn.disabled = false;
          if (res?.success) {
            showToast({ success: true,  message: 'Base branch refreshed to latest commit.' });
          } else {
            showToast({ success: false, message: `Failed to refresh base: ${res?.error ?? 'unknown error'}` });
          }
        });
      });
      baseRow.appendChild(refreshBtn);
      body.appendChild(baseRow);
    }

    box.append(sideTab, body);
    document.body.appendChild(box);
  });
}

// ── Retry buttons (failed checks in the PR merge box, failed runs in the Actions list) ──
//
// The DOM only tells us *where* a check / run is linked (anchors carrying the id in their
// href). Whether it actually failed comes from the API via background.js, so a GitHub
// status-icon redesign cannot break detection. Results are cached per page for
// RETRY_CACHE_TTL so the MutationObserver-driven scan() doesn't hammer the API.
//
// Surfaces deliberately NOT covered: the run detail page and the PR Checks tab, where
// GitHub already offers its own "Re-run" controls.

const RETRY_CACHE_TTL = 30_000;
const RETRY_POLL_INTERVAL = 1000;   // ms between API polls after an accepted re-run
const RETRY_POLL_TIMEOUT  = 12_000; // give up polling and reload anyway after this long
const retryState = { key: null, fetchedAt: 0, data: null, inFlight: false };
const RETRYABLE  = ['failure', 'timed_out', 'cancelled'];

// Octicons (16px): sync, check, x.
const RETRY_ICONS = {
  sync:    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z"/></svg>',
  check:   '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/></svg>',
  x:       '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/></svg>',
};

function parseRepoFromUrl() {
  return location.pathname.match(/^\/([^/]+\/[^/]+)/)?.[1] ?? null;
}

// Repository Actions list: /owner/repo/actions or /owner/repo/actions/workflows/<file>.
function parseActionsListPage() {
  const m = location.pathname.match(/^\/([^/]+\/[^/]+)\/actions(?:\/workflows\/[^/]+)?\/?$/);
  return m ? { repo: m[1] } : null;
}

// Check-run id (= Actions job id) from any of the link shapes GitHub uses for a check:
//   /owner/repo/pull/N/checks?check_run_id=123
//   /owner/repo/actions/runs/456/job/123
//   /owner/repo/runs/123            (legacy "Details" link — must not match /actions/runs/456)
function checkRunIdFromHref(href) {
  return href.match(/[?&]check_run_id=(\d+)/)?.[1]
      ?? href.match(/\/actions\/runs\/\d+\/job\/(\d+)/)?.[1]
      ?? href.match(/(?<!\/actions)\/runs\/(\d+)(?:[?#]|$)/)?.[1]
      ?? null;
}

// 'failed' → re-run only what failed; 'all' → re-run the whole workflow run.
const retryMode = () => (CONFIG.retryMode === 'all' ? 'all' : 'failed');

// Fetch-through-cache. `apply(data)` runs with the current DOM once data is available,
// either immediately (cache hit) or from the response callback. A failed lookup is cached
// too, so a token without `actions` access doesn't trigger a request on every mutation.
function withRetryData(key, msg, apply) {
  const fresh = retryState.key === key && Date.now() - retryState.fetchedAt < RETRY_CACHE_TTL;
  if (fresh) { apply(retryState.data); return; }
  if (retryState.inFlight) return; // the in-flight callback will apply to the DOM as it is then
  retryState.inFlight = true;
  chrome.runtime.sendMessage(msg, res => {
    retryState.inFlight  = false;
    retryState.key       = key;
    retryState.fetchedAt = Date.now();
    retryState.data      = res?.success ? res : { success: false, error: res?.error };
    if (!res?.success) console.debug('[LazyGitHub] retry lookup failed:', res?.error);
    apply(retryState.data);
    // While this request was in flight the user may have navigated (GitHub keeps the JS
    // context alive); other scans bailed on `inFlight`, so give the current page a pass now.
    injectRetryButtons();
  });
}

// True when `anchors` need (re)processing: a different page than the cached one, a stale
// cache, or anchors that appeared after the last snapshot (GitHub live-updates rows).
function retryNeedsWork(key, anchors) {
  if (anchors.length === 0) return false;
  if (retryState.key !== key) return true;
  if (Date.now() - retryState.fetchedAt >= RETRY_CACHE_TTL) return true;
  const stamp = String(retryState.fetchedAt);
  return anchors.some(a => a.dataset.wdRetryStamp !== stamp);
}
const stampAnchor = a => { a.dataset.wdRetryStamp = String(retryState.fetchedAt); };

function makeRetryBtn({ title, retryId, onClick }) {
  const btn = document.createElement('button');
  btn.type              = 'button';
  btn.className         = 'wd-retry-btn';
  btn.innerHTML         = RETRY_ICONS.sync;
  btn.title             = title;
  btn.setAttribute('aria-label', title);
  btn.dataset.wdRetryId = retryId;
  btn.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    if (!btn.disabled) onClick(btn);
  });
  // Some buttons sit inside a link; keep middle-clicks from opening it in a new tab.
  btn.addEventListener('auxclick', e => { e.preventDefault(); e.stopPropagation(); });
  return btn;
}

// Swap the icon in place (it is always the button's first child).
const setRetryIcon = (btn, name) => {
  if (btn.firstElementChild?.tagName === 'svg') btn.firstElementChild.remove(); // icon is always first
  btn.insertAdjacentHTML('afterbegin', RETRY_ICONS[name]);
};

// GitHub's own live updates lag well behind the API after a re-run, so we reload the page
// ourselves — but only once the API reflects the new attempt (or after RETRY_POLL_TIMEOUT),
// otherwise the reloaded page would still show the old red state.
function reloadWhenRetryRegistered(isRegistered) {
  const started = Date.now();
  const tick = () => isRegistered(yes => {
    if (yes || Date.now() - started >= RETRY_POLL_TIMEOUT) location.reload();
    else setTimeout(tick, RETRY_POLL_INTERVAL);
  });
  setTimeout(tick, RETRY_POLL_INTERVAL);
}

// `isRegistered(cb)` asks background whether the re-run is visible yet and calls cb(bool).
function runRetry(btn, msg, successToast, isRegistered) {
  if (!TOKEN_CONFIGURED) {
    showToast({ success: false, message: 'GitHub token not set up yet — opening LazyGitHub settings.' });
    chrome.runtime.sendMessage({ type: 'openOptions', reason: 'no-token' });
    return;
  }
  const originalTitle = btn.title;
  btn.disabled = true;
  btn.title    = 'Retrying…';
  btn.classList.add('wd-loading');
  chrome.runtime.sendMessage(msg, res => {
    btn.classList.remove('wd-loading');
    if (res?.success) {
      btn.classList.add('wd-success');
      setRetryIcon(btn, 'check');
      btn.title     = 'Queued';
      showToast({ success: true, message: `${successToast} Reloading once GitHub picks it up…`, duration: RETRY_POLL_TIMEOUT + 2000 });
      // No cache reset here: the page reloads once the re-run registers, and a refetch in
      // the meantime would pull the tick out from under the user.
      reloadWhenRetryRegistered(isRegistered);
    } else {
      btn.classList.add('wd-failure');
      setRetryIcon(btn, 'x');
      btn.title     = 'Re-run request failed';
      showToast({ success: false, message: `Retry failed: ${res?.error ?? 'unknown error'}` });
      setTimeout(() => {
        btn.classList.remove('wd-failure');
        setRetryIcon(btn, 'sync');
        btn.title     = originalTitle;
        btn.disabled  = false;
      }, 3000);
    }
  });
}

// Buttons are unique per retryId on a page, so existence checks are global.
const findRetryBtn   = retryId => document.querySelector(`.wd-retry-btn[data-wd-retry-id="${retryId}"]`);
const removeRetryBtn = retryId => findRetryBtn(retryId)?.remove();

// Insert a button via `insert(btn)` unless one with this retryId already exists.
function placeRetryBtn(retryId, makeBtn, insert) {
  if (findRetryBtn(retryId)) return;
  insert(makeBtn());
}

// PR conversation page (merge box / timeline): one icon per failed GitHub Actions check.
//
// Two ways to find a check in the DOM:
//  • Links carrying a check-run id (timeline events, older merge box layouts) — matched by id.
//  • Rows of the current React merge box, which show "<workflow> / <job> (<event>)" as plain
//    text and tuck the details link into a "…" menu — matched by that displayed name.
function injectPrRetryButtons(pr) {
  if (/\/pull\/\d+\/checks/.test(location.pathname)) return; // GitHub has its own Re-run there

  const section   = document.querySelector('section[aria-label="Checks"]');
  const rowTitles = [...document.querySelectorAll('[class*="StatusCheckRow-module__title__"]')];
  const anchorCandidates = [...document.querySelectorAll('a[href*="check_run_id="], a[href*="/runs/"]')]
    .filter(a => !a.closest('.wd-action-menu, #wd-info-box'))
    .map(a => ({ a, jobId: checkRunIdFromHref(a.getAttribute('href') ?? '') }))
    .filter(c => c.jobId);

  const units = [...rowTitles, ...anchorCandidates.map(c => c.a), ...(section ? [section] : [])];
  const key   = `pr:${pr.repo}#${pr.prNumber}`;
  if (!retryNeedsWork(key, units)) return;

  withRetryData(key, { type: 'getFailedChecks', repo: pr.repo, prNumber: pr.prNumber }, data => {
    const checks     = data.checks ?? [];
    const failedById = new Map(checks.map(c => [c.jobId, c]));
    const btnFor = (check, jobId) => {
      const whole = retryMode() === 'all' && check.runId;
      return makeRetryBtn({
        title:   whole ? `Re-run the whole workflow for "${check.name}"` : `Re-run "${check.name}"`,
        retryId: `job-${jobId}`,
        onClick: btn => runRetry(
          btn,
          whole ? { type: 'rerunRun', repo: pr.repo, runId: check.runId } : { type: 'rerunJob', repo: pr.repo, jobId },
          whole ? `Re-running the workflow for "${check.name}".` : `Re-running "${check.name}".`,
          prChecksRegistered(pr, [jobId]),
        ),
      });
    };

    // 1. Links: GitHub may link a check twice (name + "Details"); attach to the last link per check.
    const lastAnchorFor = new Map();
    for (const c of anchorCandidates) lastAnchorFor.set(c.jobId, c.a);
    for (const { a, jobId } of anchorCandidates) {
      stampAnchor(a);
      const check = failedById.get(jobId);
      if (!check) { removeRetryBtn(`job-${jobId}`); continue; }
      if (lastAnchorFor.get(jobId) !== a) continue;
      placeRetryBtn(`job-${jobId}`, () => btnFor(check, jobId), btn => a.after(btn));
    }

    // 2. Merge box rows without links: match the displayed name, append the icon to the heading.
    for (const title of rowTitles) {
      stampAnchor(title);
      const heading = title.querySelector('[class*="StatusCheckRow-module__titleHeader__"]') ?? title;
      if (anchorCandidates.some(c => heading.contains(c.a))) continue; // already handled via its link
      const check    = matchCheckByDisplayName(checks, headingText(heading));
      const existing = heading.querySelector('.wd-retry-btn');
      if (!check) { existing?.remove(); continue; }
      if (existing && existing.dataset.wdRetryId !== `job-${check.jobId}`) existing.remove();
      placeRetryBtn(`job-${check.jobId}`, () => { const b = btnFor(check, check.jobId); b.classList.add('wd-retry-inline'); return b; }, btn => heading.append(btn));
    }

    if (section) stampAnchor(section);
    injectPrRetryAllButton(pr, checks);
  });
}

// Heading text without the status description GitHub nests next to it, or our own icon.
function headingText(heading) {
  const clone = heading.cloneNode(true);
  clone.querySelectorAll('.wd-retry-btn').forEach(el => el.remove());
  clone.querySelectorAll('[class*="StatusCheckRow-module__titleDescription__"]').forEach(el => el.remove());
  return clone.textContent.replace(/\s+/g, ' ').trim();
}

// Merge box rows read "<workflow> / <job> (<event>)"; try the most specific form first.
function matchCheckByDisplayName(checks, text) {
  if (!text) return null;
  const jobPart = text.replace(/\s*\([^)]*\)$/, '').split(' / ').pop();
  return checks.find(c => c.workflowName && text === `${c.workflowName} / ${c.name} (${c.event})`)
      ?? checks.find(c => c.workflowName && text === `${c.workflowName} / ${c.name}`)
      ?? checks.find(c => text === c.name)
      ?? checks.find(c => jobPart === c.name)
      ?? null;
}

// A re-run is "registered" for the PR once the previously failed check-run ids are no longer
// among the latest check runs (the new attempt replaces them).
const prChecksRegistered = (pr, jobIds) => cb =>
  chrome.runtime.sendMessage({ type: 'getFailedChecks', repo: pr.repo, prNumber: pr.prNumber }, res =>
    cb(!!res?.success && !jobIds.some(id => (res.checks ?? []).some(c => c.jobId === id))));

// For a run, once its status is no longer "completed" (queued / in_progress).
const runRegistered = (repo, runId) => cb =>
  chrome.runtime.sendMessage({ type: 'getRunStatuses', repo, runIds: [runId] }, res =>
    cb(!!res?.success && !!res.statuses?.[runId] && res.statuses[runId].status !== 'completed'));

// Merge box section header: one labelled button that re-runs every failed check at once.
// The header stays visible even when the checks list is collapsed, so this is the
// "retry at the top" entry point. Only the new React merge box exposes the section.
function injectPrRetryAllButton(pr, checks) {
  const RETRY_ALL_ID = 'pr-all';
  const runIds  = [...new Set(checks.map(c => c.runId).filter(Boolean))];
  const section = document.querySelector('section[aria-label="Checks"]');
  const toggle  = section?.querySelector('button[aria-label="Collapse checks"], button[aria-label="Expand checks"]');
  if (!toggle || runIds.length === 0) { removeRetryBtn(RETRY_ALL_ID); return; }

  const whole = retryMode() === 'all';
  const n     = checks.length;
  placeRetryBtn(RETRY_ALL_ID, () => {
    const btn = makeRetryBtn({
      title:   whole
        ? `Re-run all checks (every job of ${runIds.length} workflow run${runIds.length === 1 ? '' : 's'})`
        : `Re-run ${n} failed check${n === 1 ? '' : 's'}`,
      retryId: RETRY_ALL_ID,
    onClick: btn => runRetry(
      btn,
      { type: 'rerunRuns', repo: pr.repo, runIds, mode: retryMode() },
      whole ? 'Re-running all checks.' : `Re-running ${n} failed check${n === 1 ? '' : 's'}.`,
      prChecksRegistered(pr, checks.map(c => c.jobId)),
    ),
    });
    btn.classList.add('wd-retry-all'); // header variant: above GitHub's overlay toggle
    return btn;
  }, btn => {
    // Header children: [content, overlay toggle button, chevron]. Sit right before the chevron.
    const chevron = toggle.nextElementSibling;
    (chevron ?? toggle).before(btn);
  });
}

// /actions and /actions/workflows/<file>: one icon per failed run, right after its title text.
function injectRunListRetryButtons({ repo }) {
  const candidates = [...document.querySelectorAll('a[href*="/actions/runs/"]')]
    .map(a => ({ a, runId: (a.getAttribute('href') ?? '').match(/\/actions\/runs\/(\d+)(?:[?#]|$)/)?.[1] }))
    .filter(c => c.runId);
  const runIds = [...new Set(candidates.map(c => c.runId))];
  const key    = `runs:${repo}`;
  if (!retryNeedsWork(key, candidates.map(c => c.a))) return;
  // The cache is per repo, but "All workflows" and each per-workflow list show different
  // runs (and live updates add new ones). Refetch when any run on screen isn't covered.
  if (retryState.key === key && runIds.some(id => !(retryState.data?.statuses ?? {})[id])) retryState.fetchedAt = 0;
  withRetryData(key, { type: 'getRunStatuses', repo, runIds }, data => {
    const statuses = data.statuses ?? {};
    for (const { a, runId } of candidates) {
      stampAnchor(a);
      const st = statuses[runId];
      const failed = st?.status === 'completed' && RETRYABLE.includes(st.conclusion);
      if (!failed) { removeRetryBtn(`run-${runId}`); continue; }

      const whole = retryMode() === 'all';
      placeRetryBtn(`run-${runId}`, () => makeRetryBtn({
        title:   whole ? 'Re-run all jobs' : 'Re-run failed jobs',
        retryId: `run-${runId}`,
        onClick: btn => runRetry(
          btn,
          { type: whole ? 'rerunRun' : 'rerunFailedJobs', repo, runId },
          whole ? 'Re-running all jobs.' : 'Re-running failed jobs.',
          runRegistered(repo, runId),
        ),
      }), btn => {
        // Last thing inside the title link, right after the (truncating) title text — the
        // same spot as in the merge box. The button's click handler cancels the navigation.
        btn.classList.add('wd-retry-inline');
        a.append(btn);
        // GitHub sizes the title with `width:100% !important`, an inline `min-width:95%`
        // and css-truncate's 125px max-width: the max-width keeps the table cell from
        // growing with long text, the percentage min-width does the real sizing. Keep that
        // scheme but make the minimum "the text's own width, capped to the row", so the
        // icon hugs short titles and long ones still truncate.
        const title = btn.previousElementSibling;
        if (title && title.tagName !== 'svg') {
          const range = document.createRange();
          range.selectNodeContents(title);
          const textWidth = Math.ceil(range.getBoundingClientRect().width) + 2;
          title.style.setProperty('width', 'auto', 'important');
          // 72px = GitHub's status icon + our 24px icon with their margins.
          title.style.minWidth = `min(${textWidth}px, calc(100% - 72px))`;
        }
      });
    }
  });
}

function injectRetryButtons() {
  if (!(CONFIG.showRetryButtons ?? true)) return;
  if (!TOKEN_CONFIGURED || isRepoExcluded()) return;

  const pr = parsePrFromUrl();
  if (pr) { injectPrRetryButtons(pr); return; }

  const list = parseActionsListPage();
  if (list) injectRunListRetryButtons(list);
}

// ── Scanner (runs on load + DOM changes) ─────────────────────────────────────

function scan() {
  // GitHub's page-swapping navigation (Turbo) replaces <body> and can prune <head>; make
  // sure our stylesheet and body flag survive before (re)injecting anything.
  if (!styleEl.isConnected) document.head.appendChild(styleEl);
  document.body.classList.toggle('wd-token-missing', !TOKEN_CONFIGURED);
  attachPrActionButtons();
  document.querySelectorAll('a[href*="#issuecomment-"]').forEach(attachCommentButtons);
  injectInfoBox();
  injectRetryButtons();
}

// Remove every button LazyGitHub injected and clear the guard flags that mark a
// container/link as "already processed", so the next scan() rebuilds them from the
// current CONFIG. Lets config edits apply to open PR tabs without a page reload.
function teardownInjectedButtons() {
  // Header buttons carry .wd-build-btn / .wd-btn; sticky-header buttons are styled
  // inline and only marked with data-wd-build — remove all three.
  document.querySelectorAll('.wd-btn, .wd-build-btn, [data-wd-build]').forEach(el => el.remove());
  document.querySelector('.wd-action-menu')?.remove();
  document.querySelectorAll('[data-wd-build-btn]').forEach(el => delete el.dataset.wdBuildBtn);
  document.querySelectorAll('[data-wd-attached]').forEach(el => delete el.dataset.wdAttached);
  document.querySelectorAll('.wd-retry-btn').forEach(el => el.remove());
  document.querySelectorAll('[data-wd-retry-stamp]').forEach(el => delete el.dataset.wdRetryStamp);
  retryState.fetchedAt = 0;
  // Drop the info box too so its row/visibility settings re-render on the next scan.
  document.getElementById('wd-info-box')?.remove();
  document.body.removeAttribute('data-wd-info-fetching');
}

function init() {
  chrome.storage.sync.get(['extensionConfig', 'githubToken'], data => {
    GLOBAL_CONFIG    = data.extensionConfig ?? DEFAULT_CONFIG;
    CONFIG           = resolveConfig(GLOBAL_CONFIG, parseRepoFromUrl() ?? '');
    TOKEN_CONFIGURED = !!data.githubToken;
    scan();
    // Observe <html>, not <body>: Turbo navigation swaps the body element wholesale, which
    // would leave a body-scoped observer watching a detached node.
    new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
    // Belt and braces for navigations that swap the body: rescan when Turbo says it's done.
    for (const evt of ['turbo:load', 'turbo:render', 'pjax:end', 'popstate']) {
      window.addEventListener(evt, () => scan());
    }
  });

  chrome.storage.onChanged.addListener(changes => {
    if (changes.extensionConfig) {
      GLOBAL_CONFIG = changes.extensionConfig.newValue ?? DEFAULT_CONFIG;
      CONFIG        = resolveConfig(GLOBAL_CONFIG, parseRepoFromUrl() ?? '');
      // Rebuild injected buttons from the new config — no page reload needed.
      teardownInjectedButtons();
      scan();
    }
    if (changes.githubToken) {
      TOKEN_CONFIGURED = !!changes.githubToken.newValue;
      document.body.classList.toggle('wd-token-missing', !TOKEN_CONFIGURED);
    }
  });
}

init();
