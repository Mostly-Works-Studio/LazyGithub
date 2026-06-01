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
  groups: [],
  repos: {},
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

const groupsList      = document.getElementById('groups-list');
const reposList       = document.getElementById('repos-list');
const saveConfigBtn   = document.getElementById('save-config-btn');
const discardConfigBtn = document.getElementById('discard-config-btn');
const resetConfigBtn  = document.getElementById('reset-config-btn');
const configStatusMsg = document.getElementById('config-status-msg');
const groupsCount     = document.getElementById('groups-count');
const reposCount      = document.getElementById('repos-count');

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
function cardRow(label, ...content) {
  const r = mkDiv('field-row'); r.append(mkEl('span', 'field-label', label), ...content); return r;
}
function cardRowTop(label, ...content) {
  const r = cardRow(label, ...content); r.classList.add('field-row--top'); return r;
}

// ── KV editor helpers (shared with Global tab) ────────────────────────────────

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
  const input = mkInput(val, true, 'value or regex'); input.className += '';
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

// ── Deploy button card helpers ────────────────────────────────────────────────

function makeDeployCard(btnConfig) {
  const card = mkDiv('deploy-card');
  const header = mkDiv('deploy-card-header');
  const dot = mkEl('span', 'deploy-card-dot'); dot.style.background = btnConfig.color ?? '#0969da';
  const name = mkEl('span', 'deploy-card-name', btnConfig.label ?? 'Deploy Button');
  const rm = mkSmallBtn('× Remove', 'btn btn-danger btn-xs', () => card.remove());
  header.append(dot, name, rm);

  const body = mkDiv('deploy-card-body');

  const labelInput = mkInput(btnConfig.label ?? '', false, '');
  labelInput.className = 'field-input deploy-label';
  labelInput.addEventListener('input', () => { name.textContent = labelInput.value || 'Deploy Button'; });

  const { group: colorGroup, hex: colorHex } = buildColorPair(btnConfig.color ?? '#0969da');
  colorHex.className = 'field-input field-input--mono deploy-color';
  const colorPicker = colorGroup.querySelector('input[type=color]');
  colorPicker.addEventListener('input', () => { dot.style.background = colorPicker.value; });
  colorHex.addEventListener('input', () => { if (/^#[0-9a-fA-F]{6}$/.test(colorHex.value)) dot.style.background = colorHex.value; });

  const wfTextarea = document.createElement('textarea');
  wfTextarea.className = 'field-textarea deploy-workflows';
  wfTextarea.rows = 4; wfTextarea.spellcheck = false;
  wfTextarea.value = JSON.stringify(btnConfig.workflows ?? [], null, 2);
  const wfNote = mkEl('p', 'sub-note', ''); wfNote.innerHTML = 'JSON array. <code>"if": "version:contains:VALUE"</code> for conditional routing.';
  const wfWrap = mkDiv(''); wfWrap.append(wfTextarea, wfNote);

  const kvList = mkDiv('kv-list deploy-inputs-list');
  populateKvList(kvList, btnConfig.inputs);
  const addKv = mkSmallBtn('+ Add Input', 'btn btn-secondary btn-xs', () => kvList.appendChild(makeKvRow('', '')));
  const inNote = mkEl('p', 'sub-note', ''); inNote.innerHTML = 'Tokens: <code>{version}</code> <code>{profile}</code> <code>{prTitle}</code> <code>{branchName}</code>';
  const inWrap = mkDiv(''); inWrap.append(kvList, addKv, inNote);

  body.append(
    cardRow('Label', labelInput),
    cardRow('Color', colorGroup),
    cardRowTop('Workflows', wfWrap),
    cardRowTop('Inputs', inWrap),
  );
  card.append(header, body);
  return card;
}
function readDeployCard(card) {
  const label = card.querySelector('.deploy-label').value.trim();
  const color = card.querySelector('.deploy-color').value.trim();
  let workflows;
  try { workflows = JSON.parse(card.querySelector('.deploy-workflows').value); } catch { workflows = []; }
  return { label, color, workflows, inputs: readKvList(card.querySelector('.deploy-inputs-list')) };
}

// ── Section form builders (used in Global tab AND override cards) ─────────────

function buildActionFormEl(initAction) {
  const action = initAction ?? { type: 'comment', comment: '' };
  const wrap = mkDiv('');

  const sel = document.createElement('select'); sel.className = 'field-select';
  [['comment','Post PR comment'],['workflow','Dispatch workflow'],['repositoryDispatch','Repository dispatch'],['deployment','Create deployment']]
    .forEach(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = l; sel.append(o); });
  sel.value = action.type ?? 'comment';
  wrap.append(cardRow('Action type', sel));

  // comment
  const commentInput = mkInput(action.type === 'comment' ? action.comment ?? '' : '', true, '/deploy {branchName}');
  const commentSub = mkDiv('action-subform');
  commentSub.append(cardRow('Comment', commentInput));

  // workflow
  const wfFile = mkInput(action.type === 'workflow' ? action.file ?? '' : '', true, 'build.yaml');
  const wfList = mkDiv('kv-list');
  if (action.type === 'workflow') populateKvList(wfList, action.inputs);
  const wfAdd = mkSmallBtn('+ Add Input', 'btn btn-secondary btn-xs', () => wfList.append(makeKvRow('', '')));
  const wfNote = mkEl('p', 'sub-note', ''); wfNote.innerHTML = 'Tokens: <code>{branchName}</code> <code>{prTitle}</code> <code>{prNumber}</code> <code>{repo}</code>';
  const wfWrap = mkDiv(''); wfWrap.append(wfList, wfAdd, wfNote);
  const workflowSub = mkDiv('action-subform');
  workflowSub.append(cardRow('Workflow file', wfFile), cardRowTop('Inputs', wfWrap));

  // repositoryDispatch
  const rdEvent = mkInput(action.type === 'repositoryDispatch' ? action.eventType ?? '' : '', true, 'build-triggered');
  const rdList = mkDiv('kv-list');
  if (action.type === 'repositoryDispatch') populateKvList(rdList, action.payload);
  const rdAdd = mkSmallBtn('+ Add Field', 'btn btn-secondary btn-xs', () => rdList.append(makeKvRow('', '')));
  const rdWrap = mkDiv(''); rdWrap.append(rdList, rdAdd);
  const rdSub = mkDiv('action-subform');
  rdSub.append(cardRow('Event type', rdEvent), cardRowTop('Payload', rdWrap));

  // deployment
  const depEnv = mkInput(action.type === 'deployment' ? action.environment ?? '' : '', false, 'staging');
  const depList = mkDiv('kv-list');
  if (action.type === 'deployment') populateKvList(depList, action.payload);
  const depAdd = mkSmallBtn('+ Add Field', 'btn btn-secondary btn-xs', () => depList.append(makeKvRow('', '')));
  const depWrap = mkDiv(''); depWrap.append(depList, depAdd);
  const depSub = mkDiv('action-subform');
  depSub.append(cardRow('Environment', depEnv), cardRowTop('Payload', depWrap));

  const subs = { comment: commentSub, workflow: workflowSub, repositoryDispatch: rdSub, deployment: depSub };
  const sync = () => { for (const [t, s] of Object.entries(subs)) s.hidden = t !== sel.value; };
  sync(); sel.addEventListener('change', sync);
  wrap.append(commentSub, workflowSub, rdSub, depSub);

  return {
    el: wrap,
    read() {
      const t = sel.value;
      if (t === 'comment')            return { type: 'comment',            comment:     commentInput.value };
      if (t === 'workflow')           return { type: 'workflow',           file:         wfFile.value.trim(), inputs:  readKvList(wfList) };
      if (t === 'repositoryDispatch') return { type: 'repositoryDispatch', eventType:   rdEvent.value.trim(), payload: readKvList(rdList) };
      return                                 { type: 'deployment',         environment: depEnv.value.trim(),  payload: readKvList(depList) };
    }
  };
}

function buildBuildButtonSectionEl(initConfig) {
  const bb = initConfig ?? {};
  const wrap = mkDiv('');

  const labelInput = mkInput(bb.label ?? '🔨 Build', false, '🔨 Build');
  wrap.append(cardRow('Label', labelInput));

  const { group: colorGroup, hex: colorHex } = buildColorPair(bb.color ?? '#c95f0a');
  wrap.append(cardRow('Color', colorGroup));

  const hideMerged = mkCheckbox((bb.hiddenOnStates ?? []).includes('merged'));
  const hideClosed = mkCheckbox((bb.hiddenOnStates ?? []).includes('closed'));
  const cbGroup = mkDiv('checkbox-group');
  cbGroup.append(mkCheckboxLabel(hideMerged, 'merged'), mkCheckboxLabel(hideClosed, 'closed'));
  wrap.append(cardRow('Hide on', cbGroup));

  const actionForm = buildActionFormEl(bb.action);
  wrap.append(actionForm.el);

  return {
    el: wrap,
    read() {
      const hiddenOnStates = [];
      if (hideMerged.checked) hiddenOnStates.push('merged');
      if (hideClosed.checked) hiddenOnStates.push('closed');
      return { label: labelInput.value, color: colorHex.value.trim(), hiddenOnStates, action: actionForm.read() };
    }
  };
}

function buildDeployButtonsSectionEl(initButtons) {
  const wrap = mkDiv('');
  const list = mkDiv('');
  for (const btn of initButtons ?? []) list.append(makeDeployCard(btn));
  wrap.append(list, mkSmallBtn('+ Add Button', 'btn btn-secondary btn-xs', () => list.append(makeDeployCard(DEPLOY_BTN_TEMPLATE))));
  return { el: wrap, read: () => [...list.querySelectorAll('.deploy-card')].map(readDeployCard) };
}

function buildExtractionSectionEl(initConfig) {
  const ext = initConfig ?? {};
  const wrap = mkDiv('');
  const versionInput = mkInput(ext.versionRegex   ?? '', true,  '');
  const profileInput = mkInput(ext.profileRegex   ?? '', true,  '');
  const defaultInput = mkInput(ext.defaultProfile ?? '', false, 'default');
  const skippedList  = mkDiv('tag-list');
  populateTagList(skippedList, ext.skippedProfiles);
  const skippedWrap = mkDiv('');
  skippedWrap.append(skippedList, mkSmallBtn('+ Add', 'btn btn-secondary btn-xs', () => skippedList.append(makeTagRow(''))));
  wrap.append(cardRow('Version regex', versionInput), cardRow('Profile regex', profileInput), cardRow('Default profile', defaultInput), cardRowTop('Skipped profiles', skippedWrap));
  return {
    el: wrap,
    read: () => ({ versionRegex: versionInput.value, profileRegex: profileInput.value, defaultProfile: defaultInput.value.trim(), skippedProfiles: readTagList(skippedList) })
  };
}

function buildFiltersSectionEl(initConfig) {
  const wrap = mkDiv('');
  const exList = mkDiv('tag-list'); populateTagList(exList, initConfig?.excludedRepos);
  const exWrap = mkDiv(''); exWrap.append(exList, mkSmallBtn('+ Add', 'btn btn-secondary btn-xs', () => exList.append(makeTagRow(''))));
  const auList = mkDiv('tag-list'); populateTagList(auList, initConfig?.commentAuthorFilter);
  const auWrap = mkDiv(''); auWrap.append(auList, mkSmallBtn('+ Add', 'btn btn-secondary btn-xs', () => auList.append(makeTagRow(''))));
  wrap.append(cardRowTop('Excluded repos', exWrap), cardRowTop('Author filter', auWrap));
  return { el: wrap, read: () => ({ excludedRepos: readTagList(exList), commentAuthorFilter: readTagList(auList) }) };
}

// ── Override section (toggle + form body) ─────────────────────────────────────

function makeOverrideSection(title, isActive, buildFn) {
  const section = mkDiv('override-section');

  const headerLabel = document.createElement('label');
  headerLabel.className = 'override-section-header';
  const toggle = mkCheckbox(isActive); toggle.className = 'override-toggle';
  const titleEl = mkEl('span', '', title);
  const badge = mkEl('span', 'inherited-badge', 'inherited'); badge.hidden = isActive;
  headerLabel.append(toggle, titleEl, badge);

  const body = buildFn();
  const bodyWrap = mkDiv('override-section-body');
  bodyWrap.append(body.el); bodyWrap.hidden = !isActive;

  toggle.addEventListener('change', () => { bodyWrap.hidden = !toggle.checked; badge.hidden = toggle.checked; });
  section.append(headerLabel, bodyWrap);

  return { el: section, isOn: () => toggle.checked, read: () => body.read() };
}

// ── Group / Repo cards ────────────────────────────────────────────────────────

function makeGroupCard(groupData) {
  const config = groupData?.config ?? {};
  const card = mkDiv('override-card');

  // Header
  const header = mkDiv('override-card-header');
  header.append(mkEl('span', 'field-label', 'Group'), mkSmallBtn('× Remove', 'btn btn-danger btn-xs', () => { card.remove(); updateTabCounts(); }));

  // Repos tag list
  const repoTagList = mkDiv('tag-list');
  populateTagList(repoTagList, groupData?.repos ?? []);
  const reposWrap = mkDiv('');
  reposWrap.append(repoTagList, mkSmallBtn('+ Add', 'btn btn-secondary btn-xs', () => repoTagList.append(makeTagRow(''))), mkEl('p', 'sub-note', 'Exact name or regex (e.g. myorg/js-.*)'));
  const reposSection = mkDiv('override-card-repos');
  reposSection.append(cardRowTop('Match repos', reposWrap));

  // Override sections
  const bbSec  = makeOverrideSection('Build Button',   'buildButton'   in config, () => buildBuildButtonSectionEl(config.buildButton));
  const dbSec  = makeOverrideSection('Deploy Buttons', 'deployButtons' in config, () => buildDeployButtonsSectionEl(config.deployButtons));
  const extSec = makeOverrideSection('Extraction',     'extraction'    in config, () => buildExtractionSectionEl(config.extraction));
  const filSec = makeOverrideSection('Filters',        ('excludedRepos' in config || 'commentAuthorFilter' in config), () => buildFiltersSectionEl(config));

  const overrides = mkDiv('');
  overrides.append(bbSec.el, dbSec.el, extSec.el, filSec.el);
  card.append(header, reposSection, overrides);

  card._read = () => {
    const repos = readTagList(repoTagList);
    const cfg = {};
    if (bbSec.isOn())  cfg.buildButton          = bbSec.read();
    if (dbSec.isOn())  cfg.deployButtons         = dbSec.read();
    if (extSec.isOn()) cfg.extraction            = extSec.read();
    if (filSec.isOn()) { const f = filSec.read(); cfg.excludedRepos = f.excludedRepos; cfg.commentAuthorFilter = f.commentAuthorFilter; }
    return { repos, config: cfg };
  };
  return card;
}

function makeRepoCard(repoName, repoConfig) {
  const config = repoConfig ?? {};
  const card = mkDiv('override-card');

  // Header with repo name input
  const header = mkDiv('override-card-header');
  const nameInput = mkInput(repoName ?? '', false, 'owner/repo-name');
  nameInput.className = 'field-input field-input--mono override-card-repo-name';
  header.append(nameInput, mkSmallBtn('× Remove', 'btn btn-danger btn-xs', () => { card.remove(); updateTabCounts(); }));

  // Override sections
  const bbSec  = makeOverrideSection('Build Button',   'buildButton'   in config, () => buildBuildButtonSectionEl(config.buildButton));
  const dbSec  = makeOverrideSection('Deploy Buttons', 'deployButtons' in config, () => buildDeployButtonsSectionEl(config.deployButtons));
  const extSec = makeOverrideSection('Extraction',     'extraction'    in config, () => buildExtractionSectionEl(config.extraction));
  const filSec = makeOverrideSection('Filters',        ('excludedRepos' in config || 'commentAuthorFilter' in config), () => buildFiltersSectionEl(config));

  const overrides = mkDiv('');
  overrides.append(bbSec.el, dbSec.el, extSec.el, filSec.el);
  card.append(header, overrides);

  card._read = () => {
    const name = nameInput.value.trim();
    const cfg = {};
    if (bbSec.isOn())  cfg.buildButton          = bbSec.read();
    if (dbSec.isOn())  cfg.deployButtons         = dbSec.read();
    if (extSec.isOn()) cfg.extraction            = extSec.read();
    if (filSec.isOn()) { const f = filSec.read(); cfg.excludedRepos = f.excludedRepos; cfg.commentAuthorFilter = f.commentAuthorFilter; }
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

// ── Action type switcher (Global tab) ─────────────────────────────────────────

const actionTypeSelect = document.getElementById('bb-action-type');
const ACTION_SUBFORMS  = {
  comment:            document.getElementById('bb-sub-comment'),
  workflow:           document.getElementById('bb-sub-workflow'),
  repositoryDispatch: document.getElementById('bb-sub-repodispatch'),
  deployment:         document.getElementById('bb-sub-deployment'),
};
actionTypeSelect.addEventListener('change', () => {
  for (const [type, el] of Object.entries(ACTION_SUBFORMS)) el.hidden = type !== actionTypeSelect.value;
});

// Build button color sync (Global tab)
const bbColorPicker = document.getElementById('bb-color-picker');
const bbColorHex    = document.getElementById('bb-color-hex');
bbColorPicker.addEventListener('input', () => { bbColorHex.value = bbColorPicker.value; });
bbColorHex.addEventListener('input', () => { if (/^#[0-9a-fA-F]{6}$/.test(bbColorHex.value)) bbColorPicker.value = bbColorHex.value; });

// KV add buttons (Global tab action sub-forms)
document.getElementById('bb-wf-inputs-add').addEventListener('click',  () => document.getElementById('bb-wf-inputs').appendChild(makeKvRow('', '')));
document.getElementById('bb-rd-payload-add').addEventListener('click', () => document.getElementById('bb-rd-payload').appendChild(makeKvRow('', '')));
document.getElementById('bb-dep-payload-add').addEventListener('click',() => document.getElementById('bb-dep-payload').appendChild(makeKvRow('', '')));

// Tag add buttons (Global tab)
[['ext-skipped-add','ext-skipped-list'],['excluded-repos-add','excluded-repos-list'],['author-filter-add','author-filter-list']].forEach(([b,l]) => {
  document.getElementById(b).addEventListener('click', () => document.getElementById(l).appendChild(makeTagRow('')));
});

// Add deploy button (Global tab)
const deployButtonsList  = document.getElementById('deploy-buttons-list');
const DEPLOY_BTN_TEMPLATE = {
  label: 'Deploy', color: '#0969da',
  workflows: [{ file: 'deploy.yaml' }],
  inputs: { build_version: '{version}', additional_comments: '{prTitle}', build_profile: '{profile}' },
};
document.getElementById('add-deploy-btn').addEventListener('click', () => deployButtonsList.appendChild(makeDeployCard(DEPLOY_BTN_TEMPLATE)));

// Add Group / Add Repo
document.getElementById('add-group-btn').addEventListener('click', () => { groupsList.append(makeGroupCard({ repos: [], config: {} })); updateTabCounts(); });
document.getElementById('add-repo-btn').addEventListener('click', () => { reposList.append(makeRepoCard('', {})); updateTabCounts(); });

// ── Form ↔ Config (Global tab) ────────────────────────────────────────────────

function configToForm(config) {
  const bb = config.buildButton ?? {};
  document.getElementById('bb-label').value    = bb.label ?? '🔨 Build';
  bbColorPicker.value = bb.color ?? '#c95f0a';
  bbColorHex.value    = bb.color ?? '#c95f0a';
  document.getElementById('bb-hide-merged').checked = (bb.hiddenOnStates ?? []).includes('merged');
  document.getElementById('bb-hide-closed').checked = (bb.hiddenOnStates ?? []).includes('closed');
  const action = bb.action ?? { type: 'comment', comment: '' };
  actionTypeSelect.value = action.type ?? 'comment';
  actionTypeSelect.dispatchEvent(new Event('change'));
  document.getElementById('bb-comment').value  = '';
  document.getElementById('bb-wf-file').value  = '';
  document.getElementById('bb-rd-event').value = '';
  document.getElementById('bb-dep-env').value  = '';
  populateKvList(document.getElementById('bb-wf-inputs'),   {});
  populateKvList(document.getElementById('bb-rd-payload'),  {});
  populateKvList(document.getElementById('bb-dep-payload'), {});
  if (action.type === 'comment')            document.getElementById('bb-comment').value   = action.comment   ?? '';
  else if (action.type === 'workflow')      { document.getElementById('bb-wf-file').value  = action.file      ?? ''; populateKvList(document.getElementById('bb-wf-inputs'),  action.inputs);  }
  else if (action.type === 'repositoryDispatch') { document.getElementById('bb-rd-event').value = action.eventType ?? ''; populateKvList(document.getElementById('bb-rd-payload'), action.payload); }
  else if (action.type === 'deployment')   { document.getElementById('bb-dep-env').value  = action.environment ?? ''; populateKvList(document.getElementById('bb-dep-payload'), action.payload); }
  deployButtonsList.innerHTML = '';
  for (const btn of config.deployButtons ?? []) deployButtonsList.appendChild(makeDeployCard(btn));
  const ext = config.extraction ?? {};
  document.getElementById('ext-version-regex').value   = ext.versionRegex   ?? '';
  document.getElementById('ext-profile-regex').value   = ext.profileRegex   ?? '';
  document.getElementById('ext-default-profile').value = ext.defaultProfile ?? '';
  populateTagList(document.getElementById('ext-skipped-list'), ext.skippedProfiles);
  populateTagList(document.getElementById('excluded-repos-list'), config.excludedRepos);
  populateTagList(document.getElementById('author-filter-list'),  config.commentAuthorFilter);
}

function formToGlobalConfig() {
  const actionType = actionTypeSelect.value;
  let action;
  if (actionType === 'comment')            action = { type: 'comment',            comment:     document.getElementById('bb-comment').value };
  else if (actionType === 'workflow')      action = { type: 'workflow',           file:         document.getElementById('bb-wf-file').value.trim(),  inputs:  readKvList(document.getElementById('bb-wf-inputs'))  };
  else if (actionType === 'repositoryDispatch') action = { type: 'repositoryDispatch', eventType:   document.getElementById('bb-rd-event').value.trim(), payload: readKvList(document.getElementById('bb-rd-payload')) };
  else                                     action = { type: 'deployment',         environment: document.getElementById('bb-dep-env').value.trim(),   payload: readKvList(document.getElementById('bb-dep-payload')) };
  const hiddenOnStates = [];
  if (document.getElementById('bb-hide-merged').checked) hiddenOnStates.push('merged');
  if (document.getElementById('bb-hide-closed').checked) hiddenOnStates.push('closed');
  return {
    buildButton:  { label: document.getElementById('bb-label').value, color: bbColorHex.value.trim(), hiddenOnStates, action },
    deployButtons: [...deployButtonsList.querySelectorAll('.deploy-card')].map(readDeployCard),
    extraction:   { versionRegex: document.getElementById('ext-version-regex').value, profileRegex: document.getElementById('ext-profile-regex').value, defaultProfile: document.getElementById('ext-default-profile').value.trim(), skippedProfiles: readTagList(document.getElementById('ext-skipped-list')) },
    excludedRepos:       readTagList(document.getElementById('excluded-repos-list')),
    commentAuthorFilter: readTagList(document.getElementById('author-filter-list')),
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

// ── Save ──────────────────────────────────────────────────────────────────────

const saveConfigBtn_el = document.getElementById('save-config-btn');
saveConfigBtn_el.addEventListener('click', () => {
  const globalPart  = formToGlobalConfig();
  const groupsPart  = readGroupCards();
  const reposPart   = readRepoCards();

  // Build button validation
  if (!globalPart.buildButton.label.trim()) {
    switchToTab('global'); showConfigStatus('Build button label cannot be empty.', 'error'); return;
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(globalPart.buildButton.color)) {
    switchToTab('global'); showConfigStatus('Build button color must be a valid 6-digit hex (e.g. #c95f0a).', 'error'); return;
  }
  const action = globalPart.buildButton.action;
  if (action.type === 'comment'            && !action.comment.trim())    { switchToTab('global'); showConfigStatus('Comment text cannot be empty.', 'error'); return; }
  if (action.type === 'workflow'           && !action.file)              { switchToTab('global'); showConfigStatus('Workflow file cannot be empty.', 'error'); return; }
  if (action.type === 'repositoryDispatch' && !action.eventType)         { switchToTab('global'); showConfigStatus('Event type cannot be empty.', 'error'); return; }
  if (action.type === 'deployment'         && !action.environment)       { switchToTab('global'); showConfigStatus('Environment cannot be empty.', 'error'); return; }
  if (!globalPart.extraction.versionRegex) { switchToTab('global'); showConfigStatus('Version regex cannot be empty.', 'error'); return; }
  try { new RegExp(globalPart.extraction.versionRegex); }
  catch (err) { switchToTab('global'); showConfigStatus(`Invalid version regex: ${err.message}`, 'error'); return; }
  if (globalPart.extraction.profileRegex) {
    try { new RegExp(globalPart.extraction.profileRegex); }
    catch (err) { switchToTab('global'); showConfigStatus(`Invalid profile regex: ${err.message}`, 'error'); return; }
  }
  for (const p of globalPart.excludedRepos) {
    try { new RegExp(p); } catch (err) { switchToTab('global'); showConfigStatus(`Invalid excluded repos pattern "${p}": ${err.message}`, 'error'); return; }
  }
  for (const p of globalPart.commentAuthorFilter) {
    try { new RegExp(p); } catch (err) { switchToTab('global'); showConfigStatus(`Invalid author filter pattern "${p}": ${err.message}`, 'error'); return; }
  }
  if (globalPart.deployButtons.length === 0) { switchToTab('global'); showConfigStatus('At least one deploy button is required.', 'error'); return; }
  for (let i = 0; i < globalPart.deployButtons.length; i++) {
    if (!globalPart.deployButtons[i].label.trim()) { switchToTab('global'); showConfigStatus(`Deploy button ${i+1}: label cannot be empty.`, 'error'); return; }
    if (!/^#[0-9a-fA-F]{6}$/.test(globalPart.deployButtons[i].color)) { switchToTab('global'); showConfigStatus(`Deploy button ${i+1}: invalid color hex.`, 'error'); return; }
  }

  // Groups validation
  for (const group of groupsPart) {
    for (const pattern of group.repos) {
      try { new RegExp(pattern); }
      catch (err) { switchToTab('groups'); showConfigStatus(`Invalid repo pattern "${pattern}": ${err.message}`, 'error'); return; }
    }
  }

  const parsed = { ...globalPart, groups: groupsPart, repos: reposPart };
  chrome.storage.sync.set({ extensionConfig: parsed }, () => {
    lastSavedConfig = parsed;
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
