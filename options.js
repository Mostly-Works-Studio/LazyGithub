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

const tokenSection       = document.getElementById('token-section');
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

tokenSection.querySelector('.feedback-section-header').addEventListener('click', () => {
  tokenSection.classList.toggle('collapsed');
});

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
  tokenSection.classList.add('collapsed');
}

function showTokenInput(showCancel = false) {
  tokenConfiguredBox.hidden = true;
  tokenInputSection.hidden  = false;
  tokenBadge.hidden         = true;
  cancelBtn.hidden          = !showCancel;
  clearValidationStatus();
  tokenSection.classList.remove('collapsed');
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

const groupsList              = document.getElementById('groups-list');
const reposList               = document.getElementById('repos-list');
const prActionsList           = document.getElementById('pr-actions-list');
const commentActionsList      = document.getElementById('comment-actions-list');
const tokenPresetsList        = document.getElementById('token-presets-list');
const extractionPatternsHint  = document.getElementById('extraction-patterns-hint');
const extractionPatternsBody  = document.getElementById('extraction-patterns-body');
const addTokenPresetBtn       = document.getElementById('add-token-preset-btn');
const saveConfigBtn           = document.getElementById('save-config-btn');
const discardConfigBtn        = document.getElementById('discard-config-btn');
const resetConfigBtn          = document.getElementById('reset-config-btn');
const configStatusMsg         = document.getElementById('config-status-msg');
const groupsCount             = document.getElementById('groups-count');

function revealExtractionPatterns() {
  extractionPatternsHint.hidden = true;
  extractionPatternsBody.hidden = false;
  addTokenPresetBtn.hidden      = false;
}

document.getElementById('show-extraction-patterns-link').addEventListener('click', e => {
  e.preventDefault();
  revealExtractionPatterns();
});

document.getElementById('additional-settings-section').querySelector('.feedback-section-header').addEventListener('click', () => {
  document.getElementById('additional-settings-section').classList.toggle('collapsed');
});

document.getElementById('repo-filter-section').querySelector('.form-section-header').addEventListener('click', () => {
  document.getElementById('repo-filter-section').classList.toggle('collapsed');
});
const reposCount         = document.getElementById('repos-count');

let lastSavedConfig = DEFAULT_CONFIG;

function showConfigStatus(message, type) {
  configStatusMsg.textContent = message;
  configStatusMsg.className   = `status ${type}`;
  setTimeout(() => { configStatusMsg.textContent = ''; configStatusMsg.className = 'status'; }, 4000);
}

function switchToTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('tab-btn--active', b.dataset.tab === tabName)
  );
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.hidden = p.id !== `tab-${tabName}`;
  });
}

function updateTabCounts() {
  const gc = groupsList.querySelectorAll('.override-card').length;
  const rc = reposList.querySelectorAll('.override-card').length;
  groupsCount.textContent = gc > 0 ? String(gc) : '';
  reposCount.textContent  = rc > 0 ? String(rc)  : '';
}

// ── DOM utilities ─────────────────────────────────────────────────────────────

