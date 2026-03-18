# easy-steam

A butler-like CLI for uploading builds to Steam via SteamCMD. No more manually editing VDF files or navigating the Steamworks GUI — just one command to push your game to Steam.

## Install

```bash
npm install -g easy-steam
```

Or use directly with npx:

```bash
npx easy-steam
```

## Quick Start

```bash
# 1. Log in to Steam (handles Steam Guard)
easy-steam login

# 2. Set up your project
easy-steam init

# 3. Upload your build
easy-steam push ./build
```

That's it. easy-steam generates the VDF files, invokes SteamCMD, and reports the result.

## Commands

### `easy-steam login`

Authenticate with your Steam account. Handles Steam Guard codes interactively. Credentials are cached by SteamCMD itself — easy-steam only stores your username.

```bash
easy-steam login

# Non-interactive login for CI
EASY_STEAM_USERNAME=buildbot \
EASY_STEAM_PASSWORD=super-secret \
easy-steam login --non-interactive
```

For automation, `login` also supports `--username`, `--password-env <var>`, `--guard-code-env <var>`, and the environment variables `EASY_STEAM_USERNAME`, `EASY_STEAM_PASSWORD`, `EASY_STEAM_GUARD_CODE`, and `EASY_STEAM_NON_INTERACTIVE=1`.

### `easy-steam init`

Interactive wizard that creates a `.easy-steam.json` config in your project root. Prompts for your App ID, Depot ID(s), content folder, and file exclusions.

```bash
easy-steam init
```

### `easy-steam push [folder]`

Upload a build to Steam. Reads config from `.easy-steam.json`, generates VDF files, and runs SteamCMD.
If `--desc` is omitted, a timestamp-based description is generated automatically.
For projects with multiple configured depots, folder override is intentionally blocked to avoid accidentally uploading the same build to every depot.

```bash
# Use config from .easy-steam.json
easy-steam push

# Override the content folder
easy-steam push ./dist

# One-off upload without a config file
easy-steam push ./build --app 480 --depot 481

# Add a build description
easy-steam push ./build --desc "v1.2.0 release"

# Auto-set a branch live after upload
easy-steam push ./build --set-live beta

# Preview generated VDF without uploading
easy-steam push ./build --dry-run

# Fail instead of auto-downloading SteamCMD
easy-steam push --skip-download
```

**Options:**

| Flag | Description |
|---|---|
| `--app <id>` | Steam App ID (overrides config) |
| `--depot <id>` | Steam Depot ID (overrides config) |
| `--desc <text>` | Build description visible in Steamworks dashboard |
| `--set-live <branch>` | Set build live on a branch after upload (overrides config `setLive`) |
| `--dry-run` | Print generated VDF files without uploading |
| `--skip-download` | Fail if SteamCMD is missing instead of downloading it automatically |

### `easy-steam status`

Show current project config, build output directory, SteamCMD path, saved username, and last upload info.

```bash
easy-steam status
```

### `easy-steam doctor`

Run preflight checks for project config, depot content roots, SteamCMD availability, saved username, and cached Steam login.

```bash
# Human-readable preflight
easy-steam doctor

# Machine-readable output for CI
easy-steam doctor --json

# Fail on warnings as well as errors
easy-steam doctor --json --strict
```

### `easy-steam` (no arguments)

Launches an interactive menu — pick login, init, push, status, or doctor from a list. Useful if you don't want to remember flags.

## Config

Running `easy-steam init` creates `.easy-steam.json` in your project root:

```json
{
  "appId": 480,
  "depots": [
    {
      "depotId": 481,
      "contentRoot": "./build",
      "fileMapping": {
        "localPath": "*",
        "depotPath": ".",
        "recursive": true
      },
      "fileExclusions": ["*.pdb", "*.map", ".DS_Store", "Thumbs.db"]
    }
  ],
  "buildOutput": ".easy-steam-output",
  "setLive": null
}
```

Commit this file to your repo. It contains no secrets.

Global config (username, SteamCMD path) is stored in `~/.easy-steam/config.json` and is never committed.

`buildOutput` is the directory used for generated VDF/log artifacts, and `setLive` is used by default when running `push` unless you override it with `--set-live`.

## SteamCMD

easy-steam needs SteamCMD to upload builds. On first run, if SteamCMD isn't found on your system, easy-steam will download it automatically from Valve's servers unless you pass `--skip-download`.

You can also install it yourself and easy-steam will find it on your PATH or in common install locations.

## Security

- Passwords are **never stored** by easy-steam. They're passed to SteamCMD once during login, and SteamCMD handles its own credential caching.
- Only your Steam username is saved (in `~/.easy-steam/config.json`).
- Use a dedicated Steam account for automated builds, not your personal account.

## Development

```bash
git clone https://github.com/your-username/easy-steam.git
cd easy-steam
npm install
npm run build
npm run dev -- --help    # run from source
npm test                 # run tests
```

## License

MIT
