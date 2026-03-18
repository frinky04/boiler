# AGENTS.md

## Task Completion Requirements

- Both `npm run build` (tsc) and `npm test` (Vitest) must pass before considering tasks completed.
- Use `npm test` to run the test suite (runs `vitest run` under the hood).

## Project Snapshot

boiler is a CLI tool for uploading game builds to Steam via SteamCMD. It replaces manual VDF editing and Steamworks GUI navigation with simple commands: `login`, `init`, `push`, and `status`.

This is an early-stage project. Improvements to structure and maintainability are welcome.

## Core Priorities

1. Correctness first — generated VDF files and SteamCMD invocations must be exactly right, as bad uploads can break live game builds.
2. Cross-platform support — must work on Windows, macOS, and Linux. Use `src/util/platform.ts` for platform-specific logic.
3. Keep the CLI ergonomic — sensible defaults, clear error messages, minimal required flags.

## Architecture

- `src/index.ts`: CLI entry point (Commander.js). Registers commands and the interactive menu fallback.
- `src/commands/`: One file per CLI command (`login`, `init`, `push`, `status`). Each exports a function that Commander calls.
- `src/core/`: Business logic — `steamcmd.ts` (SteamCMD discovery/invocation), `vdf-generator.ts` (VDF file generation), `config.ts` (project config loading/saving), `auth.ts` (credential handling).
- `src/util/`: Cross-cutting utilities — `platform.ts`, `logger.ts`, `validation.ts`.
- `src/wizard/`: Interactive prompts (`interactive.ts` for the no-args menu).
- `src/types/`: Shared TypeScript types.
- `tests/`: Vitest test files mirroring the core modules.

## Key Dependencies

- **Commander** — CLI framework and argument parsing.
- **Inquirer** — Interactive prompts (login, init wizard, interactive menu).
- **Conf** — Global config storage (`~/.boiler/config.json`).
- **chalk/ora** — Terminal output formatting and spinners.
- **which** — Finding SteamCMD on PATH.

## Security

- Never store or log Steam passwords. Passwords are passed to SteamCMD once and discarded.
- Only the Steam username is persisted (via Conf in `~/.boiler/config.json`).
- `.boiler.json` (project config) contains no secrets and is safe to commit.
- Be careful with `child_process` calls to SteamCMD — always validate/sanitize inputs to avoid command injection.

## Testing

- Tests live in `tests/` and use Vitest.
- Test files correspond to core modules: `config.test.ts`, `vdf-generator.test.ts`, `steamcmd.test.ts`, `push.test.ts`.
- Mock external dependencies (SteamCMD, filesystem) rather than requiring a real Steam setup.
- When adding new core functionality, add corresponding tests.
