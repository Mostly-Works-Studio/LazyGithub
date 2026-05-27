# LazyDeploy

**Trigger build and deployment workflows directly from GitHub PR comments — no tab switching, no copy-pasting.**

LazyDeploy is a Chrome extension that injects **Build** and **Deploy** buttons next to version strings in GitHub PR comment threads. It reads the version, branch, and deployment profile from the comment and dispatches the appropriate GitHub Actions workflow with a single click.

---

## Features

- **One-click builds** — posts a `/deploy {branchName}` comment (or any custom command) to trigger a build workflow
- **One-click deploys** — dispatches a GitHub Actions workflow with pre-filled inputs extracted from the PR comment
- **Smart workflow routing** — conditional rules pick the right workflow file based on the version string (e.g. hotfix vs. regular release)
- **PR state gating** — hides the Build button on merged or closed PRs
- **Repo exclusion** — skip injecting buttons on repos matching a pattern (e.g. Helm value repos)
- **Author filtering** — show deploy buttons only on comments from specific users or bots (e.g. your CI user)
- **Fully configurable** — all defaults are overridable via a JSON config in the extension settings page

---

## Installation

> The extension is not yet published to the Chrome Web Store. Load it manually:

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the repository folder
5. Open the extension settings (click the LazyDeploy icon in the toolbar) and paste your GitHub Personal Access Token

---

## Configuration

Settings are managed on the **Options page** (click the toolbar icon). Two things to configure:

### GitHub Token

Generate a token at [github.com/settings/tokens](https://github.com/settings/tokens/new) with these scopes:

| Scope | Purpose |
|---|---|
| `repo` | Read PR details and post comments |
| `workflow` | Dispatch GitHub Actions workflows |

### Extension Config

The config is a JSON object editable directly in the settings page. Below is the full reference with defaults.

```jsonc
{
  // Repos matching any of these regex patterns will not get buttons injected.
  // Useful for infrastructure or Helm value repos.
  "excludedRepos": ["-helm-values$"],

  // Only show deploy buttons on comments authored by these users/patterns.
  // Supports regex. Set to [] to show buttons on all comments.
  "commentAuthorFilter": ["groww-ci"],

  // Regex patterns used to extract version and profile from comment text.
  "extraction": {
    "versionRegex": "\\d{12}-(?:PR\\d+-[a-f0-9]+|\\d+)",
    "profileRegex": "Profile\\s*:\\s*(\\S+)",
    "defaultProfile": "default",
    "skippedProfiles": ["sdk"]  // Comments with this profile are skipped
  },

  // The Build button posts this comment to the PR.
  // Supports template token: {branchName}
  "buildComment": "/deploy {branchName}",

  // Build button appearance and visibility rules.
  "buildButton": {
    "label": "🔨 Build",
    "color": "#c95f0a",
    // Hide the Build button when the PR is in one of these states.
    "hiddenOnStates": ["merged", "closed"]
  },

  // One entry per deploy button injected next to each version string.
  "deployButtons": [
    {
      "label": "Deploy to Release",
      "color": "#1f883d",
      // Workflow routing: first matching rule wins. Omit "if" for a catch-all.
      "workflows": [
        { "if": "version:contains:PR", "file": "deploy_to_release_hotfix.yaml" },
        { "file": "deploy_to_release.yaml" }
      ],
      // Inputs passed to the dispatched workflow.
      // Supports template tokens: {version}, {profile}, {prTitle}, {branchName}
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

### Template Tokens

These placeholders are resolved at dispatch time and can be used in `inputs` values and `buildComment`:

| Token | Resolved value |
|---|---|
| `{version}` | Version string extracted from the comment |
| `{profile}` | Deployment profile extracted from the comment |
| `{prTitle}` | Title of the current pull request |
| `{branchName}` | Source branch of the current pull request |

### Workflow Conditions

The `if` field on a workflow entry supports two operators:

- `"version:contains:VALUE"` — matches if the version string contains `VALUE`
- `"version:notContains:VALUE"` — matches if the version string does not contain `VALUE`

The first matching rule in the array is used. A rule without an `if` field is an unconditional fallback.

---

## How It Works

1. **Content script** (`content.js`) runs on every `github.com` page and uses a `MutationObserver` to watch for PR comment threads as they load
2. For each comment, it checks the author filter and extracts the version and profile using the configured regex patterns
3. Matching comments get **Build** and **Deploy** buttons injected inline
4. Clicking a Deploy button dispatches a `workflow_dispatch` event to the GitHub API via the background service worker
5. Clicking Build posts a comment to the PR via the GitHub API
6. Config and token are stored in `chrome.storage.sync` and hot-reloaded without a page refresh

---

## Permissions

| Permission | Why |
|---|---|
| `storage` | Save your GitHub token and config |
| `host_permissions: https://api.github.com/*` | Call the GitHub API to dispatch workflows and post comments |

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
| `content.js` | Injected into GitHub pages — scans comments and injects buttons |
| `background.js` | Service worker — handles GitHub API calls and opens the options page |
| `options.html` | Settings page UI |
| `options.js` | Settings page logic |
| `icon*.png` | Extension icons at 16, 32, 48, 128 px |

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
