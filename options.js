// ── Open-reason banner ────────────────────────────────────────────────────────

const openReasonBanner = document.getElementById('open-reason-banner');
const openReasonText   = document.getElementById('open-reason-text');

const OPEN_REASON_MESSAGES = {
  'no-token':       'A LazyGitHub button was clicked, but no GitHub token is configured yet. Add your token below to start using the extension.',
  'not-configured': 'A LazyGitHub button was clicked, but that action hasn\'t been set up yet. Configure it below to start using it.',
};

const reason = new URLSearchParams(location.search).get('reason');
if (reason && OPEN_REASON_MESSAGES[reason]) {
  openReasonText.textContent  = OPEN_REASON_MESSAGES[reason];
  openReasonBanner.hidden     = false;
}

// ── Stack name pool ───────────────────────────────────────────────────────────

const STACK_NAMES = [
  'Alpha Assembly','The Boilerplates','Capsule Command','Bravo Battery',
  'Pipeline Purgatory','Akatsuki Alliance','Charlie Cluster','The Bug Bundles',
  'Survey Syndicate','Delta Division','Script Swarms','Section 9 Squad',
  'Echo Enclave','Wizard Workshop','Black Knight Brigade','Foxtrot Flotilla',
  'Chaos Control','Jujutsu Junction','Golf Garrison','Conflict Clubs',
  'Gotei 13 Guard','Hotel Heavyweights','Push Parties','Straw Hat Grand Fleet',
  'India Infantry','Automation Armory','Phantom Pack','Juliet Junction',
  'Cron Collectives','NERV Network','Kilo Kingdom','Logic Legions',
  'Night Raid Regime','Lima Lineup','Thread Throngs','Odd Jobs Office',
  'Mike Mavericks','Deployment Depots','S-Class Syndicate','November Nexus',
  'Webhook Waves','Demon Slayer Corps','Oscar Outposts','Binary Battalions',
  'Ghoul Guilds','Papa Patrols','Event Engines','Dai-Gurren Division',
  'Quebec Queues','Chatty Cartels','Bebop Brigade','Romeo Raiders',
  'Root Regiments','Hunter Associations','Sierra Systems','Core Consolidations',
  'Overlord Orders','Tango Targets','Data Dumps','Armed Detective Agencies',
  'Uniform Units','Localhost Legacies','Blue Lock Blocks','Victor Valves',
  'Trigger Tribes','Uchiha Uplinks','Whiskey Webhooks','Garbage Collections',
  'Otaku Operations','X-Ray Examiners','Geass Garrisons','Scraper Sects',
  'Yankee Yards','Saitama\'s Suites','Alchemist Assemblers','Zulu Zeniths',
  'Shinigami Squadrons','Hokage Heralds','Apex Activations','Steins;Gate Keepers',
  'Delta Drivers','Titan Outbreaks','Hacker Hives','Charlie Compilers',
  'Maverick Monitors','Zodiac Zones','Echo Enforcers','Iron Fortresses',
  'Saiyan Surges','Bravo Botnets','Blackout Brigades','Ninja Noticeboards',
  'Foxtrot Firewalls','Phoenix Squadrons','Tango Techs','Whiskey Wardens',
  'Raptor Runner Rows','Buggy Bombers','Omega Outputs','Infinite Tsukuyomi Orchestras',
];

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
const stacksList              = document.getElementById('stacks-list');
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
  if (hint) { const i = mkEl('i', 'field-hint', 'i'); i.dataset.hint = hint; el.append(i); }
  return el;
}

// ── Hint tooltip controller ───────────────────────────────────────────────────

(function initHintTooltip() {
  const tip = document.getElementById('hint-tooltip');
  let showTimer = null;

  function show(anchor) {
    const text = anchor.dataset.hint;
    if (!text) return;
    tip.textContent = text;

    const GAP = 8;
    const anchorRect = anchor.getBoundingClientRect();

    // Measure at a hidden-but-rendered position to get real dimensions
    tip.style.visibility = 'hidden';
    tip.style.top = '0'; tip.style.left = '0';
    tip.classList.remove('visible', 'tip-above', 'tip-below');

    const tipH = tip.offsetHeight;
    const tipW = tip.offsetWidth;
    const spaceBelow = window.innerHeight - anchorRect.bottom;
    const placeAbove = spaceBelow < tipH + GAP + 10 && anchorRect.top > tipH + GAP;

    let top, left;
    if (placeAbove) {
      top = anchorRect.top - tipH - GAP;
      tip.classList.add('tip-above');
    } else {
      top = anchorRect.bottom + GAP;
      tip.classList.add('tip-below');
    }

    left = anchorRect.left + anchorRect.width / 2 - tipW / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tipW - 8));

    tip.style.top  = top  + 'px';
    tip.style.left = left + 'px';
    tip.style.visibility = '';
    tip.classList.add('visible');
  }

  function hide() {
    clearTimeout(showTimer);
    tip.classList.remove('visible');
  }

  document.addEventListener('mouseover', e => {
    const anchor = e.target.closest('.field-hint');
    if (!anchor) return;
    clearTimeout(showTimer);
    showTimer = setTimeout(() => show(anchor), 250);
  });

  document.addEventListener('mouseout', e => {
    if (!e.target.closest('.field-hint')) return;
    hide();
  });

  document.addEventListener('scroll', hide, true);
}());
function cardRow(label, ...content) {
  const r = mkDiv('field-row');
  r.append(typeof label === 'string' ? mkEl('span', 'field-label', label) : label, ...content);
  return r;
}
function cardRowTop(label, ...content) {
  const r = cardRow(label, ...content); r.classList.add('field-row--top'); return r;
}
function cfield(labelText, hintText, ...content) {
  const el = mkDiv('cfield');
  const lbl = mkEl('span', 'cfield-label', labelText);
  if (hintText) {
    const i = mkEl('i', 'field-hint', 'i');
    i.dataset.hint = hintText;
    i.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); });
    lbl.append(i);
  }
  el.append(lbl, ...content);
  return el;
}

// ── KV editor helpers ─────────────────────────────────────────────────────────

