# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**LazyGitHub** — a Chrome MV3 extension that injects one-click action buttons into GitHub PR pages. Buttons in the PR header and comment threads trigger workflows, post comments, create deployments, and fire repository dispatch events without leaving the page.

- Repo: `https://github.com/Mostly-Works-Studio/LazyGithub`
- Live on Chrome Web Store: `https://chromewebstore.google.com/detail/bkcfpabfdbkiillkanaeabaplcodppol`

## Development Setup

There is no build step, no bundler, and no test suite. The extension is plain JavaScript.

To load for development:
1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode**
3. Click **Load unpacked** and select this directory

After editing any file, click the refresh icon on the extension card in `chrome://extensions`. For `content.js` and `config-defaults.js` changes, also reload the GitHub tab.

## Architecture

LazyGitHub is a Chrome MV3 extension with three JavaScript execution contexts, each with different APIs:

**`background.js`** — Service worker. The only context that makes GitHub API calls. Handles all four action types (`comment`, `workflow`, `repositoryDispatch`, `deployment`). Receives messages from the content script via `chrome.runtime.onMessage`. Uses `importScripts('config-defaults.js')` to load the default config.

**`content.js`** — Injected into every `github.com` page. Detects PR pages via URL pattern and `MutationObserver` (GitHub is an SPA). Resolves the layered config client-side (`resolveConfig`), injects buttons into the DOM, handles the `{input:"Label"}` prompt modal via `resolveActionForDispatch`, and sends `{type: 'action'}` messages to the background worker. Loaded alongside `config-defaults.js` per `manifest.json`.

**`options.js` / `onboarding.js`** — Settings and first-run pages. `options.js` is the bulk of the UI: tabbed editor (Global / Groups / Repos), card builders for each action type, stack management, drag-to-reorder, JSON import/export, save/discard/reset. `onboarding.js` handles the first-run token setup with inline GitHub API validation.

**`config-defaults.js`** — Single source of truth for `DEFAULT_CONFIG`. Loaded in all three contexts. In the background service worker via `importScripts`; in content scripts and options page via the HTML `<script>` tag or manifest injection.

## Key Data Flows

**Config layering** (resolved in `content.js:resolveConfig`):
```
Global config → first matching Group (regex or exact) → per-Repo override
```
`prActions` and `commentActions` arrays default to `replace` mode; set `prActionsMode: "extend"` or `commentActionsMode: "extend"` to append instead. `actionsMode: "extend"` applies to both arrays at once.

**Internally**, the config stores all actions in a single `actions` array with a `trigger` field (`'prHeader'` or `'comment'`). The UI and README split these into `prActions` / `commentActions` for clarity, but `deepMergeConfig` in `content.js` translates between the two representations.

**Pre-dispatch resolution** (`content.js:resolveActionForDispatch`):
Before a message is sent to background, `content.js`:
1. Scans action fields for `{input:"Label"}` placeholders
2. For workflow actions with a static file path, fetches the workflow's YAML input schema via `getWorkflowInputs` message and auto-fills defaults; required inputs get added to the modal
3. Shows the input modal if anything needs collecting
4. Substitutes all `{input:...}` values into the action before dispatch

**Token extraction** (`background.js:extractRows`):
- `commentBody` tokens scan the comment line-by-line. A line becomes a row when **any** token's regex matches it. Tokens that don't match on a given line fall back to their `default` value.
- All other source types (`prTitle`, `prBranch`, etc.) are scalar — resolved once and shared across rows.
- `onMultiple: "first"` slices rows to one; `"all"` dispatches for every matched row (with a 1-second delay between dispatches).
- If a regex has a capture group, group 1 is the value; otherwise the full match is used.
- `token.skip` — if the extracted value is in this array, the entire row is discarded.
- `token.replace` — one or more `{ pattern, flags?, with }` objects applied via `applyReplaceSteps` after the regex extracts a value. Each step runs `String.replace(new RegExp(pattern, flags ?? 'g'), with)` in sequence. A single step can be an object; multiple steps must be an array.
- Deduplication is keyed on the full set of extracted `commentBody` token values — rows with identical values are dropped.

**Template resolution** — `{placeholder}` substitution happens in `background.js` at dispatch time. `{input:"Label"}` prompts are collected and shown in a modal by `content.js` *before* the message is sent to background.

**Conditional values** — any primary string field (`comment`, `file`, `eventType`, `environment`, workflow inputs, payload values) can be an array of `{if?, value}` rules instead of a plain string. The first rule where `if` evaluates to true is used. `if` syntax: `"tokenName:contains:VALUE"` or `"tokenName:notContains:VALUE"`. Unknown operators fail-open (treated as true). Resolved via `resolveConditional` in `background.js`.

## Config Schema

Key fields in `DEFAULT_CONFIG` (`config-defaults.js`):

