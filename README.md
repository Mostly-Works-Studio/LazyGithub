# LazyDeploy

**Trigger build and deployment workflows directly from GitHub PR pages — no tab switching, no copy-pasting.**

LazyDeploy is a Chrome extension that injects action buttons into GitHub pull request pages. Buttons in the PR header trigger per-PR workflows (builds, validations). Buttons next to version strings in PR comments trigger deployment workflows using data extracted directly from the comment.

---

## Features

- **One-click PR actions** — buttons in the PR header trigger any action (comment, workflow dispatch, repository dispatch, or deployment); multiple buttons per repo supported
- **One-click comment actions** — buttons appear next to matching strings in PR comments; dispatch actions using tokens extracted from the comment line
- **Hover-to-reveal comment buttons** — hidden until you hover a version link, auto-hide after 5 seconds of inactivity
- **Conditional values** — any primary string field (`comment`, `file`, `eventType`, `environment`) can route to different values based on token content
- **User input prompts** — use `{ask:"Label"}` in any field to pop up an input dialog at click time, letting users fill in values before dispatch
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

> The extension is not yet published to the Chrome Web Store. Load it manually:

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the repository folder
5. A setup page opens automatically — paste your GitHub Personal Access Token. LazyDeploy validates it against the GitHub API before saving.

> To revisit settings later, click the LazyDeploy icon in the toolbar.

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
  "tokenPresets": [],

  // Buttons in the PR header. Each runs independently.
  "prActions": [
    {
      "label": "Build",
      "color": "#c95f0a",
      "hiddenOnStates": [],   // e.g. ["merged", "closed"]
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
  // onMultiple: "all" — trigger once per extracted row; "first" — trigger for the first row only.
  // authorFilter: show only on comments from matching usernames or regexes; empty = all authors.
  "commentActions": [
    {
      "label": "Deploy",
      "color": "#1f883d",
      "authorFilter": [],
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
        "inputs": { "build_version": "{version}", "env": "{ask:\"Target environment\"}" }
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

**Feedback tokens** (in `feedback` label/toast fields only):

| Token | Resolved value |
|---|---|
| `{error}` | API error message on failure |
| `{count}` | Number of rows triggered (comment actions only) |

**User input prompts** — use `{ask:"Label text"}` in any value field to show an input dialog when the button is clicked:

```jsonc
"comment": "/deploy {branchName} --tag {ask:\"Release tag\"}",
"inputs": { "version": "{ask:\"Build version\"}", "env": "{ask:\"Environment\"}" }
```

The dialog collects all prompts at once before dispatch. Cancelling aborts the action. The same label reused in multiple fields is asked only once.

---

### Action Types

All four action types are available in both `prActions` and `commentActions`. Every primary string field supports plain strings or conditional arrays — see [Conditional Values](#conditional-values).

**`comment`** — posts a comment to the PR thread.
```jsonc
"action": { "type": "comment", "comment": "/deploy {branchName}" }
```

**`workflow`** — dispatches a GitHub Actions workflow.
```jsonc
"action": {
  "type": "workflow",
  "file": "deploy.yaml",
  "inputs": { "branch": "{branchName}", "env": "{ask:\"Target environment\"}" }
}
```

**`repositoryDispatch`** — broadcasts a custom event. Any workflow with `on: repository_dispatch` can react.
```jsonc
"action": {
  "type": "repositoryDispatch",
  "eventType": "build-triggered",
  "payload": { "branch": "{branchName}", "pr": "{prNumber}" }
}
```

**`deployment`** — creates a GitHub deployment against the PR branch.
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
4. On click: if the action has `{ask:"..."}` tokens, an input dialog is shown first. Once confirmed, the action is dispatched to the background service worker
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
git clone https://github.com/Mostly-Works-Studio/lazydeploy.git
cd lazydeploy
```

Load the folder as an unpacked extension (`chrome://extensions` → Developer mode → Load unpacked).

There is no build step — the extension is plain JavaScript.

### File Overview

| File | Purpose |
|---|---|
| `config-defaults.js` | Single source of truth for `DEFAULT_CONFIG` — loaded by all three JS contexts |
| `manifest.json` | Chrome extension manifest (MV3) |
| `content.js` | Injected into GitHub pages — scans PR pages, resolves config, injects buttons, handles `{ask:"..."}` prompts |
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

If LazyDeploy is saving you time, a [review on the Chrome Web Store](https://chromewebstore.google.com/detail/bkcfpabfdbkiillkanaeabaplcodppol) goes a long way. ⭐

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

Made with ❤️ by [Mostly Works Studio](https://panshul.dev/studio)