function makeKvRow(key, val) {
  const row = mkDiv('kv-row');
  const k = mkInput(key, true, 'key');    k.className += ' kv-key';
  const v = mkInput(val,  true, '{variable} or value'); v.className += ' kv-val';
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

// ── Replace-step helpers ──────────────────────────────────────────────────────

function makeReplaceRow(step = {}) {
  const row = mkDiv('replace-row');
  const pattern = mkInput(step.pattern ?? '', true, '[^a-zA-Z0-9]');
  const flags   = mkInput(step.flags   ?? 'g',  true, 'g');
  const withVal  = mkInput(step.with    ?? '', false, 'replacement');
  const rm = mkSmallBtn('×', 'btn btn-danger btn-xs', () => row.remove());
  row.append(pattern, flags, withVal, rm);
  return row;
}
function readReplaceList(listEl) {
  return [...listEl.querySelectorAll('.replace-row')].map(r => {
    const [pattern, flags, withVal] = r.querySelectorAll('input');
    return { pattern: pattern.value.trim(), flags: flags.value.trim() || 'g', with: withVal.value };
  }).filter(s => s.pattern);
}
function populateReplaceList(listEl, arr) {
  listEl.innerHTML = '';
  const steps = Array.isArray(arr) ? arr : (arr ? [arr] : []);
  for (const s of steps) listEl.appendChild(makeReplaceRow(s));
}


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

function makeConditionalRules(initValue, { valuePlaceholder = 'value', useTextarea = false } = {}) {
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

  // ── Simple mode: single text input or textarea ──
  const simpleInput = useTextarea
    ? (() => { const ta = document.createElement('textarea'); ta.className = 'field-textarea'; ta.placeholder = valuePlaceholder; ta.value = initSimpleVal; ta.rows = 3; return ta; })()
    : mkInput(initSimpleVal, true, valuePlaceholder);

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
  note.innerHTML = 'Condition: <code>variableName:contains:VALUE</code> or <code>variableName:notContains:VALUE</code>. Rules are tried in order — leave blank for a fallback.';

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

// ── Stack management ──────────────────────────────────────────────────────────

function openStackAssignMenu(anchor, items, onSelect) {
  document.querySelector('.stack-assign-menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'stack-assign-menu';

  const regular = items.filter(i => i.id !== '__new__');
  const createItem = items.find(i => i.id === '__new__');

  if (regular.length === 0 && !createItem) { menu.remove(); return; }

  if (regular.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'stack-assign-empty';
    empty.textContent = 'No stacks yet';
    menu.append(empty);
  }

  for (const item of regular) {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'stack-assign-item';
    const dot = document.createElement('span');
    dot.className = 'stack-assign-dot'; dot.style.background = item.color;
    btn.append(dot, document.createTextNode(item.label));
    btn.addEventListener('click', () => { menu.remove(); onSelect(item); });
    menu.append(btn);
  }

  if (createItem) {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'stack-assign-item stack-assign-item--create';
    btn.textContent = createItem.label;
    btn.addEventListener('click', () => { menu.remove(); onSelect(createItem); });
    menu.append(btn);
  }

  document.body.append(menu);
  const rect = anchor.getBoundingClientRect();
  let top = rect.bottom + 4;
  if (top + menu.offsetHeight > window.innerHeight - 8) top = rect.top - menu.offsetHeight - 4;
  menu.style.top  = Math.max(8, top) + 'px';
  menu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8)) + 'px';

  const dismiss = e => {
    if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', dismiss, true); }
  };
  setTimeout(() => document.addEventListener('mousedown', dismiss, true), 0);
}

function pickRandomStackName() {
  const used = new Set([...stacksList.querySelectorAll(':scope > .deploy-card')].map(c => c._read().label).filter(Boolean));
  const pool = STACK_NAMES.filter(n => !used.has(n));
  return (pool.length ? pool : STACK_NAMES)[Math.floor(Math.random() * (pool.length || STACK_NAMES.length))];
}

function makeNewStack() {
  return makeStackCard({ label: pickRandomStackName(), color: randomActionColor() });
}

function makeStackCard(stack) {
  const card = mkDiv('deploy-card');
  const header = mkDiv('deploy-card-header');
  header.style.borderBottom = 'none';

  const handle = mkEl('span', 'drag-handle', '⠿'); handle.draggable = true;

  const colorInput = document.createElement('input');
  colorInput.type = 'color'; colorInput.value = stack.color || '#24292f';
  colorInput.style.cssText = 'position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%;padding:0;border:none;';
  const dot = mkEl('span', 'deploy-card-dot');
  dot.style.background = stack.color || '#24292f';
  dot.style.position = 'relative'; dot.style.cursor = 'pointer';
  dot.appendChild(colorInput);
  colorInput.addEventListener('input', () => { dot.style.background = colorInput.value; fireStackSync(); });

  const name = document.createElement('input');
  name.type = 'text'; name.className = 'deploy-card-name';
  name.value = stack.label || ''; name.placeholder = 'Stack name';

  const pencil = makePencilBtn();
  const nameWrap = mkDiv('deploy-card-name-wrap');
  nameWrap.append(name, pencil);
  pencil.addEventListener('click', e => {
    e.stopPropagation();
    cardEditPopup.open(pencil, [
      { label: 'Stack name', input: name },
      { label: 'Color', input: colorInput, type: 'color' },
    ]);
  });

  const idInput = document.createElement('input');
  idInput.type = 'hidden';
  idInput.value = stack.id || ('stk-' + Math.random().toString(36).slice(2));

  const fireStackSync = () => document.dispatchEvent(
    new CustomEvent('stack-card-sync', { detail: { id: idInput.value, label: name.value.trim(), color: colorInput.value } })
  );
  name.addEventListener('input', fireStackSync);

  const rm = mkSmallBtn('× Remove', 'btn btn-danger btn-xs', () => card.remove());
  header.append(handle, dot, nameWrap, rm);
  card.append(idInput, header);

  card._read = () => ({ id: idInput.value, label: name.value.trim(), color: colorInput.value });
  return card;
}

function makeStackChips(initStackIds) {
  const wrap = mkDiv('');
  const chipsEl = mkDiv('stack-chips');

  const readGlobalStacks = () =>
    [...stacksList.querySelectorAll(':scope > .deploy-card')].map(c => c._read()).filter(s => s.id);

  // Declared before addChip so the closure can re-append it to stay at the end
  const addBtn = mkSmallBtn('+ Add to stack', 'btn btn-secondary btn-xs', () => {});

  const addChip = (id, label, color) => {
    if ([...chipsEl.querySelectorAll('.stack-chip')].some(c => c.dataset.id === id)) return;
    const chip = mkDiv('stack-chip');
    chip.dataset.id = id;
    const dot = document.createElement('span');
    dot.className = 'stack-chip-dot'; dot.style.background = color || '#24292f';
    chip.append(dot, document.createTextNode(label || id));
    const rm = document.createElement('button');
    rm.type = 'button'; rm.className = 'stack-chip-rm'; rm.textContent = '×';
    chip.append(rm);
    chipsEl.append(chip);
    if (addBtn.parentNode === chipsEl) chipsEl.append(addBtn);

    // Stay in sync when the global stack card is edited
    const chipText    = [...chip.childNodes].find(n => n.nodeType === 3);
    const syncHandler = e => {
      if (e.detail.id !== id) return;
      if (chipText) chipText.textContent = e.detail.label || id;
      dot.style.background = e.detail.color;
    };
    document.addEventListener('stack-card-sync', syncHandler);
    rm.addEventListener('click', () => { chip.remove(); document.removeEventListener('stack-card-sync', syncHandler); });
  };

  for (const id of initStackIds ?? []) {
    const s = readGlobalStacks().find(s => s.id === id);
    if (s) addChip(s.id, s.label, s.color);
  }
  addBtn.addEventListener('click', e => {
    e.stopPropagation();
    const currentIds = new Set([...chipsEl.querySelectorAll('.stack-chip')].map(c => c.dataset.id));
    const available  = readGlobalStacks().filter(s => !currentIds.has(s.id));
    openStackAssignMenu(addBtn, [
      ...available,
      { id: '__new__', label: '+ Create new stack', color: '' },
    ], item => {
      if (item.id === '__new__') {
        const newStack = makeNewStack();
        stacksList.append(newStack);
        document.getElementById('additional-settings-section').classList.remove('collapsed');
        flashHighlight(newStack);
        const inp = newStack.querySelector('.deploy-card-name');
        inp?.focus(); inp?.select();
        const { id: newId, label: newLabel, color: newColor } = newStack._read();
        addChip(newId, newLabel, newColor);
        newStack.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        addChip(item.id, item.label, item.color);
      }
    });
  });

  chipsEl.append(addBtn);
  wrap.append(chipsEl);
  wrap._read = () => [...chipsEl.querySelectorAll('.stack-chip')].map(c => c.dataset.id);
  return wrap;
}

// ── Token card (per-action token) ─────────────────────────────────────────────

function makeTokenCard(token, { allowCommentSources = true, expanded = false } = {}) {
  const { card, dot, name: nameInput, pencil } = makeActionCardShell(token.name || 'variableName', null, { draggable: false, expanded });
  dot.remove();
  nameInput.placeholder = 'variableName';
  nameInput.value = token.name ?? '';

  pencil.addEventListener('click', e => {
    e.stopPropagation();
    cardEditPopup.open(pencil, [{ label: 'Variable name', input: nameInput }]);
  });

  const sourceSel    = buildSourceSelect(token.source ?? (allowCommentSources ? 'commentBody' : 'prTitle'), allowCommentSources);
  const regexInput   = mkInput(token.regex   ?? '', true,  'optional pattern');
  const regexNote    = mkEl('p', 'sub-note', 'Optional — capture group 1 is the value. If absent, the full source value is used.');
  const defaultInput = mkInput(token.default ?? '', false, '');
  const skipList  = mkDiv('tag-list');
  populateTagList(skipList, token.skip);
  const skipAdd   = mkSmallBtn('+ Add', 'btn btn-secondary btn-xs', () => skipList.append(makeTagRow('')));
  const skipNote  = mkEl('p', 'sub-note', 'If the extracted value matches any entry, the entire row is skipped and no action is triggered.');
  const skipInline = mkDiv('tag-inline-row'); skipInline.append(skipList, skipAdd);
  const skipWrap  = mkDiv(''); skipWrap.append(skipInline, skipNote);

  const replaceList = mkDiv('replace-list');
  populateReplaceList(replaceList, token.replace);
  const replaceHeader = mkDiv('replace-row-header');
  ['Pattern', 'Flags', 'Replace with', ''].forEach(t => replaceHeader.append(mkEl('span', 'cfield-pair-sublabel', t)));
  replaceList.prepend(replaceHeader);
  const replaceAdd  = mkSmallBtn('+ Add step', 'btn btn-secondary btn-xs', () => replaceList.append(makeReplaceRow()));
  const replaceNote = mkEl('p', 'sub-note', 'Applied in order. Flags: g = all matches, i = case-insensitive, gi = both. Leave "Replace with" empty to delete matches.');
  const replaceWrap = mkDiv(''); replaceWrap.append(replaceList, replaceAdd, replaceNote);

  const addBody = mkDiv('feedback-section-body');
  addBody.append(
    cardRow(fieldLabelEl('Fallback value', 'Value to use when the pattern finds no match or the source is empty'), defaultInput),
    cardRowTop(fieldLabelEl('Skip if value is', 'Skip this row entirely if the extracted value matches any of these — useful for filtering out known noise values'), skipWrap),
    cardRowTop(fieldLabelEl('Transform', 'Chain of regex replace steps applied to the extracted value in order — pattern, flags, replacement'), replaceWrap),
  );
  const addChevron = mkEl('span', 'feedback-chevron', '▾');
  const addHeader  = mkDiv('feedback-section-header');
  addHeader.append(addChevron, document.createTextNode('Additional Settings'));
  const addSection = mkDiv('feedback-section collapsed');
  addSection.append(addHeader, addBody);
  addHeader.addEventListener('click', () => addSection.classList.toggle('collapsed'));

  const body = mkDiv('deploy-card-body');
  body.append(
    cardRow(fieldLabelEl('Extract from', 'Where to read this variable\'s value from — choose a PR field or the comment body'), sourceSel),
    cardRow(fieldLabelEl('Match pattern', 'Optional regex to extract a specific part of the source. Capture group 1 becomes the value; leave blank to use the full source'), regexInput),
    regexNote,
    addSection,
  );
  card.append(body);

  card._read = () => {
    const replace = readReplaceList(replaceList);
    return {
      name:    nameInput.value.trim(),
      source:  sourceSel.value,
      regex:   regexInput.value.trim(),
      default: defaultInput.value.trim(),
      skip:    readTagList(skipList),
      ...(replace.length ? { replace } : {}),
    };
  };
  return card;
}

// ── Extraction pattern card (global patterns library) ─────────────────────────

function makeTokenPresetCard(preset, { expanded = false } = {}) {
  const { card, dot, name, pencil } = makeActionCardShell(preset.label || 'Pattern', '#6e7781', { draggable: false, expanded });
  dot.remove();
  name.placeholder = 'Pattern name';

  pencil.addEventListener('click', e => {
    e.stopPropagation();
    cardEditPopup.open(pencil, [{ label: 'Pattern name', input: name }]);
  });

  const body = mkDiv('deploy-card-body');

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
  const skipInline = mkDiv('tag-inline-row'); skipInline.append(skipList, skipAdd);
  const skipWrap = mkDiv(''); skipWrap.append(skipInline, skipNote);

  const replaceList = mkDiv('replace-list');
  populateReplaceList(replaceList, preset.replace);
  const replaceHeader = mkDiv('replace-row-header');
  ['Pattern', 'Flags', 'Replace with', ''].forEach(t => replaceHeader.append(mkEl('span', 'cfield-pair-sublabel', t)));
  replaceList.prepend(replaceHeader);
  const replaceAdd  = mkSmallBtn('+ Add step', 'btn btn-secondary btn-xs', () => replaceList.append(makeReplaceRow()));
  const replaceNote = mkEl('p', 'sub-note', 'Applied in order. Flags: g = all matches, i = case-insensitive, gi = both. Leave "Replace with" empty to delete matches.');
  const replaceWrap = mkDiv(''); replaceWrap.append(replaceList, replaceAdd, replaceNote);

  const addBody = mkDiv('feedback-section-body');
  addBody.append(
    cardRow(fieldLabelEl('Fallback value', 'Value to use when the pattern finds no match or the source is empty'), defaultInput),
    cardRowTop(fieldLabelEl('Skip if value is', 'Skip this row entirely if the extracted value matches any of these — useful for filtering out known noise values'), skipWrap),
    cardRowTop(fieldLabelEl('Transform', 'Chain of regex replace steps applied to the extracted value in order — pattern, flags, replacement'), replaceWrap),
  );
  const addChevron = mkEl('span', 'feedback-chevron', '▾');
  const addHeader  = mkDiv('feedback-section-header');
  addHeader.append(addChevron, document.createTextNode('Additional Settings'));
  const addSection = mkDiv('feedback-section collapsed');
  addSection.append(addHeader, addBody);
  addHeader.addEventListener('click', () => addSection.classList.toggle('collapsed'));

  body.append(
    cardRow(fieldLabelEl('Variable name', 'The identifier used as {variableName} in action fields'), idInput),
    cardRow(fieldLabelEl('Extract from', 'Where to read this variable\'s value from — choose a PR field or the comment body'), sourceSel),
    cardRow(fieldLabelEl('Match pattern', 'Optional regex to extract a specific part of the source. Capture group 1 becomes the value; leave blank to use the full source'), regexInput),
    regexNote,
    addSection,
  );
  card.append(body);

  card._read = () => {
    const replace = readReplaceList(replaceList);
    return {
      id:      idInput.value.trim(),
      label:   name.value.trim(),
      source:  sourceSel.value,
      regex:   regexInput.value.trim(),
      default: defaultInput.value.trim(),
      skip:    readTagList(skipList),
      ...(replace.length ? { replace } : {}),
    };
  };
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
    const presets = [...tokenPresetsList.querySelectorAll(':scope > .deploy-card')].map(c => c._read()).filter(p => p.id);
    if (presets.length === 0) {
      e.preventDefault();
      appendAndScroll(tokenList, makeTokenCard({}, { allowCommentSources, expanded: true }));
      return;
    }
  });

  sel.addEventListener('focus', () => {
    [...sel.querySelectorAll('.preset-opt')].forEach(o => o.remove());
    const presets = [...tokenPresetsList.querySelectorAll(':scope > .deploy-card')].map(c => c._read());
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
      const presets  = [...tokenPresetsList.querySelectorAll(':scope > .deploy-card')].map(c => c._read());
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

  const successPair = mkDiv('cfield-pair');
  const _slWrap = mkDiv(''); _slWrap.append(mkEl('span', 'cfield-pair-sublabel', 'Label'), successLabelInput);
  const _stWrap = mkDiv(''); _stWrap.append(mkEl('span', 'cfield-pair-sublabel', 'Toast'), successToastInput);
  successPair.append(_slWrap, _stWrap);

  const failurePair = mkDiv('cfield-pair');
  const _flWrap = mkDiv(''); _flWrap.append(mkEl('span', 'cfield-pair-sublabel', 'Label'), failureLabelInput);
  const _ftWrap = mkDiv(''); _ftWrap.append(mkEl('span', 'cfield-pair-sublabel', 'Toast'), failureToastInput);
  failurePair.append(_flWrap, _ftWrap);

  // Redirect select
  const redirectSel = document.createElement('select');
  redirectSel.className = 'field-select';
  redirectSel.style.width = 'auto';
  redirectSel.style.justifySelf = 'start';
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
  note.innerHTML = '<code>{error}</code> = API error message' + (isComment ? '; <code>{count}</code> = rows triggered' : '') + '. Blank fields use defaults.';

  const ltBody = mkDiv('feedback-section-body');
  ltBody.append(
    cfield('Loading label', 'Button text while the action is running (e.g. ⏳ Deploying…)', pendingInput),
    cfield('Success', 'Label: button text after a successful action. Toast: bottom-right notification (leave blank to suppress)', successPair),
    cfield('Failure', 'Label: button text after a failed action. Toast: error notification shown. Use {error} for the API error message', failurePair),
    note,
  );
  const ltChevron = mkEl('span', 'feedback-chevron', '▾');
  const ltHeader  = mkDiv('feedback-section-header');
  ltHeader.append(ltChevron, document.createTextNode('Label & Toast'));
  const ltSection = mkDiv('feedback-section collapsed');
  ltSection.append(ltHeader, ltBody);
  ltHeader.addEventListener('click', () => ltSection.classList.toggle('collapsed'));

  const redirectCfield = cfield('After success, go to', 'URL to open in the current tab after a successful action — useful for redirecting to a deploy log or PR list. Supports {placeholders}', redirectSel);
  const body = mkDiv('feedback-section-body');
  body.append(ltSection, redirectCfield);

  const chevron = mkEl('span', 'feedback-chevron', '▾');
  const header = mkDiv('feedback-section-header');
  header.append(chevron, document.createTextNode('Additional Settings'));

  const wrap = mkDiv('feedback-section collapsed');
  wrap.append(header, body);
  header.addEventListener('click', () => wrap.classList.toggle('collapsed'));

  return {
    el: wrap,
    body,
    redirectCfield,
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
  label:      'Set me up!',
  color:      randomActionColor(),
  filter:     { hideOnStates: [], authors: [] },
  tokens:     [],
  onMultiple: 'all',
  action:     { type: 'comment', comment: '' },
});

// ── Card name / color edit popup ─────────────────────────────────────────────

const cardEditPopup = (() => {
  const popup = mkDiv('card-edit-popup');
  popup.hidden = true;
  document.body.append(popup);

  let currentAnchor = null;

  const close = () => { popup.hidden = true; currentAnchor = null; };

  document.addEventListener('mousedown', e => {
    if (!popup.hidden && !popup.contains(e.target) && !e.target.closest('.card-edit-btn')) close();
  }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !popup.hidden) close(); });

  return {
    open(anchor, fields) {
      if (currentAnchor === anchor) { close(); return; }
      currentAnchor = anchor;
      popup.innerHTML = '';

      for (const { label, input, type = 'text' } of fields) {
        const row = mkDiv('card-edit-popup-row');
        const lbl = mkEl('label', 'card-edit-popup-label', label);
        const inp = document.createElement('input');
        inp.type = type;
        inp.value = input.value;
        inp.className = type === 'color' ? 'card-edit-popup-color' : 'card-edit-popup-input';
        inp.addEventListener('input', () => {
          input.value = inp.value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        row.append(lbl, inp);
        popup.append(row);
      }

      popup.hidden = false;
      const rect = anchor.getBoundingClientRect();
      const GAP  = 6;
      let top  = rect.bottom + GAP;
      let left = rect.left;
      if (top + popup.offsetHeight > window.innerHeight - 8) top = rect.top - popup.offsetHeight - GAP;
      left = Math.max(8, Math.min(left, window.innerWidth - popup.offsetWidth - 8));
      popup.style.top  = top  + 'px';
      popup.style.left = left + 'px';

      popup.querySelector('input[type="text"]')?.select();
    },
    close,
  };
})();

const PENCIL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm.176 4.823L9.75 4.81l-6.286 6.287a.253.253 0 0 0-.064.108l-.558 1.953 1.953-.558a.253.253 0 0 0 .108-.064Zm1.238-3.763a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354Z"/></svg>';

function makePencilBtn() {
  const btn = mkEl('span', 'card-edit-btn');
  btn.innerHTML = PENCIL_SVG;
  return btn;
}

function makeActionCardShell(label, color, { draggable = true, expanded = false } = {}) {
  const card = mkDiv(expanded ? 'deploy-card' : 'deploy-card collapsed');
  const header = mkDiv('deploy-card-header');
  const chevron = mkEl('span', 'card-chevron', '▾');
  if (draggable) { const handle = mkEl('span', 'drag-handle', '⠿'); handle.draggable = true; header.append(handle); }
  const dot = mkEl('span', 'deploy-card-dot'); dot.style.background = color;
  const name = document.createElement('input');
  name.type = 'text'; name.className = 'deploy-card-name';
  name.value = label || ''; name.placeholder = 'Action';
  const pencil = makePencilBtn();
  const nameWrap = mkDiv('deploy-card-name-wrap');
  nameWrap.append(name, pencil);
  const rm = mkSmallBtn('× Remove', 'btn btn-danger btn-xs', () => card.remove());
  header.append(chevron, dot, nameWrap, rm);
  card.append(header);
  header.addEventListener('click', e => {
    if (e.target.closest('button, input, select, label, .card-edit-btn')) return;
    card.classList.toggle('collapsed');
  });
  return { card, header, dot, name, pencil };
}

function makeActionCard(action, { fixedTrigger = null, expanded = false } = {}) {
  const initTrigger = fixedTrigger ?? action.trigger ?? 'prHeader';
  const { card, header, dot, name, pencil } = makeActionCardShell(action.label ?? 'Action', action.color ?? '#c95f0a', { expanded });
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

  pencil.addEventListener('click', e => {
    e.stopPropagation();
    cardEditPopup.open(pencil, [
      { label: 'Button label', input: name },
      { label: 'Color', input: colorInput, type: 'color' },
    ]);
  });

  // Filter: hideOnStates
  const PR_STATES = ['open', 'draft', 'merged', 'closed'];
  const hideChecks = PR_STATES.map(s => mkCheckbox((action.filter?.hideOnStates ?? []).includes(s)));
  const hideGroup = mkDiv('checkbox-group');
  hideChecks.forEach((cb, i) => hideGroup.append(mkCheckboxLabel(cb, PR_STATES[i][0].toUpperCase() + PR_STATES[i].slice(1))));

  // Filter: authors (comment trigger only — row hidden when trigger = prHeader)
  const afList = mkDiv('tag-list');
  populateTagList(afList, action.filter?.authors);
  const afAdd  = mkSmallBtn('+ Add', 'btn btn-secondary btn-xs', () => afList.append(makeTagRow('')));
  const afNote = mkEl('p', 'cfield-helper', 'Usernames or regex. Empty = show for all authors.');
  const afInline = mkDiv('tag-inline-row'); afInline.append(afList, afAdd);
  const afRow = cfield('Restrict to authors', 'Only show this button to PRs or comments by these GitHub usernames (exact match or regex). Leave empty to show for everyone');
  afRow.append(afInline, afNote);

  // onMultiple
  const omName  = 'om-' + Math.random().toString(36).slice(2);
  const omFirst = document.createElement('input'); omFirst.type = 'radio'; omFirst.name = omName; omFirst.value = 'first';
  const omAll   = document.createElement('input'); omAll.type   = 'radio'; omAll.name   = omName; omAll.value   = 'all';
  if ((action.onMultiple ?? 'all') === 'first') omFirst.checked = true; else omAll.checked = true;
  const omGroup = mkDiv('on-multiple-group');
  omGroup.append(mkCheckboxLabel(omAll, 'All matches'), mkCheckboxLabel(omFirst, 'First match only'));

  // Tokens
  const allowCommentSources = initTrigger === 'comment';
  const tokenList  = mkDiv('token-list');
  for (const t of action.tokens ?? []) tokenList.append(makeTokenCard(t, { allowCommentSources }));
  const addTokenSel = makeAddTokenSelect(tokenList, allowCommentSources);
  const varField = cfield('Variables', 'Extract named values from PR context and use them as {placeholders} in the action fields below');
  varField.append(tokenList, addTokenSel);
  if (allowCommentSources) {
    const matchNote = mkEl('p', 'sub-note', 'For comment actions: each line where at least one variable\'s pattern matches creates a separate action invocation. Variables whose pattern doesn\'t match on that line use their fallback value.');
    varField.append(matchNote);
  }

  const actionForm = buildActionFormEl(action.action);

  // Target override — lets the action run on a different repo/PR/ref than the current context
  const tgt = action.target ?? {};
  const hasTarget = !!(tgt.repo || tgt.ref || tgt.prNumber);
  const targetRepoInput = mkInput(tgt.repo     ?? '', false, 'owner/repo — blank = this PR\'s repo');
  const targetRefInput  = mkInput(tgt.ref      ?? '', false, 'branch, tag or SHA — blank = default/PR branch');
  const targetPrInput   = mkInput(tgt.prNumber ?? '', false, 'PR number — blank = this PR');

  const targetRepoRow = cfield('Target repo', 'Run this action on a different repo than the current one. Supports {placeholders}. Leave blank to use this PR\'s repo', targetRepoInput);
  const targetRefRow  = cfield('Target ref',  'Branch, tag, or SHA to dispatch against. Supports {placeholders}. Leave blank to use the default branch (workflow) or PR branch (deployment)', targetRefInput);
  const targetPrRow   = cfield('Target PR',   'Post the comment on a specific PR number. Supports {placeholders}. Leave blank to use this PR', targetPrInput);

  const targetBody = mkDiv('target-panel');
  targetBody.hidden = !hasTarget;
  targetBody.append(targetRepoRow, targetRefRow, targetPrRow);

  const syncTargetFields = () => {
    const t = actionForm.typeSelect.value;
    targetRefRow.hidden = t === 'comment' || t === 'repositoryDispatch';
    targetPrRow.hidden  = t !== 'comment';
  };
  syncTargetFields();
  actionForm.typeSelect.addEventListener('change', syncTargetFields);

  const targetToggle = mkEl('span', 'target-override-toggle', hasTarget ? '⊖ Running outside this PR' : '⊕ Run outside this PR');
  targetToggle.addEventListener('click', () => {
    const expanding = targetBody.hidden;
    targetBody.hidden = !expanding;
    targetToggle.textContent = expanding ? '⊖ Running outside this PR' : '⊕ Run outside this PR';
  });

  const targetSection = mkDiv('target-override-section');
  targetSection.append(targetToggle, targetBody);

  const hideRow = cfield('Hide when PR is', 'Don\'t show this button when the PR matches any of these states', hideGroup);
  const fbSection  = buildFeedbackSection(action.feedback, { isComment: initTrigger === 'comment' });
  const omRow = cfield('Multiple matches', 'When a comment contains multiple matching rows, fire for each one (All) or only the first (First match only)', omGroup);
  fbSection.redirectCfield.before(omRow, afRow, hideRow);

  // Stacks assignment — lives inside Additional Settings
  const stackChips = makeStackChips(action.stacks);
  const stacksRow = cfield('Stacks', 'Nest this action inside a dropdown button. Add it to one or more stacks — it will appear in each stack\'s dropdown menu', stackChips);
  fbSection.body.prepend(stacksRow);

  body.append(
    actionForm.typeRowEl,
    varField,
    actionForm.subformsEl,
    targetSection,
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
    stacks:     stackChips._read(),
    filter: {
      hideOnStates: PR_STATES.filter((s, i) => hideChecks[i].checked),
      authors:      readTagList(afList),
    },
    tokens:     [...tokenList.querySelectorAll(':scope > .deploy-card')].map(c => c._read()),
    onMultiple: omFirst.checked ? 'first' : 'all',
    action:     actionForm.read(),
    feedback:   fbSection.read(),
    target: {
      repo:     targetRepoInput.value.trim(),
      ref:      targetRefInput.value.trim(),
      prNumber: targetPrInput.value.trim(),
    },
  });
  return card;
}

