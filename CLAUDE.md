# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**LazyGitHub** — a Chrome MV3 extension that injects one-click action buttons into GitHub PR pages. Buttons in the PR header and comment threads trigger workflows, post comments, create deployments, and fire repository dispatch events without leaving the page.

- Repo: `https://github.com/Mostly-Works-Studio/LazyGithub`
- Live on Chrome Web Store: `https://chromewebstore.google.com/detail/bkcfpabfdbkiillkanaeabaplcodppol`

## Development Setup

There is no build step. The extension is plain JavaScript (no transpilation, no bundler).

To load for development:
1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode**
3. Click **Load unpacked** and select this directory

After editing any file, click the refresh icon on the extension card in `chrome://extensions`. For `content.js` and `config-defaults.js` changes, also reload the GitHub tab.

## Architecture

LazyGitHub is a Chrome MV3 extension with three JavaScript execution contexts, each with different APIs:

**`background.js`** — Service worker. The only context that makes GitHub API calls. Handles all four action types (`comment`, `workflow`, `repositoryDispatch`, `deployment`). Receives messages from the content script via `chrome.runtime.onMessage`. Uses `importScripts('config-defaults.js')` to load the default config.

**`content.js`** — Injected into every `github.com` page. Detects PR pages via URL pattern and `MutationObserver`. Resolves the layered config client-side (`resolveConfig`), injects buttons into the DOM, handles the `{input:"Label"}` prompt modal, and sends `{type: 'action'}` messages to the background worker. Loaded alongside `config-defaults.js` per `manifest.json`.

**`options.js` / `onboarding.js`** — Settings and first-run pages. `options.js` is the bulk of the UI: tabbed editor (Global / Groups / Repos), card builders for each action type, stack management, drag-to-reorder, JSON import/export, save/discard/reset. `onboarding.js` handles the first-run token setup with inline GitHub API validation.

**`config-defaults.js`** — Single source of truth for `DEFAULT_CONFIG`. Loaded in all three contexts. In the background service worker via `importScripts`; in content scripts and options page via the HTML `<script>` tag or manifest injection.

## Key Data Flows

**Config layering** (resolved in `content.js:resolveConfig`):
```
Global config → first matching Group (regex or exact) → per-Repo override
```
`prActions` and `commentActions` arrays default to `replace` mode; set `prActionsMode: "extend"` or `commentActionsMode: "extend"` to append instead.

**Internally**, the config stores all actions in a single `actions` array with a `trigger` field (`'prHeader'` or `'comment'`). The UI and README split these into `prActions` / `commentActions` for clarity, but `deepMergeConfig` in `content.js` translates between the two representations.

**Token extraction** (`background.js:extractRows`):
- `commentBody` tokens scan the comment line-by-line; the first token with a `commentBody` source is the "anchor" — each line where it matches is one row.
- All other source types (`prTitle`, `prBranch`, etc.) are scalar — resolved once and shared across rows.
- `onMultiple: "first"` slices rows to one; `"all"` dispatches for every matched row (with a 1-second delay between dispatches).

**Template resolution** — `{placeholder}` substitution happens in `background.js` at dispatch time. `{input:"Label"}` prompts are collected and shown in a modal by `content.js` *before* the message is sent to background.

## Config Schema

Key fields in `DEFAULT_CONFIG` (`config-defaults.js`):

```js
{
  repoFilter: { mode: 'exclude', patterns: [] },
  tokenPresets: [],       // global-only reusable extraction templates
  stacks: [],             // global stack definitions: [{ id, label, color }]
  prDropdownThreshold: 3,
  commentDropdownThreshold: 4,
  actions: [              // all actions in one array; trigger field distinguishes PR vs comment
    {
      trigger: 'prHeader' | 'comment',
      label: '',
      color: '',
      stacks: [],         // array of stack IDs this action belongs to
      filter: { hideOnStates: [], authors: [] },
      tokens: [],         // extracted variable definitions
      onMultiple: 'all' | 'first',
      action: { type: 'comment' | 'workflow' | 'repositoryDispatch' | 'deployment', ... },
      feedback: { pending, success: { label, toast, redirect }, failure: { label, toast } },
      target: { repo, ref, prNumber },  // optional cross-repo targeting
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

## Storage

Config and token are stored in `chrome.storage.sync` under keys `githubToken` and `extensionConfig`. Changes hot-reload without a page refresh via a `chrome.storage.onChanged` listener in `content.js`.

## Message Protocol

Content script → background:
```js
{ type: 'action', trigger: 'prHeader'|'comment', repo, prNumber, tokens, action, onMultiple, ... }
```

Background → content script (response):
```js
{ success: true|false, count?, commentUrl?, error? }
```
