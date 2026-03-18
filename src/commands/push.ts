import { resolve, dirname, relative, isAbsolute } from 'path';
import { existsSync, readdirSync, statSync } from 'fs';
import { loadProjectConfig, resolveBuildOutputDir, saveLastPush } from '../core/config.js';
import { computeDepotStateRecord, detectChangedDepots, persistDepotStateSnapshots, type DepotFingerprintMode, type DepotStateRecord } from '../core/depot-state.js';
import { generateAppBuildVdf, generateDepotBuildVdf, writeVdfFiles } from '../core/vdf-generator.js';
import { ensureSteamCmd, findSteamCmd, runSteamCmdWithRetry, parseBuildId, parseUploadProgress, isSuccessfulBuild, classifySteamCmdFailure } from '../core/steamcmd.js';
import { getUsername } from '../core/auth.js';
import { validateProjectConfig } from '../util/validation.js';
import * as logger from '../util/logger.js';
import type { PushOptions, AppBuildVdfConfig, DepotConfig, DepotFileMapping, LastPush, ProjectConfig } from '../types/index.js';

function isPathWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function findCommonRoot(paths: string[]): string | null {
  if (paths.length === 0) return null;

  let common = resolve(paths[0]);
  for (const path of paths.slice(1)) {
    const candidate = resolve(path);
    while (!isPathWithin(common, candidate)) {
      const next = dirname(common);
      if (next === common) {
        return null;
      }
      common = next;
    }
  }

  return common;
}

function normalizeLocalPath(p: string): string {
  return p.split('\\').join('/').replace(/^\.\/+/, '');
}

function joinLocalPath(prefix: string, localPath: string): string {
  const normalizedPrefix = normalizeLocalPath(prefix).replace(/\/+$/, '');
  const normalizedLocal = normalizeLocalPath(localPath);

  if (!normalizedPrefix || normalizedPrefix === '.') {
    return normalizedLocal || '*';
  }
  if (!normalizedLocal || normalizedLocal === '.') {
    return normalizedPrefix;
  }
  return `${normalizedPrefix}/${normalizedLocal}`;
}

function isAbsolutePath(value: string): boolean {
  return isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value);
}

export interface PreparedDepots {
  contentRoot: string;
  depots: DepotConfig[];
}

export interface PushPlan {
  appId: number;
  depots: DepotConfig[];
  description: string;
  outputDir: string;
  setLive: string | null;
}

export interface PushSteamCmdDependencies {
  ensureSteamCmd: typeof ensureSteamCmd;
  findSteamCmd: typeof findSteamCmd;
}

export interface PrePushValidationResult {
  errors: string[];
  warnings: string[];
}

export interface DepotSelectionResult {
  plan: PushPlan;
  depotSnapshots: Record<number, DepotStateRecord>;
  skipUpload: boolean;
  fingerprintMode: DepotFingerprintMode;
}

export interface DepotSelectionDependencies {
  detectChangedDepots: typeof detectChangedDepots;
}

function parseBooleanEnv(value: string | undefined): boolean {
  return value !== undefined && /^(1|true|yes)$/i.test(value);
}

function resolveDepotFingerprintMode(options: PushOptions, env: NodeJS.ProcessEnv = process.env): DepotFingerprintMode {
  if (options.contentHash || parseBooleanEnv(env.BOILER_CONTENT_HASH)) {
    return 'content';
  }
  return 'metadata';
}

function pickDepotSnapshots(
  snapshots: Record<number, DepotStateRecord>,
  depots: DepotConfig[]
): Record<number, DepotStateRecord> {
  const selected: Record<number, DepotStateRecord> = {};
  for (const depot of depots) {
    const snapshot = snapshots[depot.depotId];
    if (snapshot) {
      selected[depot.depotId] = snapshot;
    }
  }
  return selected;
}

