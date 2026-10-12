#!/usr/bin/env node
// GitHub UI compatibility canary for LazyGitHub.
//
// content.js has no API contract with GitHub — it finds its injection points with
// CSS selectors against whatever DOM github.com happens to render. This script loads
// real PR pages in headless Chrome and asserts that every selector family content.js
// relies on still resolves, so a GitHub redesign fails CI instead of silently removing
// our buttons for every user.
//
// Usage:
//   node check-github-ui.mjs                        # auto-discovers fixture PRs via the API
//   UI_CHECK_PR_URLS="https://github.com/o/r/pull/1" node check-github-ui.mjs
//
// Env:
//   GITHUB_TOKEN        optional, raises the API rate limit for fixture discovery
//   GITHUB_REPOSITORY   tried first when discovering fixtures (set by Actions)
//   UI_CHECK_PR_URLS    comma/space separated PR URLs; skips discovery when set
//   UI_CHECK_OUT_DIR    where report.json / report.md / screenshots go (default ./ui-check-output)
//   GITHUB_STEP_SUMMARY appended to when present (set by Actions)
//
// Exit code 1 when any `fail`-severity family is missing on any fixture, when a fixture
// cannot be loaded, or when CONTRACT below has drifted from content.js.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const HERE        = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT   = path.resolve(HERE, '..', '..');
const CONTENT_JS  = path.join(REPO_ROOT, 'content.js');
const OUT_DIR     = path.resolve(process.env.UI_CHECK_OUT_DIR ?? 'ui-check-output');
const TOKEN       = process.env.GITHUB_TOKEN;
const USER_AGENT  = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

// Repos used to find fixture PRs when the project repo has none with comments.
const FALLBACK_REPOS = ['microsoft/vscode', 'facebook/react', 'rust-lang/rust'];
const MIN_COMMENTS   = 2;

// ─── Selector contract ────────────────────────────────────────────────────────
// Each family mirrors one lookup in content.js. `selectors` is an any-of list: the
// family passes when at least one selector matches, because content.js itself falls
// through them with `??` (new React PR UI first, legacy markup second).
//
//   severity 'fail'  content.js cannot inject or filters break silently → job fails
//   severity 'warn'  content.js degrades gracefully (fallback styling/anchor) → reported only
//   severity 'info'  only rendered for signed-in users; anonymous CI cannot see it → logged only
//   within           evaluate the selectors inside the first element matched by that family
//   requireChildren  only count elements that have child nodes (sticky header is an empty
//                    placeholder until GitHub renders into it)
//   expectText       regex the matched element's text must satisfy
//   scope 'comment'  evaluated once per `#issuecomment-<id>` discovered via permalinks
//
// Keep this list in sync with content.js — the drift check below fails the job when a
// selector appears in one place but not the other.
const CONTRACT = [
  {
    id: 'pr-header-actions',
    description: 'PR header action container (header buttons are prepended here)',
    usedBy: 'attachPrActionButtons',
    severity: 'fail',
    selectors: ['[data-component="PH_Actions"]', '.gh-header-actions'],
  },
  {
    id: 'pr-header-sibling-button',
    description: 'Native button inside the header container (copied for sizing/style); GitHub renders none for anonymous visitors',
    usedBy: 'attachPrActionButtons',
    severity: 'info',
    within: 'pr-header-actions',
    selectors: ['button'],
  },
  {
    id: 'pr-state-label',
    description: 'PR state badge (Open / Merged / Closed / Draft) used by hideOnStates filters',
    usedBy: 'getPrState',
    severity: 'fail',
    selectors: ['[class*="StateLabel"]', '.State'],
    expectText: 'open|closed|merged|draft',
  },
  {
    id: 'pr-state-label-icon',
    description: 'Icon inside the state badge; its parent anchors sticky-header buttons',
    usedBy: 'attachPrActionButtons, makeStickyPr*Btn',
    severity: 'warn',
    selectors: ['[class*="StateLabel-Icon"]'],
  },
  {
    id: 'sticky-header',
    description: 'Sticky PR header shown after scrolling (secondary button location)',
    usedBy: 'attachPrActionButtons',
    severity: 'warn',
    selectors: ['[class*="stickyHeader"]', '.pr-toolbar'],
    requireChildren: true,
  },
  {
    id: 'sticky-title-area',
    description: 'Title area inside the sticky header (preferred anchor for sticky buttons)',
    usedBy: 'attachPrActionButtons',
    severity: 'warn',
    selectors: ['[data-component="TitleArea"]'],
  },
  {
    id: 'comment-permalinks',
    description: 'Timestamp permalinks on issue comments (comment buttons attach after these)',
    usedBy: 'scan → attachCommentButtons',
    severity: 'fail',
    selectors: ['a[href*="#issuecomment-"]'],
  },
  {
    id: 'comment-container',
    description: 'Comment element with id="issuecomment-<id>" (resolved from the permalink)',
    usedBy: 'getCommentAuthor',
    severity: 'fail',
    scope: 'comment',
    selectors: ['#issuecomment-{id}'],
  },
  {
    id: 'comment-author',
    description: 'Author login inside the comment element (drives filter.authors)',
    usedBy: 'getCommentAuthor',
    severity: 'fail',
    scope: 'comment',
    selectors: ['[data-hovercard-type="user"]', '.author'],
  },
];