function mkDiv(cls) { const d = document.createElement('div'); if (cls) d.className = cls; return d; }
function mkEl(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls)  e.className   = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function mkInput(value, mono, placeholder) {
  const i = document.createElement('input');
  i.type = 'text';
  i.className = 'field-input' + (mono ? ' field-input--mono' : '');
  i.value = value ?? '';
  if (placeholder) i.placeholder = placeholder;
  return i;
}
function mkSmallBtn(text, cls, handler) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = cls; b.textContent = text;
  b.addEventListener('click', handler);
  return b;
}
function mkCheckbox(checked) {
  const c = document.createElement('input');
  c.type = 'checkbox'; c.checked = checked;
  return c;
}
function mkCheckboxLabel(cb, text) {
  const l = document.createElement('label');
  l.className = 'checkbox-label';
  const span = document.createElement('span');
  span.textContent = ' ' + text;
  l.append(cb, span);
  return l;
}
function buildColorPair(initColor) {
  const group = mkDiv('color-group');
  const picker = document.createElement('input');
  picker.type = 'color'; picker.value = initColor;
  const hex = mkInput(initColor, true, '#000000');
  hex.maxLength = 7;
  picker.addEventListener('input', () => { hex.value = picker.value; });
  hex.addEventListener('input', () => { if (/^#[0-9a-fA-F]{6}$/.test(hex.value)) picker.value = hex.value; });
  group.append(picker, hex);
  return { group, hex };
}
function fieldLabelEl(text, hint) {
  const el = mkEl('span', 'field-label', text);
  if (hint) { const i = mkEl('i', 'field-hint', 'i'); i.title = hint; el.append(i); }
  return el;
}
function cardRow(label, ...content) {
  const r = mkDiv('field-row');
  r.append(typeof label === 'string' ? mkEl('span', 'field-label', label) : label, ...content);
  return r;
}
function cardRowTop(label, ...content) {
  const r = cardRow(label, ...content); r.classList.add('field-row--top'); return r;
}

// ── KV editor helpers ─────────────────────────────────────────────────────────

function makeKvRow(key, val) {
  const row = mkDiv('kv-row');
  const k = mkInput(key, true, 'key');    k.className += ' kv-key';
  const v = mkInput(val,  true, '{token} or value'); v.className += ' kv-val';
  const rm = mkSmallBtn('×', 'btn btn-danger btn-xs', () => row.remove());
  row.append(k, v, rm);
  return row;
}
function readKvList(listEl) {
  const obj = {};
  for (const r of listEl.querySelectorAll('.kv-row')) {
    const k = r.querySelector('.kv-key').value.trim();
    const v = r.querySelector('.kv-val').value;
    if (k) obj[k] = v;
  }
  return obj;
}
function populateKvList(listEl, obj) {
  listEl.innerHTML = '';
  for (const [k, v] of Object.entries(obj ?? {})) listEl.appendChild(makeKvRow(k, v));
}

// ── Tag editor helpers ────────────────────────────────────────────────────────

function makeTagRow(val) {
  const row = mkDiv('tag-row');
  const input = mkInput(val, true, 'value or regex');
  const rm = mkSmallBtn('×', 'btn btn-danger btn-xs', () => row.remove());
  row.append(input, rm);
  return row;
}
function readTagList(listEl) {
  return [...listEl.querySelectorAll('input')].map(i => i.value.trim()).filter(Boolean);
}
function populateTagList(listEl, arr) {
  listEl.innerHTML = '';
  for (const v of arr ?? []) listEl.appendChild(makeTagRow(v));
}

// ── Drag-sort helper ──────────────────────────────────────────────────────────
// Enables drag-to-reorder on direct children of listEl matching itemSelector.
// Dragging must start on a .drag-handle element inside the item.

let _dragSrc = null, _dragList = null;

function enableDragSort(listEl, itemSelector) {
  listEl.addEventListener('dragstart', e => {
    if (!e.target.closest('.drag-handle')) return;
    const item = e.target.closest(itemSelector);
    if (!item || item.parentElement !== listEl) return;
    _dragSrc = item; _dragList = listEl;
    item.classList.add('wd-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', '');
  });

  listEl.addEventListener('dragover', e => {
    if (_dragList !== listEl) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const item = e.target.closest(itemSelector);
    if (!item || item.parentElement !== listEl || item === _dragSrc) return;
    listEl.querySelectorAll(itemSelector).forEach(el => el.classList.remove('drag-before', 'drag-after'));
    const mid = item.getBoundingClientRect().top + item.getBoundingClientRect().height / 2;
    item.classList.add(e.clientY < mid ? 'drag-before' : 'drag-after');
  });

  listEl.addEventListener('dragleave', e => {
    if (!listEl.contains(e.relatedTarget))
      listEl.querySelectorAll(itemSelector).forEach(el => el.classList.remove('drag-before', 'drag-after'));
  });

  listEl.addEventListener('drop', e => {
    if (_dragList !== listEl || !_dragSrc) return;
    e.preventDefault();
    const item = e.target.closest(itemSelector);
    if (!item || item.parentElement !== listEl || item === _dragSrc) return;
    const before = item.classList.contains('drag-before');
    listEl.querySelectorAll(itemSelector).forEach(el => el.classList.remove('drag-before', 'drag-after'));
    if (before) item.before(_dragSrc); else item.after(_dragSrc);
    _dragSrc = _dragList = null;
  });

  listEl.addEventListener('dragend', () => {
    if (_dragSrc) _dragSrc.classList.remove('wd-dragging');
    listEl.querySelectorAll(itemSelector).forEach(el => el.classList.remove('drag-before', 'drag-after'));
    _dragSrc = _dragList = null;
  });
}

// ── Conditional rules building block ─────────────────────────────────────────
// initValue: string | [{if?, value}] | null/undefined
// _read(): returns a plain string when there is exactly one unconditional rule,
// otherwise returns [{if?, value}] — backend handles both forms.

function makeConditionalRules(initValue, { valuePlaceholder = 'value' } = {}) {
  const wrap = mkDiv('');

  const normalize = v => {
    if (!v && v !== 0) return [{ if: '', value: '' }];
    if (typeof v === 'string') return [{ if: '', value: v }];
    if (Array.isArray(v)) return v.map(r => ({ if: r.if ?? '', value: r.value ?? r.file ?? '' }));
    return [{ if: '', value: '' }];
  };

  // Conditional mode only when there are actual conditions (not just a single fallback rule)
  const isInitConditional = Array.isArray(initValue) &&
    (initValue.length > 1 || (initValue.length === 1 && initValue[0].if));

  const normalized = normalize(initValue);
  const initSimpleVal = isInitConditional ? '' : (normalized[0]?.value ?? '');

  // ── Simple mode: single text input ──
  const simpleInput = mkInput(initSimpleVal, true, valuePlaceholder);

  // ── Conditional mode: rule list ──
  const ruleList = mkDiv('cond-rule-list');

  const makeRuleRow = ({ if: cond, value: val }) => {
    const row = mkDiv('cond-rule-row');
    const handle = mkEl('span', 'drag-handle', '⠿'); handle.draggable = true;
    const condInput = mkInput(cond, true, 'condition (blank = fallback)');
    condInput.className += ' cond-if';
    const arrow = mkEl('span', 'cond-arrow', '→');
    const valInput = mkInput(val, true, valuePlaceholder);
    valInput.className += ' cond-val';
    const rm = mkSmallBtn('×', 'btn btn-danger btn-xs', () => row.remove());
    row.append(handle, condInput, arrow, valInput, rm);
    return row;
  };

  if (isInitConditional) {
    for (const r of normalized) ruleList.append(makeRuleRow(r));
  }

  const addBtn = mkSmallBtn('+ Add Rule', 'btn btn-secondary btn-xs',
    () => ruleList.append(makeRuleRow({ if: '', value: '' })));
  const note = mkEl('p', 'sub-note', '');
  note.innerHTML = 'Condition: <code>tokenName:contains:VALUE</code> or <code>tokenName:notContains:VALUE</code>. Rules are tried in order — leave blank for a fallback.';

  const condBlock = mkDiv('');
  condBlock.append(ruleList, addBtn, note);
  enableDragSort(ruleList, '.cond-rule-row');

  // ── Toggle link ──
  const toggleLink = document.createElement('button');
  toggleLink.type = 'button';
  toggleLink.className = 'cond-mode-toggle';

  let isConditional = isInitConditional;

  const applyMode = () => {
    simpleInput.hidden = isConditional;
    condBlock.hidden   = !isConditional;
    toggleLink.textContent = isConditional ? '× Use simple value' : '⚡ Conditional routing';
  };
  applyMode();

  toggleLink.addEventListener('click', () => {
    if (!isConditional) {
      // Simple → Conditional: seed rule list with current plain value
      ruleList.innerHTML = '';
      ruleList.append(makeRuleRow({ if: '', value: simpleInput.value }));
    } else {
      // Conditional → Simple: use fallback rule (last rule without a condition) or first rule's value
      const rows = [...ruleList.querySelectorAll('.cond-rule-row')];
      const fallback = [...rows].reverse().find(r => !r.querySelector('.cond-if').value.trim());
      simpleInput.value = (fallback ?? rows[0])?.querySelector('.cond-val').value ?? '';
    }
    isConditional = !isConditional;
    applyMode();
  });

  wrap.append(simpleInput, condBlock, toggleLink);

  wrap._read = () => {
    if (!isConditional) return simpleInput.value.trim();
    const rows = [...ruleList.querySelectorAll('.cond-rule-row')];
    const rules = rows.map(r => ({
      if:    r.querySelector('.cond-if').value.trim(),
      value: r.querySelector('.cond-val').value.trim(),
    }));
    if (rules.length === 1 && !rules[0].if) return rules[0].value;
    return rules.map(r => r.if ? { if: r.if, value: r.value } : { value: r.value });
  };

  return wrap;
}

// ── Source dropdown ───────────────────────────────────────────────────────────

const COMMENT_SOURCES = new Set(['commentBody', 'commentAuthor']);
const ALL_SOURCES = [
  { value: 'commentBody',   label: 'Comment body'      },
  { value: 'commentAuthor', label: 'Comment author'    },
  { value: 'prTitle',       label: 'PR title'          },
  { value: 'prBranch',      label: 'PR branch'         },
  { value: 'prNumber',      label: 'PR number'         },
  { value: 'prAuthor',      label: 'PR author'         },
  { value: 'repo',          label: 'Repo (owner/repo)' },
];

function buildSourceSelect(selected, allowCommentSources) {
  const sel = document.createElement('select');
  sel.className = 'field-select';
  for (const { value, label } of ALL_SOURCES) {
    if (!allowCommentSources && COMMENT_SOURCES.has(value)) continue;
    const opt = document.createElement('option');
    opt.value = value; opt.textContent = label;
    sel.append(opt);
  }
  sel.value = selected ?? (allowCommentSources ? 'commentBody' : 'prTitle');
  return sel;
}

// ── Token card (per-action token) ─────────────────────────────────────────────

function makeTokenCard(token, { allowCommentSources = true, expanded = false } = {}) {
  const { card, dot, name: nameInput } = makeActionCardShell(token.name || 'variableName', null, { draggable: false, expanded });
  dot.remove();
  nameInput.placeholder = 'variableName';
  nameInput.value = token.name ?? '';

  const sourceSel    = buildSourceSelect(token.source ?? (allowCommentSources ? 'commentBody' : 'prTitle'), allowCommentSources);
  const regexInput   = mkInput(token.regex   ?? '', true,  'optional pattern');
  const regexNote    = mkEl('p', 'sub-note', 'Optional — capture group 1 is the value. If absent, the full source value is used.');
  const defaultInput = mkInput(token.default ?? '', false, '');
  const skipList     = mkDiv('tag-list');
  populateTagList(skipList, token.skip);
  const skipAdd  = mkSmallBtn('+ Add', 'btn btn-secondary btn-xs', () => skipList.append(makeTagRow('')));
  const skipNote = mkEl('p', 'sub-note', 'If the extracted value matches any entry, the entire row is skipped and no action is triggered.');
  const skipWrap = mkDiv(''); skipWrap.append(skipList, skipAdd, skipNote);

  const body = mkDiv('deploy-card-body');
  body.append(
    cardRow(fieldLabelEl('Extract from', 'Which part of the PR context to read the value from'), sourceSel),
    cardRow(fieldLabelEl('Match pattern', 'Optional regex — capture group 1 becomes the token value. Leave blank to use the full source text'), regexInput),
    regexNote,
    cardRow(fieldLabelEl('Fallback value', 'Used when the pattern doesn\'t match or the source is empty'), defaultInput),
    cardRowTop(fieldLabelEl('Ignore if value is', 'Skip triggering an action for this match if the extracted value equals any of these entries'), skipWrap),
  );
  card.append(body);

  card._read = () => ({
    name:    nameInput.value.trim(),
    source:  sourceSel.value,
    regex:   regexInput.value.trim(),
    default: defaultInput.value.trim(),
    skip:    readTagList(skipList),
  });
  return card;
}

// ── Extraction pattern card (global patterns library) ─────────────────────────

function makeTokenPresetCard(preset, { expanded = false } = {}) {
  const { card, dot, name } = makeActionCardShell(preset.label || 'Pattern', '#6e7781', { draggable: false, expanded });
  dot.remove();
  const body = mkDiv('deploy-card-body');

  const labelInput = mkInput(preset.label ?? '', false, 'e.g. Build Version');
  labelInput.addEventListener('input', () => { name.value = labelInput.value || 'Pattern'; });
  const idInput    = mkInput(preset.id    ?? '', true,  'myVariable');
  idInput.dataset.field = 'id';
  const sourceSel  = buildSourceSelect(preset.source ?? 'commentBody', true);
  const regexInput = mkInput(preset.regex   ?? '', true,  '\\d{12}-...');
  regexInput.dataset.field = 'regex';
  const regexNote  = mkEl('p', 'sub-note', 'Optional — capture group 1 is the value. If absent, the full source is used.');
  const defaultInput = mkInput(preset.default ?? '', false, '');
  const skipList   = mkDiv('tag-list');
  populateTagList(skipList, preset.skip);
  const skipAdd  = mkSmallBtn('+ Add', 'btn btn-secondary btn-xs', () => skipList.append(makeTagRow('')));
  const skipNote = mkEl('p', 'sub-note', 'If the extracted value matches any entry, the row is skipped.');
  const skipWrap = mkDiv(''); skipWrap.append(skipList, skipAdd, skipNote);

  body.append(
    cardRow(fieldLabelEl('Display name', 'Name shown in the "Add token from…" dropdown when using this pattern in an action'), labelInput),
    cardRow(fieldLabelEl('Variable name', 'The name you\'ll reference in action fields as {variableName}'), idInput),
    cardRow(fieldLabelEl('Extract from', 'Which part of the PR context to read the value from'), sourceSel),
    cardRow(fieldLabelEl('Match pattern', 'Optional regex — capture group 1 becomes the token value. Leave blank to use the full source text'), regexInput),
    regexNote,
    cardRow(fieldLabelEl('Fallback value', 'Used when the pattern doesn\'t match or the source is empty'), defaultInput),
    cardRowTop(fieldLabelEl('Ignore if value is', 'Skip triggering an action for this match if the extracted value equals any of these entries'), skipWrap),
  );
  card.append(body);

  card._read = () => ({
    id:      idInput.value.trim(),
    label:   labelInput.value.trim(),
    source:  sourceSel.value,
    regex:   regexInput.value.trim(),
    default: defaultInput.value.trim(),
    skip:    readTagList(skipList),
  });
  return card;
}

// ── Add-token select (copy from preset or blank) ──────────────────────────────

function makeAddTokenSelect(tokenList, allowCommentSources) {
  const sel = document.createElement('select');
  sel.className = 'field-select';
  sel.style.cssText = 'width:auto; margin-top:4px;';

  const placeholder = document.createElement('option');
  placeholder.value = ''; placeholder.textContent = '+ Add extracted value…';
  sel.append(placeholder);

  const customOpt = document.createElement('option');
  customOpt.value = '__new__'; customOpt.textContent = 'New Custom Variable';
  sel.append(customOpt);

  sel.addEventListener('mousedown', e => {
    const presets = [...tokenPresetsList.querySelectorAll('.deploy-card')].map(c => c._read()).filter(p => p.id);
    if (presets.length === 0) {
      e.preventDefault();
      appendAndScroll(tokenList, makeTokenCard({}, { allowCommentSources, expanded: true }));
      return;
    }
  });

  sel.addEventListener('focus', () => {
    [...sel.querySelectorAll('.preset-opt')].forEach(o => o.remove());
    const presets = [...tokenPresetsList.querySelectorAll('.deploy-card')].map(c => c._read());
    for (const p of presets) {
      if (!p.id) continue;
      const opt = document.createElement('option');
      opt.value = '__preset__' + p.id;
      opt.textContent = p.label || p.id;
      opt.className = 'preset-opt';
      sel.append(opt);
    }
  });

  sel.addEventListener('change', () => {
    const val = sel.value;
    if (!val) return;

    let tokenData = {};
    if (val.startsWith('__preset__')) {
      const presetId = val.slice('__preset__'.length);
      const presets  = [...tokenPresetsList.querySelectorAll('.deploy-card')].map(c => c._read());
      const preset   = presets.find(p => p.id === presetId);
      if (preset) {
        tokenData = { name: preset.id, source: preset.source, regex: preset.regex, default: preset.default, skip: preset.skip };
      }
    }

    appendAndScroll(tokenList, makeTokenCard(tokenData, { allowCommentSources, expanded: true }));
    sel.value = '';
  });

  return sel;
}

// ── Button feedback section ───────────────────────────────────────────────────

function buildFeedbackSection(initFeedback, { isComment = false } = {}) {
  const fb = initFeedback ?? {};

  const pendingPh      = isComment ? 'Running…'                 : '⏳ Starting…';
  const successLabelPh = isComment ? '✓ {count} triggered'      : '✓ Done';
  const successToastPh = isComment ? 'leave blank for default'   : 'empty = no toast';
  const failureToastPh = '{error}';

  const pendingInput      = mkInput(fb.pending        ?? '', false, pendingPh);
  const successLabelInput = mkInput(fb.success?.label ?? '', false, successLabelPh);
  const successToastInput = mkInput(fb.success?.toast ?? '', false, successToastPh);
  const failureLabelInput = mkInput(fb.failure?.label ?? '', false, '✗ Failed');
  const failureToastInput = mkInput(fb.failure?.toast ?? '', false, failureToastPh);

  const successPair = mkDiv('feedback-pair');
  successPair.append(successLabelInput, mkEl('span', 'feedback-sep', 'toast'), successToastInput);

  const failurePair = mkDiv('feedback-pair');
  failurePair.append(failureLabelInput, mkEl('span', 'feedback-sep', 'toast'), failureToastInput);

  // Redirect select
  const redirectSel = document.createElement('select');
  redirectSel.className = 'field-select';
  const REDIRECT_OPTS = [
    ['none',           'Do nothing'],
    ['comment',        'Go to posted comment'],
    ['workflow_runs',  'Go to Actions tab'],
    ['deployments',    'Go to Deployments tab'],
  ];
  for (const [value, label] of REDIRECT_OPTS) {
    const opt = document.createElement('option');
    opt.value = value; opt.textContent = label;
    redirectSel.append(opt);
  }
  redirectSel.value = fb.success?.redirect ?? 'none';

  const note = mkEl('p', 'sub-note', '');
  note.innerHTML = '<code>{error}</code> = API error' + (isComment ? ', <code>{count}</code> = rows triggered' : '') + '. Empty fields use defaults.';

  const body = mkDiv('feedback-section-body');
  body.append(
    mkEl('p', 'feedback-subsection-title', 'Label & Toast'),
    cardRow(fieldLabelEl('Loading label', 'Text shown on the button while the action is in progress'), pendingInput),
    cardRowTop(fieldLabelEl('Success', 'Label: updates the button text on success. Toast: shows a popup notification — leave blank to hide it'), successPair),
    cardRowTop(fieldLabelEl('Failure', 'Label: updates button text on failure. Toast: shows the error notification. Use {error} to include the API error message'), failurePair),
    note,
    mkEl('p', 'feedback-subsection-title', 'Others'),
    cardRow(fieldLabelEl('After success, go to', 'Automatically navigate to another page in the same tab after a successful action'), redirectSel),
  );

  const chevron = mkEl('span', 'feedback-chevron', '▾');
  const header = mkDiv('feedback-section-header');
  header.append(chevron, document.createTextNode('Additional Settings'));

  const wrap = mkDiv('feedback-section collapsed');
  wrap.append(header, body);
  header.addEventListener('click', () => wrap.classList.toggle('collapsed'));

  return {
    el: wrap,
    read() {
      const pending = pendingInput.value.trim();
      const sl = successLabelInput.value.trim();
      const st = successToastInput.value.trim();
      const rd = (redirectSel.value && redirectSel.value !== 'none') ? redirectSel.value : '';
      const fl = failureLabelInput.value.trim();
      const ft = failureToastInput.value.trim();
      const result = {};
      if (pending) result.pending = pending;
      if (sl || st || rd) { result.success = {}; if (sl) result.success.label = sl; if (st) result.success.toast = st; if (rd) result.success.redirect = rd; }
      if (fl || ft) { result.failure = {}; if (fl) result.failure.label = fl; if (ft) result.failure.toast = ft; }
      return Object.keys(result).length > 0 ? result : undefined;
    },
  };
}

// ── Action card builders ──────────────────────────────────────────────────────

function randomActionName() {
  const NAMES = [
    'Alpha Automator','Auto Commenter','Capsule Deployer','Bravo Broadcast','Slack Spammer',
    'The Akatsuki Ping','Charlie Commander','Bug Broadcaster','Survey Scout','Delta Dispatcher',
    'Script Dispatch','Section 9 Security','Echo Event','Webhook Wizard','Black Knight Build',
    'Foxtrot Fire','Pipeline Panic','Jujutsu Judgment','Golf Gatekeeper','Conflict Creator',
    'Gotei 13 Guard','Hotel Host','Push Protocol','Straw Hat Sail','India Igniter',
    'Action Alert','Phantom Ping','Juliet Jumper','Blade Runner','NERV Launch',
    'Kilo Kickstart','Logic Trigger','Night Raid Drop','Lima Launcher','Thread Trigger',
    'Odd Jobs Courier','Mike Messenger','Deployment Drone','S-Class Strike','November Notifier',
    'Wave Weaver','Demon Slayer Slash','Oscar Orchestrator','Binary Blast','Ghoul Gossip',
    'Papa Publisher','JSON Jetpack','Gurren Lagann Pierce','Quebec Queuer','Chatty Bot',
    'Bebop Flyby','Romeo Router','Root Runner','Hunter Exam','Sierra Shipper',
    'Core Commander','Overlord Order','Tango Targeter','Data Dump','Agency Agent',
    'Uniform Uplink','Localhost Liftoff','Blue Lock Striker','Victor Valve','Release Rebel',
    'Sharingan Spy','Whiskey Webhook','Garbage Disposal','Otaku Operator','X-Ray Examiner',
    'Geass Command','Script Scraper','Yankee Yalper','One Punch Push','Alchemist Transmute',
    'Zulu Zenith','Shinigami Slash','Hokage Herald','Apex Activator','Steins;Gate Diver',
    'Delta Driver','Titan Trample','Hacker Hook','Charlie Compiler','Maverick Monitor',
    'Zodiac Zero','Echo Enforcer','Iron Ship','Saiyan Surge','Bravo Bot',
    'Blackout Blast','Ninja Notice','Foxtrot Firewall','Phoenix Phoenix','Tango Talker',
    'Whiskey Warden','Raptor Run','Buggy Bomb','Omega Output','Infinite Tsukuyomi Deploy',
  ];
  return NAMES[Math.floor(Math.random() * NAMES.length)];
}

function randomActionColor() {
  const h = Math.random();
  const s = 0.65, l = 0.42;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = t => {
    t = ((t % 1) + 1) % 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  return '#' + [h + 1/3, h, h - 1/3]
    .map(t => Math.round(hue2rgb(t) * 255).toString(16).padStart(2, '0'))
    .join('');
}

const ACTION_TEMPLATE = () => ({
  trigger:    'prHeader',
  label:      randomActionName(),
  color:      randomActionColor(),
  filter:     { hideOnStates: [], authors: [] },
  tokens:     [],
  onMultiple: 'all',
  action:     { type: 'comment', comment: '' },
});

function makeActionCardShell(label, color, { draggable = true, expanded = false } = {}) {
  const card = mkDiv(expanded ? 'deploy-card' : 'deploy-card collapsed');
  const header = mkDiv('deploy-card-header');
  const chevron = mkEl('span', 'card-chevron', '▾');
  if (draggable) { const handle = mkEl('span', 'drag-handle', '⠿'); handle.draggable = true; header.append(handle); }
  const dot = mkEl('span', 'deploy-card-dot'); dot.style.background = color;
  const name = document.createElement('input');
  name.type = 'text'; name.className = 'deploy-card-name';
  name.value = label || ''; name.placeholder = 'Action';
  const nameWrap = mkDiv('deploy-card-name-wrap');
  nameWrap.appendChild(name);
  const rm = mkSmallBtn('× Remove', 'btn btn-danger btn-xs', () => card.remove());
  header.append(chevron, dot, nameWrap, rm);
  card.append(header);
  header.addEventListener('click', e => {
    if (e.target.closest('button, input, select, label')) return;
    card.classList.toggle('collapsed');
  });
  return { card, header, dot, name };
}

function makeActionCard(action, { fixedTrigger = null, expanded = false } = {}) {
  const initTrigger = fixedTrigger ?? action.trigger ?? 'prHeader';
  const { card, header, dot, name } = makeActionCardShell(action.label ?? 'Action', action.color ?? '#c95f0a', { expanded });
  const dupBtn = mkSmallBtn('Duplicate', 'btn btn-secondary btn-xs', () => { const c = card._read(); const dup = makeActionCard({ ...c, label: c.label + ' Copy' }, { fixedTrigger, expanded: true }); card.after(dup); dup.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); flashHighlight(dup); });
  header.lastElementChild.before(dupBtn);
  const body = mkDiv('deploy-card-body');

  // Trigger radio — only shown in override sections where trigger is not fixed by section
  let triggerCa, isComment;
  if (fixedTrigger !== null) {
    isComment = () => fixedTrigger === 'comment';
  } else {
    const triggerName = 'trigger-' + Math.random().toString(36).slice(2);
    const triggerPr = document.createElement('input'); triggerPr.type = 'radio'; triggerPr.name = triggerName; triggerPr.value = 'prHeader';
    triggerCa = document.createElement('input'); triggerCa.type = 'radio'; triggerCa.name = triggerName; triggerCa.value = 'comment';
    if (initTrigger === 'comment') triggerCa.checked = true; else triggerPr.checked = true;
    const triggerGroup = mkDiv('checkbox-group');
    triggerGroup.append(mkCheckboxLabel(triggerPr, 'PR Header'), mkCheckboxLabel(triggerCa, 'Comment'));
    body.append(cardRow('Trigger', triggerGroup));
    isComment = () => triggerCa.checked;
  }

  // Label — editable inline in header
  name.dataset.field = 'label';

  // Color — picker overlaid on header dot
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.value = action.color ?? '#c95f0a';
  colorInput.title = 'Change color';
  colorInput.style.cssText = 'position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%;padding:0;border:none;';
  dot.style.position = 'relative'; dot.style.cursor = 'pointer';
  dot.appendChild(colorInput);
  colorInput.addEventListener('input', () => { dot.style.background = colorInput.value; });

  // Filter: hideOnStates
  const PR_STATES = ['open', 'draft', 'merged', 'closed'];
  const hideChecks = PR_STATES.map(s => mkCheckbox((action.filter?.hideOnStates ?? []).includes(s)));
  const hideGroup = mkDiv('checkbox-group');
  hideChecks.forEach((cb, i) => hideGroup.append(mkCheckboxLabel(cb, PR_STATES[i])));

  // Filter: authors (comment trigger only — row hidden when trigger = prHeader)
  const afList = mkDiv('tag-list');
  populateTagList(afList, action.filter?.authors);
  const afAdd  = mkSmallBtn('+ Add', 'btn btn-secondary btn-xs', () => afList.append(makeTagRow('')));
  const afNote = mkEl('p', 'sub-note', 'Usernames or regex. Empty = show for all authors.');
  const afWrap = mkDiv(''); afWrap.append(afList, afAdd, afNote);
  const afRow  = cardRowTop(fieldLabelEl('Restrict to authors', 'Only show this button for PRs or comments from these GitHub usernames or regex patterns. Leave empty to show for all'), afWrap);

  // onMultiple
  const omName  = 'om-' + Math.random().toString(36).slice(2);
  const omFirst = document.createElement('input'); omFirst.type = 'radio'; omFirst.name = omName; omFirst.value = 'first';
  const omAll   = document.createElement('input'); omAll.type   = 'radio'; omAll.name   = omName; omAll.value   = 'all';
  if ((action.onMultiple ?? 'all') === 'first') omFirst.checked = true; else omAll.checked = true;
  const omGroup = mkDiv('on-multiple-group');
  omGroup.append(mkCheckboxLabel(omAll, 'All matches — trigger once per extracted row'), mkCheckboxLabel(omFirst, 'First match only'));

  // Tokens
  const allowCommentSources = initTrigger === 'comment';
  const tokenList  = mkDiv('token-list');
  for (const t of action.tokens ?? []) tokenList.append(makeTokenCard(t, { allowCommentSources }));
  const addTokenSel = makeAddTokenSelect(tokenList, allowCommentSources);
  const tokensNote  = mkEl('p', 'sub-note', 'Extract values from context. commentBody and commentAuthor sources only work for Comment-trigger actions.');
  const tokensWrap  = mkDiv(''); tokensWrap.append(tokenList, addTokenSel, tokensNote);

  const actionForm = buildActionFormEl(action.action);
  const hideRow = cardRow(fieldLabelEl('Hide button when PR is', 'Don\'t show this button when the PR is in any of these states'), hideGroup);
  const fbSection  = buildFeedbackSection(action.feedback, { isComment: initTrigger === 'comment' });
  const othersTitle = [...fbSection.el.querySelectorAll('.feedback-subsection-title')]
    .find(el => el.textContent === 'Others');
  const omRow = cardRow(fieldLabelEl('If multiple matches', 'When token extraction finds multiple rows in the comment, trigger once per match (All) or only the first (First)'), omGroup);
  othersTitle.after(omRow);
  omRow.after(afRow);
  afRow.after(hideRow);

  body.append(
    cardRowTop(fieldLabelEl('Extract values', 'Define named tokens pulled from PR context — use {tokenName} as placeholders in your action fields'), tokensWrap),
    actionForm.el,
    fbSection.el,
  );
  card.append(body);

  const syncTriggerUI = () => {};
  if (fixedTrigger === null) {
    triggerCa.addEventListener('change', syncTriggerUI);
    body.querySelector(`input[value="prHeader"]`)?.addEventListener('change', syncTriggerUI);
  }
  syncTriggerUI();

  card._read = () => ({
    trigger:    fixedTrigger ?? (isComment() ? 'comment' : 'prHeader'),
    label:      name.value.trim(),
    color:      colorInput.value,
    filter: {
      hideOnStates: PR_STATES.filter((s, i) => hideChecks[i].checked),
      authors:      readTagList(afList),
    },
    tokens:     [...tokenList.querySelectorAll('.token-card')].map(c => c._read()),
    onMultiple: omFirst.checked ? 'first' : 'all',
    action:     actionForm.read(),
    feedback:   fbSection.read(),
  });
  return card;
}

// ── Section form builders (used in Global tab AND override cards) ─────────────

function buildActionFormEl(initAction) {
  const action = initAction ?? { type: 'comment', comment: '' };
  const wrap = mkDiv('');

  const sel = document.createElement('select'); sel.className = 'field-select';
  [['comment','Post PR comment'],['workflow','Dispatch workflow'],['repositoryDispatch','Repository dispatch'],['deployment','Create deployment']]
    .forEach(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = l; sel.append(o); });
  sel.value = action.type ?? 'comment';
  wrap.append(cardRow(fieldLabelEl('What to do', 'Choose the type of GitHub action to trigger when this button is clicked'), sel));

  // comment
  const commentRules = makeConditionalRules(
    action.type === 'comment' ? (action.comment ?? '') : '',
    { valuePlaceholder: 'LazyGitHub in action' }
  );
  const commentSub = mkDiv('action-subform');
  commentSub.dataset.field = 'action-comment';
  commentSub.append(cardRowTop(fieldLabelEl('Comment body', 'The text of the GitHub comment to post. Use {placeholders} for dynamic values'), commentRules));

  // workflow — normalize old `files: [{if, file}]` to new `file: string | [{if?, value}]`
  const initFile = (() => {
    if (action.type !== 'workflow') return '';
    if (action.file !== undefined) return action.file;
    if (Array.isArray(action.files)) return action.files.map(r => ({ if: r.if, value: r.file ?? '' }));
    return '';
  })();
  const fileRules = makeConditionalRules(initFile, { valuePlaceholder: 'deploy.yaml' });
  const wfList = mkDiv('kv-list');
  if (action.type === 'workflow') populateKvList(wfList, action.inputs);
  const wfAdd = mkSmallBtn('+ Add Input', 'btn btn-secondary btn-xs', () => wfList.append(makeKvRow('', '')));
  const wfTokenNote = mkEl('p', 'sub-note', '');
  wfTokenNote.innerHTML = 'Fixed: <code>{prTitle}</code> <code>{branchName}</code> <code>{prNumber}</code> <code>{repo}</code> <code>{commentAuthor}</code> — plus any tokens defined above.';
  const wfInputsWrap = mkDiv(''); wfInputsWrap.append(wfList, wfAdd, wfTokenNote);
  const workflowSub = mkDiv('action-subform');
  workflowSub.dataset.field = 'action-file';
  workflowSub.append(cardRowTop(fieldLabelEl('Workflow filename', 'The .yml filename in .github/workflows/ to trigger (e.g. deploy.yml). Supports {placeholders} and conditional routing'), fileRules), cardRowTop(fieldLabelEl('Workflow inputs', 'Key-value pairs passed as workflow_dispatch inputs. Use {placeholders} in values'), wfInputsWrap));

  // repositoryDispatch
  const rdEventRules = makeConditionalRules(
    action.type === 'repositoryDispatch' ? (action.eventType ?? '') : '',
    { valuePlaceholder: 'build-triggered' }
  );
  const rdList = mkDiv('kv-list');
  if (action.type === 'repositoryDispatch') populateKvList(rdList, action.payload);
  const rdAdd = mkSmallBtn('+ Add Field', 'btn btn-secondary btn-xs', () => rdList.append(makeKvRow('', '')));
  const rdWrap = mkDiv(''); rdWrap.append(rdList, rdAdd);
  const rdSub = mkDiv('action-subform');
  rdSub.dataset.field = 'action-eventType';
  rdSub.append(cardRowTop(fieldLabelEl('Repository event', 'The event_type string sent with the repository_dispatch. Supports {placeholders} and conditional routing'), rdEventRules), cardRowTop(fieldLabelEl('Event payload', 'Key-value pairs sent in the client_payload object'), rdWrap));

  // deployment
  const depEnvRules = makeConditionalRules(
    action.type === 'deployment' ? (action.environment ?? '') : '',
    { valuePlaceholder: 'staging' }
  );
  const depList = mkDiv('kv-list');
  if (action.type === 'deployment') populateKvList(depList, action.payload);
  const depAdd = mkSmallBtn('+ Add Field', 'btn btn-secondary btn-xs', () => depList.append(makeKvRow('', '')));
  const depWrap = mkDiv(''); depWrap.append(depList, depAdd);
  const depSub = mkDiv('action-subform');
  depSub.dataset.field = 'action-environment';
  depSub.append(cardRowTop(fieldLabelEl('Target environment', 'Deployment environment name (e.g. staging, production). Supports {placeholders} and conditional routing'), depEnvRules), cardRowTop(fieldLabelEl('Deploy payload', 'Additional key-value pairs included in the deployment payload'), depWrap));

  const subs = { comment: commentSub, workflow: workflowSub, repositoryDispatch: rdSub, deployment: depSub };
  const sync = () => { for (const [t, s] of Object.entries(subs)) s.hidden = t !== sel.value; };
  sync(); sel.addEventListener('change', sync);
  wrap.append(commentSub, workflowSub, rdSub, depSub);

  return {
    el: wrap,
    read() {
      const t = sel.value;
      if (t === 'comment')            return { type: 'comment',            comment:     commentRules._read()  };
      if (t === 'workflow')           return { type: 'workflow',           file:        fileRules._read(),    inputs: readKvList(wfList) };
      if (t === 'repositoryDispatch') return { type: 'repositoryDispatch', eventType:   rdEventRules._read(), payload: readKvList(rdList) };
      return                                 { type: 'deployment',         environment: depEnvRules._read(),  payload: readKvList(depList) };
    }
  };
}

function buildPrActionsSectionEl(initActions) {
  const wrap = mkDiv('');
  const list = mkDiv('');
  for (const a of initActions ?? []) list.append(makeActionCard(a, { fixedTrigger: 'prHeader' }));
  enableDragSort(list, '.deploy-card');
  const addBtn1 = mkSmallBtn('+ Add Action', 'btn btn-secondary btn-xs', () => appendAndScroll(list, makeActionCard(ACTION_TEMPLATE(), { fixedTrigger: 'prHeader', expanded: true })));
  const addWrap1 = mkDiv('tab-actions'); addWrap1.style.marginBottom = '4px'; addWrap1.append(addBtn1);
  wrap.append(addWrap1, list);
  return { el: wrap, listEl: list, read: () => [...list.querySelectorAll('.deploy-card')].map(c => c._read()) };
}

function buildCommentActionsSectionEl(initActions) {
  const wrap = mkDiv('');
  const list = mkDiv('');
  const caTemplate = () => ({ ...ACTION_TEMPLATE(), trigger: 'comment', color: randomActionColor() });
  for (const a of initActions ?? []) list.append(makeActionCard(a, { fixedTrigger: 'comment' }));
  enableDragSort(list, '.deploy-card');
  const addBtn2 = mkSmallBtn('+ Add Action', 'btn btn-secondary btn-xs', () => appendAndScroll(list, makeActionCard(caTemplate(), { fixedTrigger: 'comment', expanded: true })));
  const addWrap2 = mkDiv('tab-actions'); addWrap2.style.marginBottom = '4px'; addWrap2.append(addBtn2);
  wrap.append(addWrap2, list);
  return { el: wrap, listEl: list, read: () => [...list.querySelectorAll('.deploy-card')].map(c => c._read()) };
}



// ── Override section (toggle + form body) ─────────────────────────────────────

function makeOverrideSection(title, isActive, buildFn, { initMode = 'replace', fillFromParent } = {}) {
  const section = mkDiv('override-section');

  const headerLabel = document.createElement('label');
  headerLabel.className = 'override-section-header';
  const toggle = mkCheckbox(isActive); toggle.className = 'override-toggle';
  const titleEl = mkEl('span', '', title);
  const badge = mkEl('span', 'inherited-badge', 'inherited'); badge.hidden = isActive;
  headerLabel.append(toggle, titleEl, badge);

  const body = buildFn();
  const bodyWrap = mkDiv('override-section-body');

  let modeReplace, modeExtend;
  if (fillFromParent) {
    const modeName = 'mode-' + Math.random().toString(36).slice(2);
    modeReplace = document.createElement('input'); modeReplace.type = 'radio'; modeReplace.name = modeName; modeReplace.value = 'replace';
    modeExtend  = document.createElement('input'); modeExtend.type  = 'radio'; modeExtend.name  = modeName; modeExtend.value = 'extend';
    if (initMode === 'extend') modeExtend.checked = true; else modeReplace.checked = true;

    const modeRow = mkDiv('override-mode-row');
    modeRow.append(mkCheckboxLabel(modeReplace, 'Replace inherited'), mkCheckboxLabel(modeExtend, 'Extend inherited'));

    const modeNote = mkEl('p', 'sub-note', '');
    const updateModeNote = () => {
      modeNote.textContent = modeExtend.checked
        ? 'Adds these actions after the parent\'s — only configure the extras here.'
        : 'Overrides the full list — parent actions are discarded.';
    };
    modeReplace.addEventListener('change', updateModeNote);
    modeExtend.addEventListener('change', updateModeNote);
    updateModeNote();

    bodyWrap.append(modeRow, modeNote);
  }

  bodyWrap.append(body.el);
  bodyWrap.hidden = !isActive;

  let firstEnable = !isActive;
  toggle.addEventListener('change', () => {
    bodyWrap.hidden = !toggle.checked;
    badge.hidden = toggle.checked;
    if (toggle.checked && firstEnable) {
      firstEnable = false;
      if (fillFromParent && !modeExtend?.checked) fillFromParent(body.listEl, false);
    }
  });

  section.append(headerLabel, bodyWrap);

  return {
    el:   section,
    isOn: () => toggle.checked,
    mode: () => modeExtend?.checked ? 'extend' : 'replace',
    read: () => body.read(),
  };
}

// ── Group / Repo cards ────────────────────────────────────────────────────────

// Returns the resolved action list for a given trigger type as seen by a repo
// (global → first matching group).
function resolveParentActions(trigger, repoName) {
  const isComment  = trigger === 'comment';
  const globalCfg  = formToGlobalConfig();
  let resolved     = (globalCfg.actions ?? []).filter(a => isComment ? a.trigger === 'comment' : a.trigger !== 'comment');
  for (const g of readGroupCards()) {
    const matched = (g.repos ?? []).some(p => {
      if (p === repoName) return true;
      try { return new RegExp(p).test(repoName); } catch { return false; }
    });
    if (matched) {
      const groupOverride = isComment ? g.config?.commentActions : g.config?.prActions;
      const groupMode     = isComment ? (g.config?.commentActionsMode ?? 'replace') : (g.config?.prActionsMode ?? 'replace');
      if (groupOverride !== undefined) {
        resolved = groupMode === 'extend' ? [...resolved, ...groupOverride] : [...groupOverride];
      }
      break;
    }
  }
  return resolved;
}

function makeGroupCard(groupData, { expanded = false } = {}) {
  const config = groupData?.config ?? {};
  const card = mkDiv(expanded ? 'override-card' : 'override-card collapsed');

  const header = mkDiv('override-card-header');
  const colChevron = mkEl('span', 'override-card-chevron', '▾');
  colChevron.addEventListener('click', () => card.classList.toggle('collapsed'));
  const groupHandle = mkEl('span', 'drag-handle', '⠿'); groupHandle.draggable = true;
  const nameInput = mkInput(groupData?.name ?? '', false, 'Group name');
  nameInput.className = 'override-card-repo-name';
  const nameWrap = mkDiv('override-card-name-wrap');
  nameWrap.appendChild(nameInput);
  const groupDupBtn = mkSmallBtn('Duplicate', 'btn btn-secondary btn-xs', () => {
    const { name, repos, config } = card._read();
    const dup = makeGroupCard({ name: name + ' Copy', repos, config }, { expanded: true });
    card.after(dup);
    dup.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    flashHighlight(dup);
    updateTabCounts();
  });
  header.append(colChevron, groupHandle, nameWrap, groupDupBtn, mkSmallBtn('× Remove', 'btn btn-danger btn-xs', () => { card.remove(); updateTabCounts(); }));

  const repoTagList = mkDiv('tag-list');
  populateTagList(repoTagList, groupData?.repos ?? []);
  const reposWrap = mkDiv('');
  reposWrap.append(repoTagList, mkSmallBtn('+ Add', 'btn btn-secondary btn-xs', () => repoTagList.append(makeTagRow(''))), mkEl('p', 'sub-note', 'Exact name or regex (e.g. myorg/js-.*)'));
  const reposSection = mkDiv('override-card-repos');
  reposSection.append(cardRowTop('Match repos', reposWrap));

  const praSec = makeOverrideSection('Actions on PR', 'prActions' in config, () => buildPrActionsSectionEl(config.prActions), {
    initMode: config.prActionsMode ?? 'replace',
    fillFromParent: (listEl, force) => {
      if (!force && listEl.querySelectorAll('.deploy-card').length > 0) return;
      listEl.innerHTML = '';
      for (const a of (formToGlobalConfig().actions ?? []).filter(a => a.trigger !== 'comment')) {
        listEl.append(makeActionCard(a, { fixedTrigger: 'prHeader' }));
      }
    },
  });
  const cmaSec = makeOverrideSection('Actions on PR Comment', 'commentActions' in config, () => buildCommentActionsSectionEl(config.commentActions), {
    initMode: config.commentActionsMode ?? 'replace',
    fillFromParent: (listEl, force) => {
      if (!force && listEl.querySelectorAll('.deploy-card').length > 0) return;
      listEl.innerHTML = '';
      for (const a of (formToGlobalConfig().actions ?? []).filter(a => a.trigger === 'comment')) {
        listEl.append(makeActionCard(a, { fixedTrigger: 'comment' }));
      }
    },
  });
  const overrides = mkDiv('');
  overrides.append(praSec.el, cmaSec.el);
  card.append(header, reposSection, overrides);

  card._read = () => {
    const repos = readTagList(repoTagList);
    const cfg = {};
    if (praSec.isOn()) {
      cfg.prActions = praSec.read();
      if (praSec.mode() === 'extend') cfg.prActionsMode = 'extend';
    }
    if (cmaSec.isOn()) {
      cfg.commentActions = cmaSec.read();
      if (cmaSec.mode() === 'extend') cfg.commentActionsMode = 'extend';
    }
    return { name: nameInput.value.trim(), repos, config: cfg };
  };
  return card;
}

function makeRepoCard(repoName, repoConfig, { expanded = false } = {}) {
  const config = repoConfig ?? {};
  const card = mkDiv(expanded ? 'override-card' : 'override-card collapsed');

  const header = mkDiv('override-card-header');
  const repoChevron = mkEl('span', 'override-card-chevron', '▾');
  repoChevron.addEventListener('click', () => card.classList.toggle('collapsed'));
  const nameInput = mkInput(repoName ?? '', false, 'owner/repo-name');
  nameInput.className = 'override-card-repo-name field-input--mono';
  const nameWrap = mkDiv('override-card-name-wrap');
  nameWrap.appendChild(nameInput);
  const repoDupBtn = mkSmallBtn('Duplicate', 'btn btn-secondary btn-xs', () => {
    const { name, config } = card._read();
    const dup = makeRepoCard(name + ' Copy', config, { expanded: true });
    card.after(dup);
    dup.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    flashHighlight(dup);
    updateTabCounts();
  });
  header.append(repoChevron, nameWrap, repoDupBtn, mkSmallBtn('× Remove', 'btn btn-danger btn-xs', () => { card.remove(); updateTabCounts(); }));

  const praSec = makeOverrideSection('PR Actions', 'prActions' in config, () => buildPrActionsSectionEl(config.prActions), {
    initMode: config.prActionsMode ?? 'replace',
    fillFromParent: (listEl, force) => {
      if (!force && listEl.querySelectorAll('.deploy-card').length > 0) return;
      listEl.innerHTML = '';
      for (const a of resolveParentActions('prHeader', nameInput.value.trim())) {
        listEl.append(makeActionCard(a, { fixedTrigger: 'prHeader' }));
      }
    },
  });
  const cmaSec = makeOverrideSection('Comment Actions', 'commentActions' in config, () => buildCommentActionsSectionEl(config.commentActions), {
    initMode: config.commentActionsMode ?? 'replace',
    fillFromParent: (listEl, force) => {
      if (!force && listEl.querySelectorAll('.deploy-card').length > 0) return;
      listEl.innerHTML = '';
      for (const a of resolveParentActions('comment', nameInput.value.trim())) {
        listEl.append(makeActionCard(a, { fixedTrigger: 'comment' }));
      }
    },
  });
  const overrides = mkDiv('');
  overrides.append(praSec.el, cmaSec.el);
  card.append(header, overrides);

  card._read = () => {
    const name = nameInput.value.trim();
    const cfg = {};
    if (praSec.isOn()) {
      cfg.prActions = praSec.read();
      if (praSec.mode() === 'extend') cfg.prActionsMode = 'extend';
    }
    if (cmaSec.isOn()) {
      cfg.commentActions = cmaSec.read();
      if (cmaSec.mode() === 'extend') cfg.commentActionsMode = 'extend';
    }
    return { name, config: cfg };
  };
  return card;
}

function readGroupCards() {
  return [...groupsList.querySelectorAll('.override-card')].map(c => c._read()).filter(g => g.repos.length > 0);
}

function readRepoCards() {
  const obj = {};
  for (const card of reposList.querySelectorAll('.override-card')) {
    const { name, config } = card._read();
    if (name) obj[name] = config;
  }
  return obj;
}

function loadGroupsFromConfig(groups) {
  groupsList.innerHTML = '';
  for (const g of groups ?? []) groupsList.append(makeGroupCard(g));
}

function loadReposFromConfig(repos) {
  reposList.innerHTML = '';
  for (const [name, config] of Object.entries(repos ?? {})) reposList.append(makeRepoCard(name, config));
}

// ── Add action buttons (Global tab) ──────────────────────────────────────────

function flashHighlight(el) {
  el.classList.remove('wd-highlight');
  void el.offsetWidth;
  el.classList.add('wd-highlight');
  el.addEventListener('animationend', () => el.classList.remove('wd-highlight'), { once: true });
}

function appendAndScroll(parent, el) {
  parent.appendChild(el);
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  flashHighlight(el);
  return el;
}

document.getElementById('add-pr-action-btn').addEventListener('click',      () => appendAndScroll(prActionsList, makeActionCard(ACTION_TEMPLATE(), { fixedTrigger: 'prHeader', expanded: true })));
document.getElementById('add-comment-action-btn').addEventListener('click', () => appendAndScroll(commentActionsList, makeActionCard({ ...ACTION_TEMPLATE(), trigger: 'comment', color: randomActionColor() }, { fixedTrigger: 'comment', expanded: true })));
document.getElementById('add-token-preset-btn').addEventListener('click',   () => appendAndScroll(tokenPresetsList, makeTokenPresetCard({}, { expanded: true })));

document.getElementById('repo-filter-add').addEventListener('click', () => document.getElementById('repo-filter-list').appendChild(makeTagRow('')));

function randomGroupName() {
  const NAMES = [
    'Alpha Tier','Null Pointers','Capsule Corp','Bravo Company','Stack Overflowers',
    'The Akatsuki','Charlie Syndicate','The Bug Hunters','Survey Corps','Delta Base',
    'Bitwise Bandits','Section 9','Echo Chambers','Code Wizards','Black Knights',
    'Foxtrot Fleet','Runtime Terror','Jujutsu Sorcerers','Golf Garrison','Merge Conflicts',
    'Gotei 13','Hotel Heavyweights','Git Pushers','Straw Hat Fleet','India Infantry',
    'Kernel Panic','Phantom Troupe','Juliet Junction','Cyber Samurai','NERV Elite',
    'Kilo Kingdom','Logic Bombs','Night Raid','Lima Lineup','Thread Pool',
    'Odd Jobs Gin','Mike Mavericks','Array Avengers','S-Class Heroes','November Network',
    'Synth Wave','Demon Slayer Corps','Oscar Outpost','Binary Beasts','Anteiku',
    'Papa Patrol','The JSON Juggernauts','Team Dai-Gurren','Quebec Vanguard','Script Kaddies',
    'Bebop Crew','Romeo Raiders','Root Access','Hunter Association','Sierra Systems',
    'Mainframe Monks','Ainz Ooal Gown','Tango Targets','Data Dropouts','Armed Detective Agency',
    'Uniform Unit','Localhost Legends','Blue Lock','Victor Vanguard','Dependency Hell',
    'Uchiha Uplink','Whiskey Tango','Garbage Collectors','Cyber Otakus','X-Ray Division',
    'Code Geass','Git Ghoul','Yankee Yard',"Saitama's Scripts",'Fullmetal Algos',
    'Zulu Dawn','Shinigami Scrapers','Matrix Hokages','Apex Unit','Steins;Gatekeepers',
    'Delta Drivers','Titan Battalion','Hunters x Hackers','Charlie Compilers','Maverick Division',
    'Zodiac Command','Echo Encryptors','Iron Citadel','Super Saiyan Coders','Bravo Botnet',
    'Blackout Brigade','Neon Ninjas','Foxtrot Firewalls','Phoenix Squadron','Tango Tech',
    'Whiskey Webmasters','Raptor Unit','The Bug-gy Clowns','Omega Vault','Infinite Tsukuyomi',
  ];
  return NAMES[Math.floor(Math.random() * NAMES.length)];
}

document.getElementById('add-group-btn').addEventListener('click', () => { appendAndScroll(groupsList, makeGroupCard({ name: randomGroupName(), repos: [], config: {} }, { expanded: true })); updateTabCounts(); });
document.getElementById('add-repo-btn').addEventListener('click',  () => { appendAndScroll(reposList, makeRepoCard('', {}, { expanded: true })); updateTabCounts(); });

// Enable drag sort on all static list containers (event delegation — works for dynamically added items)
enableDragSort(prActionsList,      '.deploy-card');
enableDragSort(commentActionsList, '.deploy-card');
enableDragSort(groupsList,         '.override-card');

// ── Form ↔ Config (Global tab) ────────────────────────────────────────────────

function configToForm(config) {
  // Repo filter
  const filter = config.repoFilter ?? { mode: 'exclude', patterns: config.excludedRepos ?? [] };
  const modeRadio = document.querySelector(`input[name="repo-filter-mode"][value="${filter.mode}"]`);
  if (modeRadio) modeRadio.checked = true;
  populateTagList(document.getElementById('repo-filter-list'), filter.patterns);

  // Split actions by trigger into the two visual sections
  const prActions      = (config.actions ?? []).filter(a => a.trigger !== 'comment');
  const commentActions = (config.actions ?? []).filter(a => a.trigger === 'comment');
  prActionsList.innerHTML = '';
  for (const a of prActions) prActionsList.appendChild(makeActionCard(a, { fixedTrigger: 'prHeader' }));
  commentActionsList.innerHTML = '';
  for (const a of commentActions) commentActionsList.appendChild(makeActionCard(a, { fixedTrigger: 'comment' }));

  // Extraction Patterns
  tokenPresetsList.innerHTML = '';
  const patterns = config.tokenPresets ?? [];
  for (const p of patterns) tokenPresetsList.appendChild(makeTokenPresetCard(p));
  const hasPatterns     = patterns.length > 0;
  const hasFilterRules  = (config.repoFilter?.patterns ?? []).length > 0;
  if (hasPatterns) {
    revealExtractionPatterns();
  }
  if (hasPatterns || hasFilterRules) {
    document.getElementById('additional-settings-section').classList.remove('collapsed');
  }
  if (hasFilterRules) {
    document.getElementById('repo-filter-section').classList.remove('collapsed');
  }
}

function formToGlobalConfig() {
  const repoFilterMode = document.querySelector('input[name="repo-filter-mode"]:checked')?.value ?? 'exclude';
  const prActions      = [...prActionsList.querySelectorAll('.deploy-card')].map(c => c._read());
  const commentActions = [...commentActionsList.querySelectorAll('.deploy-card')].map(c => c._read());
  return {
    repoFilter: {
      mode:     repoFilterMode,
      patterns: readTagList(document.getElementById('repo-filter-list')),
    },
    actions:      [...prActions, ...commentActions],
    tokenPresets: [...tokenPresetsList.querySelectorAll('.deploy-card')].map(c => c._read()),
  };
}

function loadConfigIntoEditors(config) {
  const { groups = [], repos = {} } = config;
  configToForm(config);
  loadGroupsFromConfig(groups);
  loadReposFromConfig(repos);
  updateTabCounts();
}


// ── Tab switching ─────────────────────────────────────────────────────────────

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchToTab(btn.dataset.tab));
});