export function resolveDepotSelectionForPush(
  plan: PushPlan,
  options: PushOptions,
  deps: DepotSelectionDependencies = { detectChangedDepots },
  env: NodeJS.ProcessEnv = process.env
): DepotSelectionResult {
  const fingerprintMode = resolveDepotFingerprintMode(options, env);
  let workingPlan = plan;
  let depotSnapshots: Record<number, DepotStateRecord> = {};

  if (options.depot || options.allDepots) {
    if (options.allDepots) {
      logger.verbose('Skipping changed-depot detection because --all-depots is set.');
    }
    return {
      plan: workingPlan,
      depotSnapshots,
      skipUpload: false,
      fingerprintMode,
    };
  }

  try {
    if (fingerprintMode === 'content') {
      logger.verbose('Changed-depot detection is using strict content hashing.');
    }

    const changeDetection = deps.detectChangedDepots(workingPlan.depots, workingPlan.outputDir, { mode: fingerprintMode });
    depotSnapshots = changeDetection.snapshots;

    if (changeDetection.unchangedDepotIds.length > 0) {
      logger.debug(`Unchanged depots: ${changeDetection.unchangedDepotIds.join(', ')}`);
    }

    if (changeDetection.changedDepots.length === 0) {
      if (workingPlan.setLive) {
        logger.warn('No depot content changes detected, but SetLive is configured; forcing upload.');
      } else {
        logger.success('No depot content changes detected. Skipping upload.');
        return {
          plan: workingPlan,
          depotSnapshots,
          skipUpload: true,
          fingerprintMode,
        };
      }
    } else if (changeDetection.changedDepots.length < workingPlan.depots.length) {
      const skipped = workingPlan.depots.length - changeDetection.changedDepots.length;
      logger.info(`Detected ${changeDetection.changedDepots.length} changed depot(s); skipping ${skipped} unchanged depot(s).`);
      workingPlan = {
        ...workingPlan,
        depots: changeDetection.changedDepots,
      };
    }
  } catch (err) {
    logger.warn('Unable to detect changed depots; uploading all configured depots.');
    logger.debug(err instanceof Error ? err.stack ?? err.message : String(err));
    depotSnapshots = {};
  }

  return {
    plan: workingPlan,
    depotSnapshots,
    skipUpload: false,
    fingerprintMode,
  };
}

export function resolvePushDepots(
  folder: string | undefined,
  options: PushOptions,
  projectConfig: ProjectConfig | null
): DepotConfig[] {
  if (options.depot) {
    if (!folder) {
      throw new Error('`--depot` requires a folder argument for a one-off upload.');
    }

    return [{
      depotId: options.depot,
      contentRoot: folder,
      fileMappings: [{ localPath: '*', depotPath: '.', recursive: true }],
      fileExclusions: [],
    }];
  }

  if (!projectConfig?.depots?.length) {
    throw new Error('No depot config. Run `boiler init` or pass --depot <id> with a folder.');
  }

  if (!folder) {
    return projectConfig.depots;
  }

  if (projectConfig.depots.length > 1) {
    throw new Error(
      'Folder override is only supported for single-depot projects. Update `.boiler.json` or run a one-off upload with `boiler push <folder> --app <id> --depot <id>`.'
    );
  }

  return projectConfig.depots.map((depot) => ({ ...depot, contentRoot: folder }));
}

export function prepareDepotsForVdf(depots: DepotConfig[]): PreparedDepots {
  if (depots.length === 0) {
    throw new Error('No depots configured for upload.');
  }

  const absoluteRoots = depots.map((d) => resolve(d.contentRoot));
  const contentRoot = findCommonRoot(absoluteRoots);

  if (!contentRoot) {
    throw new Error('Depot content roots must share a common parent directory.');
  }

  const preparedDepots = depots.map((depot, i) => {
    const rootRelativeToCommon = relative(contentRoot, absoluteRoots[i]);
    const fileMappings: DepotFileMapping[] = depot.fileMappings.map((mapping, mappingIndex) => {
      if (isAbsolutePath(mapping.localPath)) {
        throw new Error(`Depot ${depot.depotId} file mapping ${mappingIndex + 1} has an absolute localPath, which is unsupported.`);
      }

      return {
        ...mapping,
        localPath: joinLocalPath(rootRelativeToCommon, mapping.localPath),
      };
    });

    return {
      ...depot,
      fileMappings,
    };
  });

  return {
    contentRoot,
    depots: preparedDepots,
  };
}

