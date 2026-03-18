# boiler

`boiler` is a small CLI that makes Steam uploads feel less like paperwork.

It wraps `steamcmd`, generates the VDF files for you, handles Steam Guard login flows, and gives you a cleaner workflow for pushing builds without bouncing around the Steamworks UI.

## Why

Uploading with raw `steamcmd` usually means:

- hand-writing or editing VDF files
- remembering the right command sequence
- dealing with Steam Guard friction
- re-checking paths, depot mappings, and output folders every time

`boiler` smooths that out with a project config, interactive setup, safer defaults, and better preflight tooling.

## Features

- Interactive `init` wizard for `.boiler.json`
- `login` flow that handles email codes, app codes, and Steam Mobile approval prompts
- `push` command that generates VDFs and runs the upload for you
- Multi-depot support with multiple Steam `FileMapping` entries per depot
- Automatic changed-depot detection to skip unchanged depot uploads
- Retry with exponential backoff for transient SteamCMD failures
- `status` command for config, auth, artifacts, and last upload details
- `doctor` command for preflight validation and CI checks
- JSON output for `status` and `doctor`
- Automatic SteamCMD discovery, with optional auto-download
- Global `--verbose` / `--debug` logging modes for troubleshooting
- SteamCMD download progress and extraction fallbacks for minimal CI images

## Install

```bash
npm install -g boiler
```

Or run it directly:

```bash
npx boiler
```

## Quick Start

```bash
# 1. Log in to Steam
boiler login

# 2. Create .boiler.json
boiler init

# 3. Upload your build
boiler push
```

If your project only has one depot, you can also override the content folder directly:

```bash
boiler push ./build
```

## Commands

### `boiler login`

Authenticate with Steam and let SteamCMD cache the session. `boiler` never stores your password. It only stores your Steam username in global config.

```bash
boiler login
```

For CI or automation:

```bash
BOILER_USERNAME=buildbot \
BOILER_PASSWORD=super-secret \
boiler login --non-interactive
```

Supported login automation inputs:

- `--username <name>`
- `--password-env <var>`
- `--guard-code-env <var>`
- `--non-interactive`
- `BOILER_USERNAME`
- `BOILER_PASSWORD`
- `BOILER_GUARD_CODE`
- `BOILER_NON_INTERACTIVE=1`

If Steam requires approval in the Steam Mobile app, `boiler` will nudge you after a few seconds even if SteamCMD is being quiet about it.

### `boiler init`

Create `.boiler.json` with an interactive wizard.

It prompts for:

- App ID
- depot IDs
- content roots
- file exclusions
- one or more file mappings per depot

```bash
boiler init
```

### `boiler push [folder]`

Generate VDF files and upload a build through SteamCMD.

```bash
# Use config from .boiler.json
boiler push

# Override the content folder for a single-depot project
boiler push ./dist

# One-off upload without a config file
boiler push ./build --app 480 --depot 481

# Add a build description
boiler push ./build --desc "v1.2.0 release"

# Set a branch live after upload
boiler push ./build --set-live beta

# Preview generated VDF without uploading
boiler push ./build --dry-run

# Force upload of every depot (disable changed-depot detection)
boiler push --all-depots

# Fail instead of auto-downloading SteamCMD
boiler push --skip-download
```

Important behavior:

- If `--desc` is omitted, `boiler` generates a timestamp-based description.
- `push` retries transient SteamCMD failures up to 3 attempts with exponential backoff.
- For project-config uploads, `push` auto-detects changed depots and uploads only those depots unless `--all-depots` is set.
- For projects with multiple configured depots, folder override is intentionally blocked to avoid accidentally uploading the same build to every depot.

Push options:

| Flag | Description |
| --- | --- |
| `--app <id>` | Steam App ID (overrides config) |
| `--depot <id>` | Steam Depot ID (overrides config) |
| `--desc <text>` | Build description visible in Steamworks |
| `--set-live <branch>` | Set build live on a branch after upload |
| `--dry-run` | Print generated VDF files without uploading |
| `--all-depots` | Upload all configured depots and skip changed-depot detection |
| `--skip-download` | Fail if SteamCMD is missing instead of downloading it |

Global options:

| Flag | Description |
| --- | --- |
| `-v, --verbose` | Enable extra logging |
| `--debug` | Enable debug logging (implies verbose) |

### `boiler status`

Show the current project state, including:

- per-depot mapping details
- output/artifact paths
- detected SteamCMD path
- saved username
- cached login status
- last upload details

```bash
boiler status

# Machine-readable output
boiler status --json
```

### `boiler doctor`

Run preflight checks before uploading.

It checks:

- project config validity
- depot content roots
- SteamCMD availability
- saved username
- cached Steam login

```bash
boiler doctor

# JSON output for CI
boiler doctor --json

# Exit non-zero on warnings too
boiler doctor --json --strict
```

### `boiler`

Running `boiler` with no arguments opens an interactive menu for `login`, `init`, `push`, `status`, and `doctor`.

## Config

Running `boiler init` creates a `.boiler.json` file in your project root:

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
  "buildOutput": ".boiler-output",
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
boiler doctor --json --strict
boiler login --non-interactive
boiler push --skip-download
```

Recommended environment variables:

```bash
export BOILER_USERNAME=buildbot
export BOILER_PASSWORD=super-secret
export BOILER_NON_INTERACTIVE=1
```

If Steam Guard code entry is required in CI, also provide:

```bash
export BOILER_GUARD_CODE=123456
```

## SteamCMD

`boiler` needs SteamCMD to upload builds.

If SteamCMD is not found, `boiler` can download it automatically from Valve unless you pass `--skip-download`. If you already have SteamCMD installed, `boiler` will look on your `PATH`, in common install locations, and in its own managed install directory.

## Security

- Passwords are never stored by `boiler`
- Only the Steam username is saved in global config
- SteamCMD handles its own credential caching
- For automation, use a dedicated Steam account rather than your personal account

Global config is stored in `~/.boiler/config.json`.

## Development

```bash
git clone https://github.com/your-username/boiler.git
cd boiler
npm install
npm run build
npm run dev -- --help
npm test
```

## License

MIT
