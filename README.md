# LazyDeploy

**Trigger build and deployment workflows directly from GitHub PR comments — no tab switching, no copy-pasting.**

LazyDeploy is a Chrome extension that injects **Build** and **Deploy** buttons next to version strings in GitHub PR comment threads. It reads the version, branch, and deployment profile from the comment and dispatches the appropriate GitHub Actions workflow with a single click.

---

## Features

- **One-click builds** — triggers a build via PR comment, workflow dispatch, repository dispatch, or GitHub deployment — configurable per repo
- **One-click deploys** — dispatches a GitHub Actions workflow with pre-filled inputs extracted from the PR comment
- **Hover-to-reveal deploy buttons** — deploy buttons stay hidden until you hover over a version link, keeping the UI clean; they auto-hide after 5 seconds of no interaction
- **Smart workflow routing** — conditional rules pick the right workflow file based on the version string (e.g. hotfix vs. regular release)
- **PR state gating** — hides the Build button on merged or closed PRs
- **Repo exclusion** — skip injecting buttons on repos matching a pattern (e.g. Helm value repos)
- **Author filtering** — show deploy buttons only on comments from specific users or bots (e.g. your CI user)
- **Live feedback** — success and error toasts appear bottom-right; buttons show inline loading, success, and failure states
- **Layered per-repo config** — global defaults, group overrides (regex or repo list), and repo-specific overrides; highest specificity wins
- **Tabbed config editor** — settings split into Global, Groups, and Repos tabs; template buttons scaffold new entries; Discard Changes rolls back unsaved edits without touching the saved state

---

## Installation

> The extension is not yet published to the Chrome Web Store. Load it manually:

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the repository folder
5. A setup page opens automatically — paste your GitHub Personal Access Token directly on the setup page. LazyDeploy validates it against the GitHub API instantly before saving.

> If you ever need to revisit settings, click the LazyDeploy icon in the toolbar.

---

## Configuration

On first install, the onboarding page handles token setup inline — no separate settings tab needed. For subsequent token updates or workflow configuration, open the **Options page** (click the toolbar icon).

### GitHub Token

