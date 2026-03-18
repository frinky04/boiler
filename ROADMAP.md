# Roadmap

easy-steam already covers the basic SteamCMD upload path, but it still needs a stronger safety model around uploads, clearer preflight checks, and better multi-depot ergonomics before it is dependable for real production use.

## Near Term

1. Safe upload defaults
   - Prevent ambiguous folder overrides for multi-depot projects.
   - Make output artifacts and status reporting use the same configured output directory.
   - Add a `doctor` command that verifies config, SteamCMD availability, cached auth viability, and depot content roots before upload.

2. Stronger validation
   - Validate `.easy-steam.json` structure and semantics, not just JSON syntax.
   - Catch invalid depot mappings, duplicate depot IDs, invalid branch names, and unsupported absolute local paths before VDF generation.
   - Improve error messages so failures explain exactly what must be fixed.

3. Better testing on critical paths
   - Add command-level tests for `push`, `doctor`, and `status`.
   - Cover multi-depot scenarios, custom `buildOutput`, auth probing, and SteamCMD failure modes.
   - Treat VDF generation and SteamCMD invocation as high-risk surfaces.

## Next

1. CI and automation support
   - Add non-interactive-friendly flows and environment variable support where needed.
   - Make preflight checks usable in build pipelines.
   - Document recommended CI usage patterns for Steam uploads.

2. Multi-depot configuration improvements
   - Support more explicit per-depot overrides.
   - Support richer file mappings without forcing users to hand-edit VDFs.
   - Improve `init` so platform-specific depot layouts are easier to create correctly.

3. Better operational visibility
   - Make `status` and upload output more useful for debugging.
   - Preserve the last generated VDF and upload metadata in one predictable place.
   - Add clearer summaries for build IDs, branch targeting, and failed pushes.

## Later

1. Config evolution
   - Consider a versioned config format with migration support.
   - Add a formal schema and typed validation errors.

2. UX refinements
   - Add targeted subcommands for common maintenance tasks instead of growing `push`.
   - Refine interactive flows for first-time users without reducing scriptability.

3. Packaging and release quality
   - Tighten install behavior across Windows, macOS, and Linux.
   - Improve release automation and smoke-test coverage for published binaries.
