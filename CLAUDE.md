# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Setup

There is no build step. The extension is plain JavaScript (no transpilation, no bundler).

To load for development:
1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode**
3. Click **Load unpacked** and select this directory

After editing any file, click the refresh icon on the extension card in `chrome://extensions`. For `content.js` and `config-defaults.js` changes, also reload the GitHub tab.

## Architecture

LazyDeploy is a Chrome MV3 extension with three JavaScript execution contexts, each with different APIs:

**`background.js`** — Service worker. The only context that makes GitHub API calls. Handles all four action types (`comment`, `workflow`, `repositoryDispatch`, `deployment`). Receives messages from the content script via `chrome.runtime.onMessage`. Uses `importScripts('config-defaults.js')` to load the default config.

**`content.js`** — Injected into every `github.com` page. Detects PR pages via URL pattern and `MutationObserver`. Resolves the layered config client-side (`resolveConfig`), injects buttons into the DOM, handles the `{ask:"..."}` input modal, and sends `{type: 'action'}` messages to the background worker. Loaded alongside `config-defaults.js` per `manifest.json`.

**`options.js` / `onboarding.js`** — Settings and first-run pages. `options.js` is the bulk of the UI: tabbed editor (Global / Groups / Repos), card builders for each action, drag-to-reorder, JSON import/export, save/discard/reset. `onboarding.js` handles the first-run token setup with inline GitHub API validation.

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

**Template resolution** — `{placeholder}` substitution happens in `background.js` at dispatch time. `{ask:"Label"}` prompts are collected and shown in a modal by `content.js` *before* the message is sent to background.

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