Generate a token at [github.com/settings/tokens](https://github.com/settings/tokens/new) with these scopes:

| Scope | Purpose |
|---|---|
| `repo` | Read PR details and post comments |
| `workflow` | Dispatch GitHub Actions workflows |

Paste the token on the onboarding page or the settings page. Both validate it against the GitHub API instantly — showing `✓ Authenticated as @username` on success or a specific error (invalid token, missing scopes) before you hit Save. Tokens shorter than 20 characters are rejected outright.

### Extension Config

The settings page splits configuration into three focused tabs. Click **Save Config** to write all at once. **Discard Changes** reverts all tabs to the last saved state without touching storage. **Reset to Defaults** restores the full factory config.

#### Global tab

Applies to all repos unless overridden by a group or repo-specific entry. All keys here — including `buildButton` — can be overridden at the group or repo level.

```jsonc
{
  // Repos matching any of these regex patterns will not get buttons injected.
  "excludedRepos": [],

  // Only show deploy buttons on comments authored by these users/patterns.
  // Supports regex. Set to [] to show buttons on all comments.
  "commentAuthorFilter": [],

  // Regex patterns used to extract version and profile from comment text.
  "extraction": {
    "versionRegex": "\\d{12}-(?:PR\\d+-[a-f0-9]+|\\d+)",
    "profileRegex": "Profile\\s*:\\s*(\\S+)",
    "defaultProfile": "default",
    "skippedProfiles": ["sdk"]
  },

  // Build button appearance, visibility, and the action it triggers on click.
  "buildButton": {
    "label": "🔨 Build",
    "color": "#c95f0a",
    "hiddenOnStates": ["merged", "closed"],
    "action": { "type": "comment", "comment": "/deploy {branchName}" }
  },

  // One entry per deploy button injected next to each version string.
  "deployButtons": [
    {
      "label": "Deploy to Release",
      "color": "#1f883d",
      "workflows": [
        { "if": "version:contains:PR", "file": "deploy_to_release_hotfix.yaml" },
        { "file": "deploy_to_release.yaml" }
      ],
      "inputs": {
        "build_version": "{version}",
        "additional_comments": "{prTitle}",
        "build_profile": "{profile}"
      }
    },
    {
      "label": "Deploy to Prod",
      "color": "#0969da",
      "workflows": [{ "file": "deploy_to_prod.yaml" }],
      "inputs": {
        "build_version": "{version}",
        "additional_comments": "{prTitle}",
        "build_profile": "{profile}"
      }
    }
  ]
}
```

#### Groups tab

A JSON array. Each entry applies to a set of repos matched by exact name or regex — first matching group wins. Only specify the keys that differ from global; everything else inherits. Arrays like `deployButtons` replace entirely; nested objects like `extraction` merge field-by-field.

Click **+ Add Group** to insert a pre-filled template.

```jsonc
[
  {
    "repos": ["myorg/js-service", "myorg/frontend-.*"],
    "config": {
      "buildButton": {
        "action": { "type": "comment", "comment": "/js-deploy {branchName}" }
      },
      "deployButtons": [
        {
          "label": "Deploy JS",
          "color": "#8250df",
          "workflows": [{ "file": "deploy_js.yaml" }],
          "inputs": { "build_version": "{version}" }
        }
      ]
    }
  }
]
```

#### Repos tab

A JSON object keyed by exact repo name (`owner/repo`, no regex). Overrides both global and any matching group config. A repo listed here is never excluded by `excludedRepos`, even if it matches a pattern there.

Click **+ Add Repo** to insert a pre-filled template.

```jsonc
{
  "myorg/special-repo": {
    "deployButtons": [
      {
        "label": "Ship It",
        "color": "#cf222e",
        "workflows": [{ "file": "ship.yaml" }],
        "inputs": { "build_version": "{version}" }
      }
    ]
  }
}
```

### Template Tokens

These placeholders are resolved at dispatch time and can be used in `inputs`, `payload`, and string fields of `buildButton.action`:

| Token | Resolved value |
|---|---|
| `{version}` | Version string extracted from the comment |
| `{profile}` | Deployment profile extracted from the comment |
| `{prTitle}` | Title of the current pull request |
| `{branchName}` | Source branch of the current pull request |
| `{prNumber}` | PR number — available in `buildButton.action` fields only |
| `{repo}` | Repository in `owner/repo` format — available in `buildButton.action` fields only |

### Build Action Types

`buildButton.action` supports four types. Each demands only the metadata it needs.

**`comment`** — posts a comment to the PR. Triggers bots or webhooks listening for slash commands.
```jsonc
"action": { "type": "comment", "comment": "/deploy {branchName}" }
```

**`workflow`** — dispatches a specific GitHub Actions workflow via `workflow_dispatch`.
```jsonc
"action": {
  "type": "workflow",
  "file": "build.yaml",
  "inputs": { "branch": "{branchName}", "pr_title": "{prTitle}" }
}
```

**`repositoryDispatch`** — broadcasts a named custom event. Any workflow with `on: repository_dispatch` can react, making it more decoupled than `workflow`.
```jsonc
"action": {
  "type": "repositoryDispatch",
  "eventType": "build-triggered",
  "payload": { "branch": "{branchName}", "pr": "{prNumber}" }
}
```

**`deployment`** — creates a GitHub deployment against the PR branch. Triggers the deployment event pipeline for teams using GitHub Environments.
```jsonc
"action": {
  "type": "deployment",
  "environment": "staging",
  "payload": { "branch": "{branchName}" }
}
```

### Layered Configuration

Config is resolved in three layers — each layer overrides only the keys it specifies, leaving the rest inherited from the layer below:

```
Repo-specific  (repos["owner/repo"])   ← highest priority
      ↓
Group config   (first matching group)
      ↓
Global config                          ← lowest priority / fallback
```

**Merge rules**
- Nested objects (`extraction`, `buildButton`) are merged field-by-field — you only need to specify what changes
- Arrays (`deployButtons`, `excludedRepos`, `hiddenOnStates`) replace the inherited value entirely

**Group matching** — each entry in `group.repos` is tested as an exact string first, then as a regex. The first group whose `repos` list matches the current repo wins.

**Exclusion bypass** — if a repo has an entry in `repos`, it is never excluded by `excludedRepos`, even if it matches a pattern there.

**Example: 80% Java repos use global config, 10% JS repos use a group, one repo uses its own config**

```jsonc
{
  // Global — applies to all Java repos by default
  "deployButtons": [{ "label": "Deploy Java", ... }],

  "groups": [
    {
      // Matches any repo whose name starts with "js-" or "frontend-"
      "repos": ["myorg/js-.*", "myorg/frontend-.*"],
      "config": {
        "deployButtons": [{ "label": "Deploy JS", ... }]
      }
    }
  ],

  "repos": {
    // This one repo gets its own button, ignoring both global and group
    "myorg/payments-service": {
      "deployButtons": [{ "label": "Ship Payments", ... }]
    }
  }
}
```

### Workflow Conditions

The `if` field on a workflow entry supports two operators:

- `"version:contains:VALUE"` — matches if the version string contains `VALUE`
- `"version:notContains:VALUE"` — matches if the version string does not contain `VALUE`

The first matching rule in the array is used. A rule without an `if` field is an unconditional fallback.

---

## How It Works

1. **Content script** (`content.js`) runs on every `github.com` page and uses a `MutationObserver` to watch for PR comment threads as they load
2. For each comment link that contains a version string (matched by `issuecomment-` anchor), it checks the author filter and extracts the version and profile using the configured regex patterns
3. Matching version links get **Deploy** buttons injected inline — hidden by default, revealed on hover with a 500 ms delay, and auto-hidden after 5 seconds of no interaction
4. A **Build** button is injected into the PR header (and sticky header); it is hidden on merged or closed PRs
5. Clicking a Deploy button dispatches a `workflow_dispatch` event to the GitHub API via the background service worker; clicking Build executes the configured action (comment, workflow dispatch, repository dispatch, or deployment) and scrolls to the new comment if one was posted
6. All actions show inline loading → success/failure states and a toast notification in the bottom-right corner
7. If no GitHub token is configured, hovering any button shows ⚠️ Token required and clicking opens the settings page
8. Config and token are stored in `chrome.storage.sync` and hot-reloaded without a page refresh

---

## Permissions

| Permission | Why |
|---|---|
| `storage` | Save your GitHub token and config |
| `host_permissions: https://api.github.com/*` | Validate your token on paste, dispatch workflows, post comments, and trigger build actions |

No other permissions are requested. The extension does not phone home, collect analytics, or read any data beyond what is visible in the current PR page.

---

## Development

```bash
git clone https://github.com/Mostly-Works-Studio/lazydeploy.git
cd lazydeploy
```

Load the folder as an unpacked extension in Chrome (`chrome://extensions` → Developer mode → Load unpacked).

There is no build step — the extension is plain JavaScript.

### File Overview

| File | Purpose |
|---|---|
| `manifest.json` | Chrome extension manifest (MV3) |
| `content.js` | Injected into GitHub pages — scans comments, resolves layered config, and injects buttons |
| `background.js` | Service worker — handles GitHub API calls and opens the options page |
| `options.html` | Settings page UI — tabbed config editor (Global, Groups, Repos) |
| `options.js` | Settings page logic — tab switching, template insertion, validation, save/discard/reset |
| `onboarding.html` | First-run onboarding page — guides token creation and inline token entry |
| `onboarding.js` | Onboarding logic — step progression, inline token validation, and save |
| `icon*.png` | Extension icons at 16, 32, 48, 128, 256, 512 px |

---

## Contributing

Contributions are welcome. Please open an issue first to discuss what you'd like to change.

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes
4. Open a pull request

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

Made with ❤️ by [Mostly Works Studio](https://github.com/Mostly-Works-Studio)