// ── Section form builders (used in Global tab AND override cards) ─────────────

function buildActionFormEl(initAction) {
  const action = initAction ?? { type: 'comment', comment: '' };

  const sel = document.createElement('select'); sel.className = 'field-select'; sel.style.width = 'auto'; sel.style.justifySelf = 'start';
  [['comment','Post PR comment'],['workflow','Dispatch workflow'],['repositoryDispatch','Repository dispatch'],['deployment','Create deployment']]
    .forEach(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = l; sel.append(o); });
  sel.value = action.type ?? 'comment';
  const typeRowEl = cfield('Action type', 'What happens when this button is clicked', sel);

  // comment
  const commentRules = makeConditionalRules(
    action.type === 'comment' ? (action.comment ?? '') : '',
    { valuePlaceholder: 'LazyGitHub in action', useTextarea: true }
  );
  const commentSub = mkDiv('action-subform');
  commentSub.dataset.field = 'action-comment';
  commentSub.append(cfield('Comment body', 'Text of the GitHub comment to post. Supports {placeholders} for dynamic values', commentRules));

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
  wfTokenNote.innerHTML = 'Fixed: <code>{prTitle}</code> <code>{branchName}</code> <code>{prNumber}</code> <code>{repo}</code> <code>{commentAuthor}</code> — plus any variables extracted above.';
  const wfInputsWrap = mkDiv(''); wfInputsWrap.append(wfList, wfAdd, wfTokenNote);
  const workflowSub = mkDiv('action-subform');
  workflowSub.dataset.field = 'action-file';
  workflowSub.append(cfield('Workflow file', 'Filename inside .github/workflows/ to trigger (e.g. deploy.yml). Supports {placeholders} and conditional routing', fileRules), cfield('Workflow inputs', 'Key-value pairs passed as workflow_dispatch inputs. Values support {placeholders}', wfInputsWrap));

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
  rdSub.append(cfield('Event type', 'The event_type string sent with the repository_dispatch. Supports {placeholders} and conditional routing', rdEventRules), cfield('Event payload', 'Key-value pairs sent inside client_payload. Values support {placeholders}', rdWrap));

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
  depSub.append(cfield('Environment', 'Deployment environment name (e.g. staging, production). Supports {placeholders} and conditional routing', depEnvRules), cfield('Deployment payload', 'Extra key-value pairs included in the deployment payload. Values support {placeholders}', depWrap));

  const subs = { comment: commentSub, workflow: workflowSub, repositoryDispatch: rdSub, deployment: depSub };
  const sync = () => { for (const [t, s] of Object.entries(subs)) s.hidden = t !== sel.value; };
  sync(); sel.addEventListener('change', sync);

  const subformsEl = mkDiv('');
  subformsEl.append(commentSub, workflowSub, rdSub, depSub);
  const wrap = mkDiv('');
  wrap.append(typeRowEl, subformsEl);

  return {
    el: wrap,
    typeRowEl,
    subformsEl,
    typeSelect: sel,
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
  const addBtn = mkSmallBtn('+ Add Action', 'btn btn-secondary btn-xs', () => appendAndScroll(list, makeActionCard(ACTION_TEMPLATE(), { fixedTrigger: 'prHeader', expanded: true })));
  wrap.append(list);
  return { el: wrap, listEl: list, addBtn, read: () => [...list.querySelectorAll(':scope > .deploy-card')].map(c => c._read()) };
}