// Selectors content.js uses that are intentionally not part of the GitHub contract.
const DRIFT_IGNORE = /wd-/; // anything LazyGitHub injects itself (.wd-*, #wd-*, [data-wd-*])

// ─── Drift check: CONTRACT ⟷ content.js ───────────────────────────────────────
async function checkContractDrift() {
  const src = await fs.readFile(CONTENT_JS, 'utf8');
  const problems = [];

  // Every contract selector must still be used literally by content.js.
  for (const fam of CONTRACT) {
    for (const sel of fam.selectors) {
      const needle = sel.includes('{id}') ? sel.split('{id}')[0].replace(/^#/, '') : sel;
      if (!src.includes(needle)) {
        problems.push(`CONTRACT "${fam.id}" lists ${JSON.stringify(sel)} but content.js no longer contains it — remove or update the family.`);
      }
    }
  }

  // Every GitHub-facing selector in content.js must be covered by the contract.
  const covered = new Set(CONTRACT.flatMap(f => f.selectors.map(s => s.replace('{id}', ''))));
  const re = /(?:querySelector|querySelectorAll|closest|matches)\(\s*'((?:[^'\\]|\\.)*)'\s*\)/g;
  for (const [, sel] of src.matchAll(re)) {
    if (DRIFT_IGNORE.test(sel)) continue;
    if (!covered.has(sel)) {
      problems.push(`content.js queries ${JSON.stringify(sel)} but CONTRACT has no family for it — add one so the canary covers it.`);
    }
  }
  return problems;
}

// ─── Fixture discovery ────────────────────────────────────────────────────────
async function api(pathname) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'lazygithub-ui-check',
  };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const res = await fetch(`https://api.github.com${pathname}`, { headers });
  if (!res.ok) throw new Error(`GET ${pathname} → ${res.status} ${res.statusText}`);
  return res.json();
}

async function discoverFixtures() {
  const explicit = (process.env.UI_CHECK_PR_URLS ?? '').split(/[\s,]+/).filter(Boolean);
  if (explicit.length) return explicit.map(url => ({ url, label: 'explicit' }));

  const repos = [...new Set([process.env.GITHUB_REPOSITORY, ...FALLBACK_REPOS].filter(Boolean))];
  const fixtures = [];

  // One open and one closed/merged PR so both header/state variants are exercised.
  for (const state of ['open', 'closed']) {
    for (const repo of repos) {
      try {
        // /pulls omits comment counts; /issues includes them and flags PRs via `pull_request`.
        const issues = await api(`/repos/${repo}/issues?state=${state}&sort=updated&direction=desc&per_page=50`);
        const pick = issues.find(i => i.pull_request && !i.locked && (i.comments ?? 0) >= MIN_COMMENTS);
        if (pick) {
          fixtures.push({ url: pick.html_url, label: `${state} PR, ${pick.comments} comments` });
          break;
        }
      } catch (err) {
        console.warn(`  discovery: ${repo} (${state}) skipped — ${err.message}`);
      }
    }
  }
  return fixtures;
}

