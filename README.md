# boiler

[![npm version](https://img.shields.io/npm/v/%40frinky%2Fboiler)](https://www.npmjs.com/package/@frinky/boiler)
[![npm downloads](https://img.shields.io/npm/dm/%40frinky%2Fboiler)](https://www.npmjs.com/package/@frinky/boiler)
[![license](https://img.shields.io/npm/l/%40frinky%2Fboiler)](./LICENSE)

`boiler` is a CLI for uploading game builds to Steam via SteamCMD.

It generates VDF files, guides Steam login + Steam Guard flows, and gives you a repeatable `login -> init -> push` workflow without manual Steamworks UI steps.

## Table of Contents

- [Why boiler](#why-boiler)
- [Install](#install)
- [Simple Usage (Beginner Friendly)](#simple-usage-beginner-friendly)
- [Command Quick Reference](#command-quick-reference)
- [Command Details](#command-details)
- [Project Config (.boiler.json)](#project-config-boilerjson)
- [CI / Automation](#ci--automation)
- [SteamCMD Behavior](#steamcmd-behavior)
- [Security](#security)
- [Development](#development)
- [License](#license)

## Why boiler

Uploading with raw SteamCMD usually means:

- hand-writing VDF files
- remembering the right command sequence
- re-checking paths and depot mappings every upload
- dealing with Steam Guard prompts manually

`boiler` handles this with:

- interactive project setup (`boiler init`)
- guided login (`boiler login`)
- one-command upload (`boiler push`)
- changed-depot detection (skip unchanged depots)
- `doctor` and `status` commands for preflight and diagnostics

## Install

Global install:

```bash
npm install -g @frinky/boiler
```

Run without installing:

```bash
npx @frinky/boiler --help
```

## Simple Usage (Beginner Friendly)

If this is your first Steam upload, follow this exactly.

### 1. Log in once

```bash
boiler login
```

What happens:

- you enter Steam credentials
- Steam Guard is handled interactively (email/app/mobile prompt)
- `boiler` stores only your username (not your password)

### 2. Create project config

From your game project folder:

```bash
boiler init
```

You will be prompted for:

- Steam App ID
- one or more Depot IDs
- content root folder(s) (for example `./build`)
- include/exclude mapping rules

This creates `.boiler.json` in your project root.

### 3. Upload your build

```bash
boiler push
```

That is the full basic flow.

### 4. Optional: one-off folder override (single depot only)

```bash
boiler push ./dist
```

Use this only when your config has a single depot.

## Command Quick Reference

| Command | What it does |
| --- | --- |
| `boiler login` | Authenticates with Steam and caches session via SteamCMD |
| `boiler init` | Creates `.boiler.json` using an interactive wizard |
| `boiler push [folder]` | Generates VDF and uploads build |
| `boiler status` | Shows config/auth/artifact/upload status |
| `boiler doctor` | Runs preflight checks |
| `boiler help [command]` | Shows CLI help |

Global options:

| Flag | Description |
| --- | --- |
| `-v, --verbose` | Extra logging |
| `--debug` | Debug logging (implies verbose) |

## Command Details

### `boiler login`

Interactive login:

```bash
boiler login
```

Non-interactive (CI/automation):

```bash
BOILER_USERNAME=buildbot \
BOILER_PASSWORD=super-secret \
boiler login --non-interactive
```

Supported automation inputs:

- `--username <name>`
- `--password-env <var>`
- `--guard-code-env <var>`
- `--non-interactive`
- `BOILER_USERNAME`
- `BOILER_PASSWORD`
- `BOILER_GUARD_CODE`
- `BOILER_NON_INTERACTIVE=1`

### `boiler init`

Create or refresh project config:

```bash
boiler init
```

### `boiler push [folder]`

Upload using `.boiler.json`:

```bash
boiler push
```

Examples:

```bash
# Single-depot folder override
boiler push ./build

# One-off upload without config
boiler push ./build --app 480 --depot 481

# Add a build description
boiler push ./build --desc "v1.2.0 release"

# Set a branch live after upload
boiler push ./build --set-live beta

# Preview VDF output without upload
boiler push ./build --dry-run

# Force all depots (skip changed-depot detection)
boiler push --all-depots

# Strict content hashing for change detection
boiler push --content-hash

# Fail if SteamCMD is missing (no auto-download)
boiler push --skip-download
```

Push flags:

| Flag | Description |
| --- | --- |
| `--app <id>` | Steam App ID (overrides config) |
| `--depot <id>` | Steam Depot ID (overrides config) |
| `--desc <text>` | Build description shown in Steamworks |
| `--set-live <branch>` | Sets uploaded build live on a branch |
| `--dry-run` | Prints generated VDF without uploading |
| `--all-depots` | Uploads all configured depots |
| `--content-hash` | Uses strict content hashing (slower, safer) |
| `--skip-download` | Fails if SteamCMD is missing |

Important behavior:

- If `--desc` is omitted, a timestamp-based description is generated.
- Transient SteamCMD failures are retried up to 3 times with exponential backoff.
- Changed-depot detection uploads only depots with changes unless `--all-depots` is set.
- Set `BOILER_CONTENT_HASH=1` to enable strict content hashing by environment variable.
- For multi-depot configs, folder override is blocked to prevent accidental wrong uploads.

### `boiler status`

```bash
boiler status
boiler status --json
```

Shows:

- depot mapping summary
- output/artifact paths
- SteamCMD path detection
- saved username
- cached login state
- last upload details

### `boiler doctor`

```bash
boiler doctor
boiler doctor --json
boiler doctor --json --strict
```

Checks:

- project config validity
- depot content roots
- SteamCMD availability
- saved username
- cached Steam login

### `boiler help [command]`

```bash
boiler help
boiler help push
```

### `boiler` (no args)

Running `boiler` with no args opens an interactive menu for `login`, `init`, `push`, `status`, and `doctor`.

## Project Config (.boiler.json)

`boiler init` creates a `.boiler.json` like this:

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

Notes:

- This file is safe to commit.
- `buildOutput` is where generated VDFs and upload artifacts are written.
- `setLive` is used by default for `push` unless overridden by `--set-live`.
- Legacy configs with single `fileMapping` are still read, but new configs should use `fileMappings`.

If a depot needs multiple Steam `FileMapping` entries:

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

If Steam Guard code entry is required in CI:

```bash
export BOILER_GUARD_CODE=123456
```

## SteamCMD Behavior

`boiler` requires SteamCMD to upload builds.

If SteamCMD is not found, `boiler` can auto-download it from Valve unless you pass `--skip-download`. If SteamCMD is already installed, `boiler` checks your `PATH`, common install locations, and its own managed install directory.

## Security

- Passwords are never stored by `boiler`.
- Only the Steam username is saved in global config.
- SteamCMD handles its own credential caching.
- For automation, use a dedicated Steam account instead of a personal account.

Global config location:

```text
~/.boiler/config.json
```

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