function buildCommentActionsSectionEl(initActions) {
  const wrap = mkDiv('');
  const list = mkDiv('');
  const caTemplate = () => ({ ...ACTION_TEMPLATE(), trigger: 'comment', color: randomActionColor() });
  for (const a of initActions ?? []) list.append(makeActionCard(a, { fixedTrigger: 'comment' }));
  enableDragSort(list, '.deploy-card');
  const addBtn = mkSmallBtn('+ Add Action', 'btn btn-secondary btn-xs', () => appendAndScroll(list, makeActionCard(caTemplate(), { fixedTrigger: 'comment', expanded: true })));
  wrap.append(list);
  return { el: wrap, listEl: list, addBtn, read: () => [...list.querySelectorAll(':scope > .deploy-card')].map(c => c._read()) };
}



// ── Override section (toggle + form body) ─────────────────────────────────────

function makeOverrideSection(title, isActive, buildFn, { initMode = 'replace', fillFromParent } = {}) {
  const section = mkDiv('override-section');

  const body    = buildFn();
  const bodyWrap = mkDiv('override-section-body');

  const headerLabel = document.createElement('label');
  headerLabel.className = 'override-section-header';
  const toggle  = mkCheckbox(isActive); toggle.className = 'override-toggle';
  const titleEl = mkEl('span', '', title);
  headerLabel.append(toggle, titleEl);

  // Right-side group — always present; shows 'inherited' or override controls
  const headerRight = mkDiv('override-header-right');
  const badge = mkEl('span', 'inherited-badge', 'inherited');
  badge.style.display = isActive ? 'none' : '';
  headerRight.append(badge);

  if (body.addBtn) {
    body.addBtn.style.display = isActive ? '' : 'none';
    headerRight.append(body.addBtn);
  }
  headerLabel.append(headerRight);

  let modeReplace, modeExtend, modeGroup = null;
  if (fillFromParent) {
    modeReplace = document.createElement('input'); modeReplace.type = 'hidden'; modeReplace.value = 'replace';
    modeExtend  = document.createElement('input'); modeExtend.type  = 'hidden'; modeExtend.value  = 'extend';
    let isExtend = initMode === 'extend';

    const modeBadge = mkEl('span', 'mode-badge', '');
    const infoI     = mkEl('i', 'field-hint', 'i');
    infoI.dataset.hint = 'Replace: overrides the full action list — parent actions are discarded.\nExtend: appends these actions after the parent\'s — only configure the extras here.';
    infoI.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); });

    modeGroup = mkDiv('override-mode-group');
    modeGroup.style.display = isActive ? '' : 'none';
    modeGroup.append(modeBadge, infoI);
    headerRight.append(modeGroup);

    const syncModeUI = () => {
      modeExtend.checked    = isExtend;
      modeReplace.checked   = !isExtend;
      modeBadge.textContent = isExtend ? 'extend' : 'replace';
      modeBadge.title       = isExtend ? 'Click to replace instead' : 'Click to extend instead';
    };
    syncModeUI();

    modeBadge.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); isExtend = !isExtend; syncModeUI(); });
  }

  bodyWrap.append(body.el);
  bodyWrap.hidden = !isActive;

  let firstEnable = !isActive;
  toggle.addEventListener('change', () => {
    bodyWrap.hidden            = !toggle.checked;
    badge.style.display        = toggle.checked ? 'none' : '';
    if (body.addBtn) body.addBtn.style.display = toggle.checked ? '' : 'none';
    if (modeGroup)   modeGroup.style.display   = toggle.checked ? '' : 'none';
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
  const groupHandle = mkEl('span', 'drag-handle', '⠿'); groupHandle.draggable = true;
  const nameInput = mkInput(groupData?.name ?? '', false, 'Group name');
  nameInput.className = 'override-card-repo-name';
  const groupPencil = makePencilBtn();
  const nameWrap = mkDiv('override-card-name-wrap');
  nameWrap.append(nameInput, groupPencil);
  groupPencil.addEventListener('click', e => {
    e.stopPropagation();
    cardEditPopup.open(groupPencil, [{ label: 'Group name', input: nameInput }]);
  });
  header.addEventListener('click', e => {
    if (e.target.closest('button, input, select, label, .card-edit-btn')) return;
    card.classList.toggle('collapsed');
  });
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
  const reposInline = mkDiv('tag-inline-row');
  reposInline.append(repoTagList, mkSmallBtn('+ Add', 'btn btn-secondary btn-xs', () => repoTagList.append(makeTagRow(''))));
  const reposWrap = mkDiv('');
  reposWrap.append(reposInline, mkEl('p', 'sub-note', 'Exact name or regex (e.g. myorg/js-.*)'));
  const reposSection = mkDiv('override-card-repos');
  reposSection.append(cardRowTop('Match repos', reposWrap));

  const praSec = makeOverrideSection('Actions on PR', 'prActions' in config, () => buildPrActionsSectionEl(config.prActions), {
    initMode: config.prActionsMode ?? 'replace',
    fillFromParent: (listEl, force) => {
      if (!force && listEl.querySelectorAll(':scope > .deploy-card').length > 0) return;
      listEl.innerHTML = '';
      for (const a of (formToGlobalConfig().actions ?? []).filter(a => a.trigger !== 'comment')) {
        listEl.append(makeActionCard(a, { fixedTrigger: 'prHeader' }));
      }
    },
  });
  const cmaSec = makeOverrideSection('Actions on PR Comment', 'commentActions' in config, () => buildCommentActionsSectionEl(config.commentActions), {
    initMode: config.commentActionsMode ?? 'replace',
    fillFromParent: (listEl, force) => {
      if (!force && listEl.querySelectorAll(':scope > .deploy-card').length > 0) return;
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
  const nameInput = mkInput(repoName ?? '', false, 'owner/repo-name');
  nameInput.className = 'override-card-repo-name field-input--mono';
  const repoPencil = makePencilBtn();
  const nameWrap = mkDiv('override-card-name-wrap');
  nameWrap.append(nameInput, repoPencil);
  repoPencil.addEventListener('click', e => {
    e.stopPropagation();
    cardEditPopup.open(repoPencil, [{ label: 'Repo name', input: nameInput }]);
  });
  header.addEventListener('click', e => {
    if (e.target.closest('button, input, select, label, .card-edit-btn')) return;
    card.classList.toggle('collapsed');
  });
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
      if (!force && listEl.querySelectorAll(':scope > .deploy-card').length > 0) return;
      listEl.innerHTML = '';
      for (const a of resolveParentActions('prHeader', nameInput.value.trim())) {
        listEl.append(makeActionCard(a, { fixedTrigger: 'prHeader' }));
      }
    },
  });
  const cmaSec = makeOverrideSection('Comment Actions', 'commentActions' in config, () => buildCommentActionsSectionEl(config.commentActions), {
    initMode: config.commentActionsMode ?? 'replace',
    fillFromParent: (listEl, force) => {
      if (!force && listEl.querySelectorAll(':scope > .deploy-card').length > 0) return;
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

document.getElementById('add-stack-btn').addEventListener('click', () => appendAndScroll(stacksList, makeNewStack()));

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
enableDragSort(stacksList,         '.deploy-card');
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

  // Stacks (must be populated before action cards so chips can resolve labels)
  stacksList.innerHTML = '';
  for (const s of config.stacks ?? []) stacksList.append(makeStackCard(s));

  // Dropdown thresholds
  document.getElementById('pr-dropdown-threshold').value      = config.prDropdownThreshold      ?? 3;
  document.getElementById('comment-dropdown-threshold').value = config.commentDropdownThreshold  ?? 4;
  document.getElementById('pr-dropdown-label').value          = config.prDropdownLabel          ?? '';
  document.getElementById('comment-dropdown-label').value     = config.commentDropdownLabel     ?? '';

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
  if (hasFilterRules) {
    document.getElementById('repo-filter-section').classList.remove('collapsed');
  }
}

function formToGlobalConfig() {
  const repoFilterMode = document.querySelector('input[name="repo-filter-mode"]:checked')?.value ?? 'exclude';
  const prActions      = [...prActionsList.querySelectorAll(':scope > .deploy-card')].map(c => c._read());
  const commentActions = [...commentActionsList.querySelectorAll(':scope > .deploy-card')].map(c => c._read());
  return {
    repoFilter: {
      mode:     repoFilterMode,
      patterns: readTagList(document.getElementById('repo-filter-list')),
    },
    stacks:               [...stacksList.querySelectorAll(':scope > .deploy-card')].map(c => c._read()),
    prDropdownThreshold:      (v => isNaN(v) ? 3 : v)(parseInt(document.getElementById('pr-dropdown-threshold').value,      10)),
    commentDropdownThreshold: (v => isNaN(v) ? 4 : v)(parseInt(document.getElementById('comment-dropdown-threshold').value,  10)),
    prDropdownLabel:          document.getElementById('pr-dropdown-label').value.trim()      || undefined,
    commentDropdownLabel:     document.getElementById('comment-dropdown-label').value.trim() || undefined,
    actions:      [...prActions, ...commentActions],
    tokenPresets: [...tokenPresetsList.querySelectorAll(':scope > .deploy-card')].map(c => c._read()),
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

  if ((config.prDropdownThreshold ?? 3) < 1)      return { message: 'PR header dropdown threshold must be at least 1.',       tab: 'global' };
  if ((config.commentDropdownThreshold ?? 4) < 1)  return { message: 'Comment buttons dropdown threshold must be at least 1.', tab: 'global' };

  for (let i = 0; i < (config.stacks ?? []).length; i++) {
    if (!config.stacks[i].label?.trim()) return { message: `Stack ${i + 1}: name cannot be empty.`, tab: 'global' };
  }

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
    if (!['comment', 'workflow', 'repositoryDispatch', 'deployment'].includes(act.type)) return { message: `Actions on PR ${i+1}: action type must be one of comment, workflow, repositoryDispatch, deployment.`, tab: 'global', locator: { listId: 'pr-actions-list', cardIndex: i } };
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
    if (!['comment', 'workflow', 'repositoryDispatch', 'deployment'].includes(act.type)) return { message: `Actions on PR Comment ${i+1}: action type must be one of comment, workflow, repositoryDispatch, deployment.`, tab: 'global', locator: { listId: 'comment-actions-list', cardIndex: i } };
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