export function buildPushPlan(
  folder: string | undefined,
  options: PushOptions,
  projectConfig: ProjectConfig | null,
  now: Date = new Date()
): PushPlan {
  const appId = options.app ?? projectConfig?.appId;
  if (!appId) {
    throw new Error('No App ID. Run `boiler init` or pass --app <id>.');
  }

  return {
    appId,
    depots: resolvePushDepots(folder, options, projectConfig),
    description: options.desc?.trim() || `build ${now.toISOString().slice(0, 19).replace('T', ' ')}`,
    outputDir: resolveBuildOutputDir(projectConfig?.buildOutput),
    setLive: options.setLive ?? projectConfig?.setLive ?? null,
  };
}

export async function resolveSteamCmdPathForPush(
  options: PushOptions,
  deps: PushSteamCmdDependencies = { ensureSteamCmd, findSteamCmd }
): Promise<string> {
  if (options.skipDownload) {
    const steamcmdPath = await deps.findSteamCmd();
    if (!steamcmdPath) {
      throw new Error('SteamCMD was not found and `--skip-download` is set. Install SteamCMD or remove `--skip-download`.');
    }
    return steamcmdPath;
  }

  return deps.ensureSteamCmd();
}

export function runPrePushValidation(projectConfig: ProjectConfig | null, depots: DepotConfig[]): PrePushValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (projectConfig) {
    for (const issue of validateProjectConfig(projectConfig)) {
      errors.push(`Config error: ${issue}`);
    }
  }

  for (const depot of depots) {
    const absPath = resolve(depot.contentRoot);
    if (!existsSync(absPath)) {
      errors.push(`Content folder not found: ${absPath}`);
      continue;
    }

    try {
      if (!statSync(absPath).isDirectory()) {
        errors.push(`Content root is not a directory: ${absPath}`);
        continue;
      }

      const files = readdirSync(absPath);
      if (files.length === 0) {
        warnings.push(`Content folder is empty: ${absPath}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Unable to read content folder ${absPath}: ${message}`);
    }
  }

  return { errors, warnings };
}

