# easy-steam

`easy-steam` is a small CLI that makes Steam uploads feel less like paperwork.

It wraps `steamcmd`, generates the VDF files for you, handles Steam Guard login flows, and gives you a cleaner workflow for pushing builds without bouncing around the Steamworks UI.

## Why

Uploading with raw `steamcmd` usually means:

- hand-writing or editing VDF files
- remembering the right command sequence
- dealing with Steam Guard friction
- re-checking paths, depot mappings, and output folders every time

`easy-steam` smooths that out with a project config, interactive setup, safer defaults, and better preflight tooling.

## Features

- Interactive `init` wizard for `.easy-steam.json`
- `login` flow that handles email codes, app codes, and Steam Mobile approval prompts
- `push` command that generates VDFs and runs the upload for you
- Multi-depot support with multiple Steam `FileMapping` entries per depot
- `status` command for config, auth, artifacts, and last upload details
- `doctor` command for preflight validation and CI checks
- JSON output for `status` and `doctor`
- Automatic SteamCMD discovery, with optional auto-download

## Install

```bash
npm install -g easy-steam
```

Or run it directly:

```bash
npx easy-steam
```

## Quick Start

```bash
# 1. Log in to Steam
easy-steam login

# 2. Create .easy-steam.json
easy-steam init

# 3. Upload your build
easy-steam push
```

If your project only has one depot, you can also override the content folder directly:

```bash
easy-steam push ./build
```

## Commands

### `easy-steam login`

Authenticate with Steam and let SteamCMD cache the session. `easy-steam` never stores your password. It only stores your Steam username in global config.

```bash
easy-steam login
```

For CI or automation:

```bash
EASY_STEAM_USERNAME=buildbot \
EASY_STEAM_PASSWORD=super-secret \
easy-steam login --non-interactive
```

Supported login automation inputs:

- `--username <name>`
- `--password-env <var>`
- `--guard-code-env <var>`
- `--non-interactive`
- `EASY_STEAM_USERNAME`
- `EASY_STEAM_PASSWORD`
- `EASY_STEAM_GUARD_CODE`
- `EASY_STEAM_NON_INTERACTIVE=1`

If Steam requires approval in the Steam Mobile app, `easy-steam` will nudge you after a few seconds even if SteamCMD is being quiet about it.

### `easy-steam init`

Create `.easy-steam.json` with an interactive wizard.

It prompts for:

- App ID
- depot IDs
- content roots
- file exclusions
- one or more file mappings per depot

```bash
easy-steam init
```

### `easy-steam push [folder]`

Generate VDF files and upload a build through SteamCMD.

```bash
# Use config from .easy-steam.json
easy-steam push

# Override the content folder for a single-depot project
easy-steam push ./dist

# One-off upload without a config file
easy-steam push ./build --app 480 --depot 481

# Add a build description
easy-steam push ./build --desc "v1.2.0 release"

# Set a branch live after upload
easy-steam push ./build --set-live beta

# Preview generated VDF without uploading
easy-steam push ./build --dry-run

# Fail instead of auto-downloading SteamCMD
easy-steam push --skip-download
```

Important behavior:

- If `--desc` is omitted, `easy-steam` generates a timestamp-based description.
- For projects with multiple configured depots, folder override is intentionally blocked to avoid accidentally uploading the same build to every depot.

Push options:

| Flag | Description |
| --- | --- |
| `--app <id>` | Steam App ID (overrides config) |
| `--depot <id>` | Steam Depot ID (overrides config) |
| `--desc <text>` | Build description visible in Steamworks |
| `--set-live <branch>` | Set build live on a branch after upload |
| `--dry-run` | Print generated VDF files without uploading |
| `--skip-download` | Fail if SteamCMD is missing instead of downloading it |

### `easy-steam status`

Show the current project state, including:

- per-depot mapping details
- output/artifact paths
- detected SteamCMD path
- saved username
- cached login status
- last upload details

```bash
easy-steam status

# Machine-readable output
easy-steam status --json
```

### `easy-steam doctor`

Run preflight checks before uploading.

It checks:

- project config validity
- depot content roots
- SteamCMD availability
- saved username
- cached Steam login

```bash
easy-steam doctor

# JSON output for CI
easy-steam doctor --json

# Exit non-zero on warnings too
easy-steam doctor --json --strict
```

### `easy-steam`

Running `easy-steam` with no arguments opens an interactive menu for `login`, `init`, `push`, `status`, and `doctor`.

## Config

Running `easy-steam init` creates a `.easy-steam.json` file in your project root:

```json
{
  "appId": 480,
  "depots": [
    {
      "depotId": 481,
      "contentRoot": "./build",
      "fileMappings": [
        {
          "localPath": "*",
          "depotPath": ".",
          "recursive": true
        }
      ],
      "fileExclusions": ["*.pdb", "*.map", ".DS_Store", "Thumbs.db"]
    }
  ],
  "buildOutput": ".easy-steam-output",
  "setLive": null
}
```

This file is safe to commit.

Notes:

- `buildOutput` is where generated VDFs and upload artifacts are written
- `setLive` is used by default for `push` unless overridden with `--set-live`
- legacy configs with a single `fileMapping` object are still read automatically, but new configs should use `fileMappings`

If a depot needs more than one Steam `FileMapping`, use multiple entries:

```json
{
  "depotId": 481,
  "contentRoot": "./build",
  "fileMappings": [
    { "localPath": "*", "depotPath": ".", "recursive": true },
    { "localPath": "extras/*.dll", "depotPath": "./bin", "recursive": false }
  ],
  "fileExclusions": ["*.pdb"]
}
```

## CI / Automation

Typical CI flow:

```bash
easy-steam doctor --json --strict
easy-steam login --non-interactive
easy-steam push --skip-download
```

Recommended environment variables:

```bash
export EASY_STEAM_USERNAME=buildbot
export EASY_STEAM_PASSWORD=super-secret
export EASY_STEAM_NON_INTERACTIVE=1
```

If Steam Guard code entry is required in CI, also provide:

```bash
export EASY_STEAM_GUARD_CODE=123456
```

## SteamCMD

`easy-steam` needs SteamCMD to upload builds.

If SteamCMD is not found, `easy-steam` can download it automatically from Valve unless you pass `--skip-download`. If you already have SteamCMD installed, `easy-steam` will look on your `PATH`, in common install locations, and in its own managed install directory.

## Security

- Passwords are never stored by `easy-steam`
- Only the Steam username is saved in global config
- SteamCMD handles its own credential caching
- For automation, use a dedicated Steam account rather than your personal account

Global config is stored in `~/.easy-steam/config.json`.

## Development

```bash
git clone https://github.com/your-username/easy-steam.git
cd easy-steam
npm install
npm run build
npm run dev -- --help
npm test
```

## License

MIT
