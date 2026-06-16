# LazyGitHub

**One-click actions on GitHub PRs — trigger workflows, post comments, and create deployments without leaving the page.**

LazyGitHub is a Chrome extension that injects action buttons directly into GitHub PR pages. Buttons in the PR header and comment threads let you trigger workflows, post comments, create deployments, and fire repository dispatch events — all without switching tabs or copy-pasting values.

---

## Features

- **One-click PR actions** — buttons in the PR header trigger any action (comment, workflow dispatch, repository dispatch, or deployment); multiple buttons per repo supported
- **One-click comment actions** — buttons appear next to matching strings in PR comments; dispatch actions using tokens extracted from the comment line
- **Hover-to-reveal comment buttons** — hidden until you hover a version link, auto-hide after 5 seconds of inactivity
- **Conditional values** — any primary string field (`comment`, `file`, `eventType`, `environment`) can route to different values based on token content
- **Token transform steps** — post-process any extracted value with a chain of regex replace steps (strip special characters, normalise casing, reformat strings)
- **User input prompts** — use `{input:"Label"}` in any field to pop up an input dialog at click time, letting users fill in values before dispatch
- **Customisable button feedback** — configure what the button shows and which toast fires for pending, success, and failure states
- **After-success redirect** — optionally navigate to the posted comment, the Actions tab, or the Deployments tab on success
- **PR state gating** — hide buttons on merged or closed PRs
- **Repo filter** — exclude or include repos by exact name or regex
- **Author filtering** — show comment action buttons only on comments from specific users or bots
- **Drag-to-reorder** — reorder actions, groups, and conditional rules by dragging the grip handle
- **Duplicate** — copy any action, group, or repo config with one click; the copy gets a "Copy" suffix
- **Layered per-repo config** — global defaults, named group overrides (regex or exact match), and per-repo overrides; highest specificity wins
- **Replace or extend inherited actions** — group and repo overrides can fully replace inherited actions or append to them
- **Form-based config editor** — collapsible sections, tabs for Global / Groups / Repos, Save / Discard / Reset buttons
- **JSON export & import** — share your full config as JSON with teammates; paste theirs to load it into the form instantly

---

## Installation

Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/bkcfpabfdbkiillkanaeabaplcodppol) — a setup page opens automatically on first install.

> To revisit settings later, click the LazyGitHub icon in the toolbar.

**For development / load unpacked:**

1. Clone the repository: `git clone https://github.com/Mostly-Works-Studio/LazyGithub.git`
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the repository folder

---

## Configuration

The settings page splits configuration into three tabs. Click **Save Config** to persist all tabs at once. **Discard Changes** reverts to the last saved state. **Reset to Defaults** restores the factory config. **{ } JSON** opens a modal to copy your config as JSON or paste one to import.

Sections and action cards are collapsed by default — click a header to expand it.

### GitHub Token