export async function pushCommand(folder: string | undefined, options: PushOptions): Promise<void> {
  // 1. Resolve config
  let projectConfig: ProjectConfig | null = null;
  try {
    projectConfig = loadProjectConfig();
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  let plan: PushPlan;
  try {
    plan = buildPushPlan(folder, options, projectConfig);
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // 2. Pre-push validation gate (config + filesystem checks)
  const validation = runPrePushValidation(projectConfig, plan.depots);
  for (const warning of validation.warnings) {
    logger.warn(warning);
  }
  if (validation.errors.length > 0) {
    for (const error of validation.errors) {
      logger.error(error);
    }
    process.exit(1);
  }

  const depotSelection = resolveDepotSelectionForPush(plan, options);
  plan = depotSelection.plan;
  const depotSnapshots = depotSelection.depotSnapshots;
  if (depotSelection.skipUpload) {
    return;
  }

  let prepared: PreparedDepots;
  try {
    prepared = prepareDepotsForVdf(plan.depots);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(message);
    process.exit(1);
  }

  const vdfConfig: AppBuildVdfConfig = {
    appId: plan.appId,
    description: plan.description,
    contentRoot: prepared.contentRoot,
    buildOutput: plan.outputDir,
    setLive: plan.setLive,
    depots: prepared.depots,
  };

  // 3. Dry run mode
  if (options.dryRun) {
    logger.info('Dry run — generated VDF files:\n');
    console.log('--- app_build.vdf ---');
    console.log(generateAppBuildVdf(vdfConfig));
    console.log('');
    for (const depot of prepared.depots) {
      console.log(`--- depot_build_${depot.depotId}.vdf ---`);
      console.log(generateDepotBuildVdf(depot));
      console.log('');
    }
    return;
  }

  // 4. Check auth
  const username = getUsername();
  if (!username) {
    logger.error('Not logged in. Run `boiler login` first.');
    process.exit(1);
  }

  // 5. Ensure SteamCMD
  let steamcmdPath: string;
  try {
    steamcmdPath = await resolveSteamCmdPathForPush(options);
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // 6. Write VDF
  const { appVdfPath } = writeVdfFiles(vdfConfig, plan.outputDir);
  logger.dim(`  VDF written to ${appVdfPath}`);

  // 7. Execute upload
  const spin = logger.spinner(`Uploading App ${plan.appId}...`);
  spin.start();

  const result = await runSteamCmdWithRetry(
    steamcmdPath,
    ['+login', username, '+run_app_build', appVdfPath, '+quit'],
    {
      timeoutMs: 600_000, // 10 min for large uploads
      onOutput: (line) => {
        // Progress percentage
        const progress = parseUploadProgress(line);
        if (progress !== null) {
          spin.text = `Uploading App ${plan.appId}... ${progress.toFixed(1)}%`;
          return;
        }

        // Build phases SteamCMD reports
        if (/Building depot/i.test(line)) {
          const depotMatch = line.match(/depot\s+(\d+)/i);
          spin.text = `Building depot ${depotMatch?.[1] ?? ''}...`;
        } else if (/Scanning content/i.test(line)) {
          spin.text = 'Scanning content files...';
        } else if (/Uploading content/i.test(line)) {
          spin.text = `Uploading App ${plan.appId}...`;
        } else if (/Processing|Committing/i.test(line)) {
          spin.text = 'Processing build on Steam servers...';
        } else if (/new files|changed files|unchanged/i.test(line)) {
          // File diff summary — show it directly
          logger.dim(`  ${line}`);
        } else if (/Total size|Compressed size/i.test(line)) {
          logger.dim(`  ${line}`);
        }
      },
    },
    {
      maxAttempts: 3,
      initialDelayMs: 2_000,
      backoffMultiplier: 2,
      onRetry: ({ attempt, maxAttempts, delayMs, reason }) => {
        const nextAttempt = attempt + 1;
        logger.warn(
          `SteamCMD attempt ${attempt}/${maxAttempts} failed (${reason}). Retrying in ${Math.round(delayMs / 1000)}s (next attempt ${nextAttempt}/${maxAttempts}).`
        );
      },
    }
  );

  const combined = result.stdout + result.stderr;

  // 8. Report result
  const buildId = parseBuildId(combined);

  const lastPush: LastPush = {
    timestamp: new Date().toISOString(),
    buildId,
    description: plan.description,
    appId: plan.appId,
    success: false,
  };

  if (isSuccessfulBuild(combined)) {
    lastPush.success = true;
    saveLastPush(lastPush, plan.outputDir);
    try {
      const snapshotsToPersist = Object.keys(depotSnapshots).length > 0
        ? pickDepotSnapshots(depotSnapshots, plan.depots)
        : Object.fromEntries(
          plan.depots.map((depot) => [depot.depotId, computeDepotStateRecord(depot, { mode: depotSelection.fingerprintMode })])
        ) as Record<number, DepotStateRecord>;
      persistDepotStateSnapshots(plan.outputDir, snapshotsToPersist);
    } catch (err) {
      logger.warn('Build uploaded, but failed to update depot state cache.');
      logger.debug(err instanceof Error ? err.stack ?? err.message : String(err));
    }
    spin.succeed(`Build uploaded successfully!${buildId ? ` BuildID: ${buildId}` : ''}`);
    logger.dim('  Set it live in the Steamworks dashboard or use --set-live <branch>.');
  } else {
    const failure = classifySteamCmdFailure(combined, result.exitCode);
    saveLastPush(lastPush, plan.outputDir);
    spin.fail(`Upload failed — ${failure.summary}`);
    logger.error(failure.guidance);
    if (failure.retriable) {
      logger.warn('This error looks transient and may succeed on a later retry.');
    }
    // Save full log for debugging
    const logPath = resolve(plan.outputDir, 'last-error.log');
    const { writeFileSync } = await import('fs');
    writeFileSync(logPath, combined, 'utf-8');
    logger.error(`Full SteamCMD output saved to ${logPath}`);
    process.exit(1);
  }
}