// ── Load from storage ─────────────────────────────────────────────────────────

chrome.storage.sync.get('extensionConfig', ({ extensionConfig }) => {
  lastSavedConfig = extensionConfig ?? DEFAULT_CONFIG;
  loadConfigIntoEditors(lastSavedConfig);
});

// ── JSON export / import modal ────────────────────────────────────────────────

function showJsonModal() {
  const currentConfig = {
    ...formToGlobalConfig(),
    groups: readGroupCards(),
    repos:  readRepoCards(),
  };

  const overlay = document.createElement('div');
  overlay.className = 'json-modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'json-modal';

  const header = document.createElement('div');
  header.className = 'json-modal-header';
  const title = document.createElement('h3');
  title.textContent = 'Config JSON';
  const closeBtn = mkSmallBtn('×', 'btn btn-secondary btn-sm', () => overlay.remove());
  header.append(title, closeBtn);

  const hint = mkEl('p', 'hint', 'Copy to share with teammates. To import, paste a config JSON and click Apply — it loads into the form for review before saving.');

  const textarea = document.createElement('textarea');
  textarea.value = JSON.stringify(currentConfig, null, 2);
  textarea.spellcheck = false;

  const actions = mkDiv('json-modal-actions');

  const copyBtn = document.createElement('button');
  copyBtn.className = 'btn btn-secondary';
  copyBtn.textContent = 'Copy to clipboard';
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(textarea.value);
    } catch {
      textarea.select(); document.execCommand('copy');
    }
    copyBtn.textContent = '✓ Copied!';
    setTimeout(() => { copyBtn.textContent = 'Copy to clipboard'; }, 2000);
  });

  const statusEl = mkEl('span', 'status', '');

  const applyBtn = document.createElement('button');
  applyBtn.className = 'btn btn-primary';
  applyBtn.textContent = 'Apply';
  applyBtn.addEventListener('click', () => {
    let parsed;
    try { parsed = JSON.parse(textarea.value); }
    catch (err) {
      statusEl.textContent = `Invalid JSON — ${err.message}`;
      statusEl.className = 'status error';
      return;
    }
    const err = validateConfig(parsed);
    if (err) {
      statusEl.textContent = `Validation error: ${err.message}`;
      statusEl.className = 'status error';
      return;
    }
    loadConfigIntoEditors(parsed);
    statusEl.textContent = 'Loaded into form. Review and click Save Config to persist.';
    statusEl.className = 'status success';
  });

  actions.append(copyBtn, applyBtn, statusEl);
  modal.append(header, hint, textarea, actions);
  overlay.append(modal);

  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  const onKey = e => { if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); overlay.remove(); } };
  document.addEventListener('keydown', onKey);

  document.body.append(overlay);
  textarea.select();
}