```js
{
  repoFilter: { mode: 'exclude', patterns: [] },
  tokenPresets: [],       // global-only reusable extraction templates
  stacks: [],             // global stack definitions: [{ id, label, color }]
  showPrInfoBox:            true,   // floating PR info card in bottom-right corner
  prInfoBoxShowRepo:        true,   // show repo name row
  prInfoBoxShowAuthor:      true,   // show PR author row
  prInfoBoxShowHead:        true,   // show head branch row
  prInfoBoxShowBase:        true,   // show base branch row (with refresh button)
  prDropdownThreshold: 3,
  commentDropdownThreshold: 4,
  actions: [              // all actions in one array; trigger field distinguishes PR vs comment
    {
      trigger: 'prHeader' | 'comment',
      label: '',
      color: '',
      stacks: [],         // array of stack IDs this action belongs to
      filter: { hideOnStates: [], authors: [] },
      tokens: [           // extracted variable definitions
        {
          name: '',       // placeholder name used in templates
          source: 'commentBody' | 'commentAuthor' | 'prTitle' | 'prBranch' | 'prNumber' | 'prAuthor' | 'repo',
          regex: '',      // capture group 1 is the value; full match if no groups
          default: '',    // fallback if no match
          skip: [],       // discard row if extracted value is in this list
          replace: { pattern: '', flags: 'g', with: '' }, // or array of these; applied after extraction
        }
      ],
      onMultiple: 'all' | 'first',
      action: { type: 'comment' | 'workflow' | 'repositoryDispatch' | 'deployment', ... },
      feedback: { pending, success: { label, toast, redirect }, failure: { label, toast } },
      target: { repo, ref, prNumber },  // optional cross-repo targeting; all fields are templates
    }
  ],
  groups: [],   // [{ name, repos: [], config: { prActions, commentActions, ... } }]
  repos: {},    // { 'owner/repo': { prActions, commentActions, ... } }
}
```

**Important field names** (use exactly these — not old aliases):
- `filter.hideOnStates` — not `hiddenOnStates`
- `filter.authors` — not `authorFilter`
- `{input:"Label"}` — user prompt placeholder syntax, not `{ask:"Label"}`

## Stacks

Stacks group actions under a shared dropdown button. Defined globally in `config.stacks` as `[{ id, label, color }]`. Each action holds an array of stack IDs it belongs to (`action.stacks`). The options page fires a `stack-card-sync` CustomEvent on `document` whenever a stack's name or colour changes, so chips in action cards update in real time.

## Options Page UI Patterns

- **`makeActionCard`** — builds one collapsible action card. Contains: trigger selector, label/colour, Variables section (`makeTokenCard`), action form (`buildActionFormEl`), target override, and Additional Settings collapsible (`buildFeedbackSection`) which includes stacks, loading/success/failure labels, and redirect.
- **`makeOverrideSection`** — builds a group/repo override row (checkbox toggle, inherited badge, +Add Action button, Replace/Extend mode pill).
- **`buildActionFormEl`** — builds the action-type-specific sub-form (comment body, workflow file+inputs, event type+payload, environment+payload). The sub-form sits flush below the Action type selector with no indent.
- **`makeStackChips`** — renders the stack assignment chips inside an action card. Uses a popup menu to add stacks and fires/listens to `stack-card-sync` for live label/colour sync.
- **`makeConditionalRules`** — builds the if/value conditional routing UI used in comment, file, eventType, and environment fields.
- **Tag lists** use `.tag-inline-row` (flex-wrap row) rather than a vertical column for compact display.

## DOM Injection Conventions

Injected elements in `content.js` use a `wd-` CSS class prefix:
- `.wd-btn` — base class for all action buttons (comment action buttons)
- `.wd-build-btn` — PR header action buttons (always visible, inline in the PR header)
- `.wd-visible`, `.wd-loading`, `.wd-success`, `.wd-failure` — state classes applied to buttons

**PR Info Box** (`#wd-info-box`) — a fixed floating card in the bottom-right corner injected by `injectInfoBox()`. It slides in with a spring animation on first render and collapses off-screen to show only the 16px side-tab when dismissed. Collapsed state persists in `localStorage` under `wd-info-box-collapsed`. The card shows up to 4 rows (repo, author, head branch, base branch) controlled by the `prInfoBoxShow*` config flags. The base branch row includes a refresh button that calls `refreshPrBase` to re-PATCH the PR base and resolve stale diffs. Extension assets (e.g. `icon16.png`) used inside content scripts must be listed in `web_accessible_resources` in `manifest.json`.

## Storage

Config and token are stored in `chrome.storage.sync` under keys `githubToken` and `extensionConfig`. Changes hot-reload without a page refresh via a `chrome.storage.onChanged` listener in `content.js`.

## Message Protocol

All messages are sent from content script → background via `chrome.runtime.sendMessage`.

**`action`** — dispatch a configured action:
```js
// content → background
{ type: 'action', trigger: 'prHeader'|'comment', repo, prNumber, tokens, action, onMultiple, ... }
// background → content (response)
{ success: true|false, count?, commentUrl?, error? }
```

**`getWorkflowInputs`** — fetch and parse workflow YAML input schema:
```js
// content → background
{ type: 'getWorkflowInputs', repo, workflowFile }
// background → content (response)
{ success: true|false, inputs: [{ name, description, required, default, type }] }
```

**`openOptions`** — navigate to the options page (no response):
```js
{ type: 'openOptions', reason: 'no-token' | string }
```

**`getPrBranch`** — fetch PR metadata for the info box:
```js
// content → background
{ type: 'getPrBranch', repo, prNumber }
// background → content (response)
{ repo, repoUrl, headRef, headUrl, baseRef, baseUrl, author, authorUrl } | null
```

**`refreshPrBase`** — re-PATCH the PR base to force diff recalculation against the latest HEAD:
```js
// content → background
{ type: 'refreshPrBase', repo, prNumber }
// background → content (response)
{ success: true } | { success: false, error: string }
```

The background listener must `return true` from `onMessage` for async responses (`action`, `getWorkflowInputs`, `getPrBranch`, `refreshPrBase`).