// ─── Page evaluation (runs inside the browser) ────────────────────────────────
function evaluateContract(contract) {
  const pick = (root, selectors, fam) => {
    for (const sel of selectors) {
      let els = [...root.querySelectorAll(sel)];
      if (fam.requireChildren) els = els.filter(el => el.children.length > 0);
      if (fam.expectText) {
        const re = new RegExp(fam.expectText, 'i');
        els = els.filter(el => re.test((el.textContent ?? '').trim()));
      }
      if (els.length) return { matched: sel, count: els.length, sample: (els[0].textContent ?? '').trim().slice(0, 60) };
    }
    return null;
  };

  const results = {};
  const anchors = {};

  for (const fam of contract.filter(f => !f.scope)) {
    let root = document;
    if (fam.within) {
      root = anchors[fam.within];
      if (!root) { results[fam.id] = { ok: false, reason: `parent family "${fam.within}" did not match` }; continue; }
    }
    const hit = pick(root, fam.selectors, fam);
    if (hit) anchors[fam.id] = root.querySelector(hit.matched);
    results[fam.id] = hit ? { ok: true, ...hit } : { ok: false, reason: 'no selector matched' };
  }

  // Per-comment families: resolve ids from the permalinks, then check each comment.
  const ids = [...new Set(
    [...document.querySelectorAll('a[href*="#issuecomment-"]')]
      .map(a => a.getAttribute('href').match(/issuecomment-(\d+)/)?.[1])
      .filter(Boolean),
  )].slice(0, 10);

  for (const fam of contract.filter(f => f.scope === 'comment')) {
    const isContainerLookup = fam.selectors.some(s => s.includes('{id}'));
    let hits = 0; let matched = null;
    for (const id of ids) {
      if (isContainerLookup) {
        // The family *is* the container lookup: `#issuecomment-<id>` must resolve.
        const sel = fam.selectors[0].replace('{id}', id);
        if (document.querySelector(sel)) { hits++; matched ??= fam.selectors[0]; }
        continue;
      }
      const container = document.getElementById(`issuecomment-${id}`);
      if (!container) continue;
      const hit = pick(container, fam.selectors, fam);
      if (hit) { hits++; matched ??= hit.matched; }
    }
    results[fam.id] = ids.length === 0
      ? { ok: false, reason: 'no comment ids discovered (comment-permalinks missing?)' }
      : hits > 0
        ? { ok: true, matched, count: hits, sample: `${hits}/${ids.length} comments` }
        : { ok: false, reason: `0/${ids.length} comments matched` };
  }

  return {
    results,
    finalPath: location.pathname,
    title: document.title,
    uiVariant: document.querySelector('[data-component="PH_Actions"]') ? 'react' : document.querySelector('.gh-header-actions') ? 'legacy' : 'unknown',
  };
}

// ─── Browser driver ───────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function loadFixture(browser, fixture) {
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setViewport({ width: 1400, height: 900 });
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

  const attempts = [0, 10_000, 30_000];
  let lastErr;
  for (const [i, delay] of attempts.entries()) {
    if (delay) await sleep(delay);
    try {
      const res = await page.goto(fixture.url, { waitUntil: 'networkidle2', timeout: 60_000 });
      const status = res?.status() ?? 0;
      const title  = await page.title();
      if (status === 429 || status === 403 || /rate limit|whoa there|access denied/i.test(title)) {
        throw new Error(`blocked (HTTP ${status}, title "${title}")`);
      }
      if (status >= 400) throw new Error(`HTTP ${status}`);

      // Give the React header a moment to hydrate, then scroll so the sticky header mounts.
      await page.waitForSelector('[data-component="PH_Actions"], .gh-header-actions', { timeout: 15_000 }).catch(() => {});
      await page.evaluate(() => window.scrollTo(0, 800));
      await sleep(1_500);

      const evaluation = await page.evaluate(evaluateContract, CONTRACT);
      return { page, evaluation };
    } catch (err) {
      lastErr = err;
      console.warn(`  attempt ${i + 1}/${attempts.length} failed: ${err.message}`);
    }
  }
  return { page, error: lastErr };
}

// ─── Reporting ────────────────────────────────────────────────────────────────
const icon = r => (r.ok ? '✅' : r.severity === 'fail' ? '❌' : r.severity === 'warn' ? '⚠️' : 'ℹ️');