document.getElementById('json-config-btn').addEventListener('click', showJsonModal);

// ── Save ──────────────────────────────────────────────────────────────────────

function isConditionalEmpty(v) {
  if (!v && v !== 0) return true;
  if (typeof v === 'string') return !v.trim();
  if (Array.isArray(v)) return v.length === 0 || v.every(r => !(r.value ?? '').trim());
  return true;
}

// Returns null if valid, or { message, tab } describing the first problem found.
function validateConfig(config) {
  const presets  = config.tokenPresets ?? [];
  const actions  = config.actions      ?? [];
  const groups   = config.groups       ?? [];
  const patterns = config.repoFilter?.patterns ?? [];

  for (let i = 0; i < presets.length; i++) {
    const p = presets[i];
    if (!p.id?.trim()) return { message: `Extraction Pattern ${i+1}: variable name cannot be empty.`, tab: 'global', locator: { listId: 'token-presets-list', cardIndex: i, field: 'id' } };
    if (p.regex) { try { new RegExp(p.regex); } catch (e) { return { message: `Extraction Pattern "${p.id}": invalid match pattern — ${e.message}`, tab: 'global', locator: { listId: 'token-presets-list', cardIndex: i, field: 'regex' } }; } }
  }

  const prActions      = actions.filter(a => a.trigger !== 'comment');
  const commentActions = actions.filter(a => a.trigger === 'comment');

  for (let i = 0; i < prActions.length; i++) {
    const a = prActions[i];
    if (!a.label?.trim()) return { message: `Actions on PR ${i+1}: label cannot be empty.`, tab: 'global', locator: { listId: 'pr-actions-list', cardIndex: i, field: 'label' } };
    if (!/^#[0-9a-fA-F]{6}$/.test(a.color)) return { message: `Actions on PR ${i+1}: invalid color hex.`, tab: 'global', locator: { listId: 'pr-actions-list', cardIndex: i, field: 'color' } };
    for (let ti = 0; ti < (a.tokens ?? []).length; ti++) {
      if (!a.tokens[ti].name) return { message: `Actions on PR ${i+1}, Variable ${ti+1}: variable name cannot be empty.`, tab: 'global', locator: { listId: 'pr-actions-list', cardIndex: i } };
      if (a.tokens[ti].regex) { try { new RegExp(a.tokens[ti].regex); } catch (e) { return { message: `Actions on PR ${i+1}, Variable "${a.tokens[ti].name}": invalid match pattern — ${e.message}`, tab: 'global', locator: { listId: 'pr-actions-list', cardIndex: i } }; } }
    }
    const act = a.action ?? {};
    if (act.type === 'comment'            && isConditionalEmpty(act.comment))    return { message: `Actions on PR ${i+1}: comment body cannot be empty.`,      tab: 'global', locator: { listId: 'pr-actions-list', cardIndex: i, field: 'action-comment' } };
    if (act.type === 'workflow'           && isConditionalEmpty(act.file))        return { message: `Actions on PR ${i+1}: workflow filename cannot be empty.`, tab: 'global', locator: { listId: 'pr-actions-list', cardIndex: i, field: 'action-file' } };
    if (act.type === 'repositoryDispatch' && isConditionalEmpty(act.eventType))   return { message: `Actions on PR ${i+1}: repository event cannot be empty.`, tab: 'global', locator: { listId: 'pr-actions-list', cardIndex: i, field: 'action-eventType' } };
    if (act.type === 'deployment'         && isConditionalEmpty(act.environment)) return { message: `Actions on PR ${i+1}: target environment cannot be empty.`, tab: 'global', locator: { listId: 'pr-actions-list', cardIndex: i, field: 'action-environment' } };
  }

  for (let i = 0; i < commentActions.length; i++) {
    const a = commentActions[i];
    if (!a.label?.trim()) return { message: `Actions on PR Comment ${i+1}: label cannot be empty.`, tab: 'global', locator: { listId: 'comment-actions-list', cardIndex: i, field: 'label' } };
    if (!/^#[0-9a-fA-F]{6}$/.test(a.color)) return { message: `Actions on PR Comment ${i+1}: invalid color hex.`, tab: 'global', locator: { listId: 'comment-actions-list', cardIndex: i, field: 'color' } };
    for (let ti = 0; ti < (a.tokens ?? []).length; ti++) {
      if (!a.tokens[ti].name) return { message: `Actions on PR Comment ${i+1}, Variable ${ti+1}: variable name cannot be empty.`, tab: 'global', locator: { listId: 'comment-actions-list', cardIndex: i } };
      if (a.tokens[ti].regex) { try { new RegExp(a.tokens[ti].regex); } catch (e) { return { message: `Actions on PR Comment ${i+1}, Variable "${a.tokens[ti].name}": invalid match pattern — ${e.message}`, tab: 'global', locator: { listId: 'comment-actions-list', cardIndex: i } }; } }
    }
    const act = a.action ?? {};
    if (act.type === 'comment'            && isConditionalEmpty(act.comment))    return { message: `Actions on PR Comment ${i+1}: comment body cannot be empty.`,      tab: 'global', locator: { listId: 'comment-actions-list', cardIndex: i, field: 'action-comment' } };
    if (act.type === 'workflow'           && isConditionalEmpty(act.file))        return { message: `Actions on PR Comment ${i+1}: workflow filename cannot be empty.`, tab: 'global', locator: { listId: 'comment-actions-list', cardIndex: i, field: 'action-file' } };
    if (act.type === 'repositoryDispatch' && isConditionalEmpty(act.eventType))   return { message: `Actions on PR Comment ${i+1}: repository event cannot be empty.`, tab: 'global', locator: { listId: 'comment-actions-list', cardIndex: i, field: 'action-eventType' } };
    if (act.type === 'deployment'         && isConditionalEmpty(act.environment)) return { message: `Actions on PR Comment ${i+1}: target environment cannot be empty.`, tab: 'global', locator: { listId: 'comment-actions-list', cardIndex: i, field: 'action-environment' } };
  }

  for (const p of patterns) {
    try { new RegExp(p); } catch (e) { return { message: `Invalid repo filter pattern "${p}": ${e.message}`, tab: 'global' }; }
  }

  for (let i = 0; i < groups.length; i++) {
    for (const pattern of (groups[i].repos ?? [])) {
      try { new RegExp(pattern); } catch (e) { return { message: `Invalid repo pattern "${pattern}": ${e.message}`, tab: 'groups', locator: { listId: 'groups-list', cardIndex: i } }; }
    }
  }

  return null;
}


function highlightValidationError(err) {
  if (!err) return;
  switchToTab(err.tab);
  showConfigStatus(err.message, 'error');
  if (!err.locator) return;

  const { listId, cardIndex, field } = err.locator;
  const list = document.getElementById(listId);
  if (!list) return;
  const cards = [...list.children].filter(el =>
    el.classList.contains('deploy-card') || el.classList.contains('override-card')
  );
  const card = cards[cardIndex];
  if (!card) return;

  // Expand
  card.classList.remove('collapsed');

  // Find specific field or fall back to card-level
  const fieldEl = field ? card.querySelector(`[data-field="${field}"]`) : null;

  // Clear any previous error on this card
  card.querySelectorAll('.validation-error').forEach(el => el.classList.remove('validation-error'));
  card.classList.remove('card-error');
  card.querySelector('.inline-error-msg')?.remove();

  if (fieldEl) {
    fieldEl.classList.add('validation-error');
    fieldEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else {
    card.classList.add('card-error');
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Inline error message — insert after header
  const msg = document.createElement('p');
  msg.className = 'inline-error-msg';
  msg.textContent = err.message;
  const header = card.querySelector('.deploy-card-header, .override-card-header');
  if (header) header.after(msg);
  else card.prepend(msg);

  // Auto-clear on any edit within the card
  const clearError = () => {
    fieldEl?.classList.remove('validation-error');
    card.classList.remove('card-error');
    msg.remove();
    card.removeEventListener('input', clearError);
    card.removeEventListener('change', clearError);
  };
  card.addEventListener('input', clearError);
  card.addEventListener('change', clearError);
}

const saveConfigBtn_el = document.getElementById('save-config-btn');
saveConfigBtn_el.addEventListener('click', () => {
  const globalPart = formToGlobalConfig();
  const groupsPart = readGroupCards();
  const reposPart  = readRepoCards();
  const fullConfig = { ...globalPart, groups: groupsPart, repos: reposPart };

  const err = validateConfig(fullConfig);
  if (err) { highlightValidationError(err); return; }

  chrome.storage.sync.set({ extensionConfig: fullConfig }, () => {
    lastSavedConfig = fullConfig;
    updateTabCounts();
    showConfigStatus('Config saved. Reload your GitHub tab for changes to take effect.', 'success');
  });
});

// ── Discard / Reset ───────────────────────────────────────────────────────────

document.getElementById('discard-config-btn').addEventListener('click', () => {
  loadConfigIntoEditors(lastSavedConfig);
  showConfigStatus('Changes discarded.', 'success');
});

document.getElementById('reset-config-btn').addEventListener('click', () => {
  loadConfigIntoEditors(DEFAULT_CONFIG);
  chrome.storage.sync.remove('extensionConfig', () => {
    showConfigStatus('Reset to defaults.', 'success');
  });
});
