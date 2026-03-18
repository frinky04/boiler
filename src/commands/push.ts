import { resolve, dirname, relative, isAbsolute } from 'path';
import { existsSync, readdirSync, statSync } from 'fs';
import { loadProjectConfig, resolveBuildOutputDir, saveLastPush } from '../core/config.js';
import { generateAppBuildVdf, generateDepotBuildVdf, writeVdfFiles } from '../core/vdf-generator.js';
import { ensureSteamCmd, findSteamCmd, runSteamCmd, parseBuildId, parseUploadProgress, isSuccessfulBuild, isLoginFailure, isRateLimited } from '../core/steamcmd.js';
import { getUsername } from '../core/auth.js';
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

export async function pushCommand(folder: string | undefined, options: PushOptions): Promise<void> {
  // 1. Resolve config
  const projectConfig = loadProjectConfig();

  let plan: PushPlan;
  try {
    plan = buildPushPlan(folder, options, projectConfig);
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // 2. Validate content folders
  for (const depot of plan.depots) {
    const absPath = resolve(depot.contentRoot);
    if (!existsSync(absPath)) {
      logger.error(`Content folder not found: ${absPath}`);
      process.exit(1);
    }

    try {
      if (!statSync(absPath).isDirectory()) {
        logger.error(`Content root is not a directory: ${absPath}`);
        process.exit(1);
      }

      const files = readdirSync(absPath);
      if (files.length === 0) {
        logger.warn(`Content folder is empty: ${absPath}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Unable to read content folder ${absPath}: ${message}`);
      process.exit(1);
    }
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

  const result = await runSteamCmd(
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
    spin.succeed(`Build uploaded successfully!${buildId ? ` BuildID: ${buildId}` : ''}`);
    logger.dim('  Set it live in the Steamworks dashboard or use --set-live <branch>.');
  } else if (isRateLimited(combined)) {
    saveLastPush(lastPush, plan.outputDir);
    spin.fail('Rate limited by Steam');
    logger.error('Too many login attempts. Wait 15-30 minutes before trying again.');
    process.exit(1);
  } else if (isLoginFailure(combined)) {
    saveLastPush(lastPush, plan.outputDir);
    spin.fail('Upload failed — login error');
    logger.error('Your cached credentials may have expired. Run `boiler login` again.');
    process.exit(1);
  } else {
    saveLastPush(lastPush, plan.outputDir);
    spin.fail(`Upload failed (exit code ${result.exitCode})`);
    // Save full log for debugging
    const logPath = resolve(plan.outputDir, 'last-error.log');
    const { writeFileSync } = await import('fs');
    writeFileSync(logPath, combined, 'utf-8');
    logger.error(`Full SteamCMD output saved to ${logPath}`);
    process.exit(1);
  }
}