function renderMarkdown(report) {
  const lines = [];
  lines.push(`## GitHub UI compatibility check — ${report.status === 'pass' ? '✅ passing' : '❌ FAILING'}`);
  lines.push('');
  lines.push(`Checked ${report.fixtures.length} PR page(s) at ${report.checkedAt}.`);
  lines.push('');

  if (report.drift.length) {
    lines.push('### Contract drift (CONTRACT in check-github-ui.mjs vs content.js)');
    for (const p of report.drift) lines.push(`- ❌ ${p}`);
    lines.push('');
  }

  for (const fx of report.fixtures) {
    lines.push(`### ${fx.url}`);
    lines.push(`_${fx.label}_ · UI variant: \`${fx.uiVariant ?? 'n/a'}\``);
    lines.push('');
    if (fx.error) {
      lines.push(`❌ Could not load page: ${fx.error}`);
      lines.push('');
      continue;
    }
    lines.push('| | Family | Matched selector | Detail | Used by |');
    lines.push('|---|---|---|---|---|');
    for (const row of fx.rows) {
      const detail = row.ok ? `${row.count} match(es)${row.sample ? ` — “${row.sample.replace(/\|/g, '\\|')}”` : ''}` : row.reason;
      lines.push(`| ${icon(row)} | \`${row.id}\` (${row.severity}) | ${row.matched ? `\`${row.matched}\`` : '—'} | ${detail} | ${row.usedBy} |`);
    }
    lines.push('');
  }

  const failing = report.fixtures.flatMap(fx => (fx.rows ?? []).filter(r => !r.ok && r.severity === 'fail').map(r => r.id));
  if (failing.length) {
    lines.push('### What to do');
    lines.push('GitHub changed its PR page markup. Open one of the PRs above in Chrome, inspect the element the failing family describes,');
    lines.push('update the selector list in `content.js` (keep the old one as a fallback), then mirror the change in `CONTRACT` inside');
    lines.push('`.github/ui-check/check-github-ui.mjs`. Screenshots and HTML dumps for failing pages are attached to the workflow run as artifacts.');
    lines.push('');
  }
  return lines.join('\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  console.log('▶ Checking CONTRACT against content.js…');
  const drift = await checkContractDrift();
  for (const p of drift) console.log(`  ❌ ${p}`);
  if (!drift.length) console.log('  ✅ in sync');

  console.log('▶ Discovering fixture PRs…');
  const fixtures = await discoverFixtures();
  for (const f of fixtures) console.log(`  • ${f.url} (${f.label})`);
  if (!fixtures.length) console.log('  ❌ none found');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--lang=en-US'],
  });

  const report = { checkedAt: new Date().toISOString(), status: 'pass', drift, fixtures: [] };
  if (drift.length || !fixtures.length) report.status = 'fail';

  try {
    for (const [i, fixture] of fixtures.entries()) {
      console.log(`▶ ${fixture.url}`);
      const { page, evaluation, error } = await loadFixture(browser, fixture);
      const entry = { ...fixture };

      if (error) {
        entry.error = error.message;
        report.status = 'fail';
        console.log(`  ❌ could not load: ${error.message}`);
      } else {
        entry.uiVariant = evaluation.uiVariant;
        entry.title     = evaluation.title;
        entry.rows = CONTRACT.map(fam => ({
          id: fam.id, severity: fam.severity, usedBy: fam.usedBy, description: fam.description,
          ...evaluation.results[fam.id],
        }));
        if (!/\/pull\/\d+/.test(evaluation.finalPath)) {
          entry.rows.unshift({ id: 'url-pattern', severity: 'fail', usedBy: 'parsePrFromUrl', ok: false, reason: `final path "${evaluation.finalPath}" does not match /pull/<n>` });
        }
        for (const row of entry.rows) {
          console.log(`  ${icon(row)} ${row.id.padEnd(26)} ${row.ok ? `${row.matched}  (${row.count})` : row.reason}`);
          if (!row.ok && row.severity === 'fail') report.status = 'fail';
        }
      }

      const hasFailure = entry.error || entry.rows?.some(r => !r.ok && r.severity !== 'info');
      if (hasFailure) {
        const base = path.join(OUT_DIR, `fixture-${i + 1}`);
        try {
          await page.screenshot({ path: `${base}.png`, fullPage: false });
          await fs.writeFile(`${base}.html`, await page.content());
          entry.artifacts = [`${base}.png`, `${base}.html`];
        } catch (err) {
          console.warn(`  could not capture artifacts: ${err.message}`);
        }
      }
      await page.close();
      report.fixtures.push(entry);
    }
  } finally {
    await browser.close();
  }

  const md = renderMarkdown(report);
  await fs.writeFile(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(OUT_DIR, 'report.md'), md);
  if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, md + '\n');

  console.log(`\n${report.status === 'pass' ? '✅ All required GitHub UI selectors still resolve.' : '❌ GitHub UI check FAILED — see report above.'}`);
  console.log(`   report: ${path.join(OUT_DIR, 'report.md')}`);
  process.exitCode = report.status === 'pass' ? 0 : 1;
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exitCode = 1;
});