Generate a token at [github.com/settings/tokens](https://github.com/settings/tokens/new) with these scopes:

| Scope | Purpose |
|---|---|
| `repo` | Read PR details, post comments, create deployments, and trigger repository dispatch events |
| `workflow` | Dispatch GitHub Actions workflows |

> **Note:** If your org enforces SAML SSO, you must also [authorise the token for SSO](https://docs.github.com/en/authentication/authenticating-with-saml-single-sign-on/authorizing-a-personal-access-token-for-use-with-saml-single-sign-on) after creating it, otherwise API calls to that org will be rejected.

---

### Global tab

Applies to all repos unless overridden by a group or repo entry.

```jsonc
{
  // Controls which repos get buttons injected at all.
  "repoFilter": { "mode": "exclude", "patterns": [] },

  // Named token templates. Actions copy from these as starting points — copies are independent.
  // id: the {placeholder} name used in action inputs.
  // source: commentBody | commentAuthor | prTitle | prBranch | prNumber | prAuthor | repo
  // regex: optional — capture group 1 is the value; if absent, the full source is used.
  // default: fallback if no match. skip: discard the row if the extracted value is in this list.
  // replace: optional — one or more regex replace steps applied after extraction (see Transform steps).
  "tokenPresets": [],

  // Buttons in the PR header. Each runs independently.
  "prActions": [
    {
      "label": "Build",
      "color": "#c95f0a",
      "filter": { "hideOnStates": [], "authors": [] },   // hideOnStates: e.g. ["merged", "closed"] — authors: show only for these GitHub usernames or regexes (empty = all)
      "tokens": [],
      "action": { "type": "comment", "comment": "/build {branchName}" },

      // Optional: customise what the button shows at each stage.
      "feedback": {
        "pending": "⏳ Building…",
        "success": {
          "label": "✓ Done",
          "toast": "",           // empty = no toast
          "redirect": "none"     // none | comment | workflow_runs | deployments
        },
        "failure": { "label": "✗ Failed", "toast": "{error}" }
      }
    }
  ],

  // Buttons next to matching strings in PR comments.
  // Row extraction: each comment line where at least one commentBody token's pattern matches becomes a row.
  // Tokens whose pattern doesn't match on a given line fall back to their default value for that row.
  // onMultiple: "all" — trigger the action for each matching row; "first" — trigger only for the first match.
  // filter.authors: show only on comments from matching usernames or regexes; empty = all authors.
  "commentActions": [
    {
      "label": "Deploy",
      "color": "#1f883d",
      "filter": { "authors": [], "hideOnStates": [] },
      "tokens": [
        {
          "name": "version",
          "source": "commentBody",
          "regex": "\\d{12}-(?:PR\\d+-[a-f0-9]+|\\d+)",
          "default": "",
          "skip": []
        }
      ],
      "onMultiple": "all",
      "action": {
        "type": "workflow",
        "file": [
          { "if": "version:contains:PR", "value": "deploy_hotfix.yaml" },
          { "value": "deploy_release.yaml" }
        ],
        "inputs": { "build_version": "{version}", "env": "{input:\"Target environment\"}" }
      },
      "feedback": {
        "pending": "Running…",
        "success": { "label": "✓ {count} triggered", "toast": "{count} dispatch(es) triggered.", "redirect": "workflow_runs" },
        "failure": { "label": "✗ Failed", "toast": "{error}" }
      }
    }
  ]
}
```

---

### Groups tab

A list of named groups. Each group applies to repos matched by exact name or regex — **first matching group wins**. Toggle which sections to override; unselected sections inherit from global.

Each group card has a **name** field for your own reference, a **Match repos** tag list (exact or regex), and optional PR / comment action overrides.

Each action override section has a **Replace / Extend** mode:
- **Replace** — the override actions completely replace the inherited ones
- **Extend** — the override actions are appended *after* the inherited ones; only configure the extras

When you enable an override for the first time, the form auto-fills from the resolved parent config as a starting point. A **↑ Copy from parent** button is always available to reset.

```jsonc
[
  {
    "name": "JS services",
    "repos": ["myorg/js-service", "myorg/frontend-.*"],
    "config": {
      "prActions": [
        {
          "label": "JS Build",
          "color": "#8250df",
          "action": { "type": "comment", "comment": "/js-build {branchName}" }
        }
      ],
      // prActionsMode omitted = "replace" (default)
      "commentActionsMode": "extend",
      "commentActions": [
        {
          "label": "Deploy JS",
          "color": "#8250df",
          "tokens": [{ "name": "version", "source": "commentBody", "regex": "\\d+\\.\\d+\\.\\d+", "default": "", "skip": [] }],
          "onMultiple": "all",
          "action": { "type": "workflow", "file": "deploy_js.yaml", "inputs": { "version": "{version}" } }
        }
      ]
    }
  }
]
```

---

### Repos tab

Per-repo overrides using the exact `owner/repo` name (no regex). Overrides both global and any matching group. A repo listed here always bypasses `repoFilter`.

```jsonc
{
  "myorg/infra-repo": {
    "prActions": [
      {
        "label": "✓ Validate",
        "color": "#0969da",
        "action": { "type": "workflow", "file": "validate.yaml", "inputs": { "branch": "{branchName}" } }
      }
    ],
    "commentActions": []
  }
}
```

---

### Template Tokens

Placeholders resolved at dispatch time. Use `{name}` anywhere in action string fields.

**Fixed tokens** (always available):

| Token | Resolved value | Available in |
|---|---|---|
| `{prTitle}` | Title of the pull request | both |
| `{branchName}` | Source branch | both |
| `{prNumber}` | PR number | both |
| `{repo}` | Repository (`owner/repo`) | both |
| `{commentAuthor}` | GitHub login of the comment author | `commentActions` |

**Custom tokens** — any name defined in the action's `tokens` array is available as `{tokenName}`.

**Transform steps** — add a `replace` array to any token to post-process the extracted value with chained regex replacements. Each step runs in order:

```jsonc
"tokens": [
  {
    "name": "branch",
    "source": "commentBody",
    "regex": "/deploy (.+)",
    "replace": [
      { "pattern": "[^a-zA-Z0-9]", "flags": "g", "with": "" },   // strip non-alphanumeric
      { "pattern": "^-|-$",        "flags": "g", "with": "" }    // trim leading/trailing dashes
    ]
  }
]
```

Each step has:
- `pattern` — JavaScript regex pattern string
- `flags` — regex flags (default `"g"`); common values: `g` (all matches), `i` (case-insensitive), `gi` (both)
- `with` — replacement string (empty string to delete matches); supports `$1`, `$2` capture group references

A single step can be provided as an object instead of a one-element array. Invalid patterns are silently skipped.

**Feedback tokens** (in `feedback` label/toast fields only):

| Token | Resolved value |
|---|---|
| `{error}` | API error message on failure |
| `{count}` | Number of rows triggered (comment actions only) |

**User input prompts** — use `{input:"Label text"}` in any value field to show an input dialog when the button is clicked:

```jsonc
"comment": "/deploy {branchName} --tag {input:\"Release tag\"}",
"inputs": { "version": "{input:\"Build version\"}", "env": "{input:\"Environment\"}" }
```

The dialog collects all prompts at once before dispatch. Cancelling aborts the action. The same label reused in multiple fields is asked only once.

---

### Action Types

All four action types are available in both `prActions` and `commentActions`. Every primary string field supports plain strings or conditional arrays — see [Conditional Values](#conditional-values).

**`comment`** — posts a comment to the PR thread. Use this to trigger slash-command bots (e.g. `/build`, `/deploy`) or leave automated notes.
```jsonc
"action": { "type": "comment", "comment": "/deploy {branchName}" }
```

**`workflow`** — dispatches a `workflow_dispatch` event on a specific workflow file. Use this to trigger CI/CD pipelines with custom inputs.
```jsonc
"action": {
  "type": "workflow",
  "file": "deploy.yaml",
  "inputs": { "branch": "{branchName}", "env": "{input:\"Target environment\"}" }
}
```

**`repositoryDispatch`** — sends a custom event to the repo. Use this to trigger any workflow listening on `on: repository_dispatch`, or to integrate with external systems.
```jsonc
"action": {
  "type": "repositoryDispatch",
  "eventType": "build-triggered",
  "payload": { "branch": "{branchName}", "pr": "{prNumber}" }
}
```

**`deployment`** — creates a GitHub deployment record against the PR branch. Use this to track deployments in GitHub's Deployments tab and integrate with deployment status checks.
```jsonc
"action": {
  "type": "deployment",
  "environment": "staging",
  "payload": { "branch": "{branchName}" }
}
```

---

### Conditional Values

Any primary string field — `comment`, `file`, `eventType`, `environment` — can be set to an array of conditional rules instead of a plain string. Rules are evaluated in order; the first matching one wins. A rule without `if` is an unconditional fallback.

```jsonc
"file": [
  { "if": "version:contains:PR", "value": "deploy_hotfix.yaml" },
  { "value": "deploy_release.yaml" }
]
```

**Condition operators** (`tokenName` is any token defined in the action's `tokens` array):
- `"tokenName:contains:VALUE"` — matches if the token's value contains `VALUE`
- `"tokenName:notContains:VALUE"` — matches if the token's value does not contain `VALUE`

**Works for all action types:**
```jsonc
// Route workflow file based on version type:
"file": [{ "if": "version:contains:PR", "value": "hotfix.yaml" }, { "value": "release.yaml" }]

// Post different comment text:
"comment": [{ "if": "env:contains:prod", "value": "/deploy-prod {version}" }, { "value": "/deploy {version}" }]

// Pick event type conditionally:
"eventType": [{ "if": "profile:contains:sdk", "value": "build-sdk" }, { "value": "build-app" }]
```

---

### Button Feedback

Each action can override what the button shows and which toast fires at each stage. All fields are optional — omit any to use the default.

```jsonc
"feedback": {
  "pending": "⏳ Deploying…",
  "success": {
    "label": "✓ Shipped!",
    "toast": "Triggered {count} deployment(s).",
    "redirect": "workflow_runs"
  },
  "failure": {
    "label": "✗ Oops",
    "toast": "Deploy failed: {error}"
  }
}
```

**`redirect`** options for `feedback.success`:

| Value | Behaviour |
|---|---|
| `none` (default) | Stay on page |
| `comment` | Scroll to / navigate to the posted comment |
| `workflow_runs` | Navigate to `/{repo}/actions` |
| `deployments` | Navigate to `/{repo}/deployments` |

---

### Layered Configuration

```
Repo-specific  (repos["owner/repo"])   ← highest priority
      ↓
Group config   (first matching group)
      ↓
Global config                          ← lowest priority / fallback
```

**Merge rules**
- Nested objects merge field-by-field
- `prActions` and `commentActions` arrays **replace** the inherited value by default; set `prActionsMode: "extend"` or `commentActionsMode: "extend"` on a group/repo config to append instead
- `repoFilter` and `tokenPresets` are global-only

**Group matching** — each pattern in `group.repos` is tested as an exact string, then as a regex. The first matching group wins.

**Exclusion bypass** — repos listed in `repos` always bypass `repoFilter`.

---

## How It Works

1. **Content script** (`content.js`) runs on every `github.com` page and uses a `MutationObserver` to watch for PR pages and comment threads
2. PR action buttons are injected into the PR header (and sticky header); each hides itself for configured states
3. Comment action buttons are injected inline next to matching links — hidden until hover, auto-hidden after 5 seconds
4. On click: if the action has `{input:"..."}` tokens, an input dialog is shown first. Once confirmed, the action is dispatched to the background service worker
5. The background service worker (`background.js`) calls the GitHub API, resolves config layering, and returns success or error
6. The button updates to the configured feedback state; a toast appears bottom-right
7. If a `redirect` is configured, the page navigates after a short delay
8. Config and token live in `chrome.storage.sync` and hot-reload without a page refresh

---

## Permissions

| Permission | Why |
|---|---|
| `storage` | Save your GitHub token and config |
| `host_permissions: https://api.github.com/*` | Validate token, dispatch workflows, post comments, create deployments |

No analytics, no phone-home, no data read beyond what is visible on the current PR page.

---

## Development

```bash
git clone https://github.com/Mostly-Works-Studio/LazyGithub.git
cd LazyGithub
```

Load the folder as an unpacked extension (`chrome://extensions` → Developer mode → Load unpacked).

There is no build step — the extension is plain JavaScript.

### File Overview

| File | Purpose |
|---|---|
| `config-defaults.js` | Single source of truth for `DEFAULT_CONFIG` — loaded by all three JS contexts |
| `manifest.json` | Chrome extension manifest (MV3) |
| `content.js` | Injected into GitHub pages — scans PR pages, resolves config, injects buttons, handles `{input:"..."}` prompts |
| `background.js` | Service worker — GitHub API calls, config layering, action executor for all four action types |
| `options.html` | Settings page UI — tabbed editor (Global, Groups, Repos), JSON modal |
| `options.js` | Settings page logic — card builders, drag-sort, validation, save/discard/reset/JSON |
| `onboarding.html` | First-run onboarding page |
| `onboarding.js` | Onboarding logic — step progression and inline token validation |
| `icon*.png` | Extension icons at 16, 32, 48, 128, 256, 512 px |

---

## Contributing

Contributions are welcome. Please open an issue first to discuss what you'd like to change.

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes
4. Open a pull request

If LazyGitHub is saving you time, consider [contributing on GitHub](https://github.com/Mostly-Works-Studio/LazyGithub) or sharing it with your team.

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

Made with ❤️ by [Mostly Works Studio](https://panshul.dev/studio)
