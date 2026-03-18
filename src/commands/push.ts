import { resolve } from 'path';
import { existsSync, readdirSync } from 'fs';
import { loadProjectConfig, getOutputDir, saveLastPush } from '../core/config.js';
import { generateAppBuildVdf, generateDepotBuildVdf, writeVdfFiles } from '../core/vdf-generator.js';
import { ensureSteamCmd, runSteamCmd, parseBuildId, parseUploadProgress, isSuccessfulBuild, isLoginFailure, isRateLimited } from '../core/steamcmd.js';
import { getUsername } from '../core/auth.js';
import * as logger from '../util/logger.js';
import type { PushOptions, AppBuildVdfConfig, DepotConfig, LastPush } from '../types/index.js';

export async function pushCommand(folder: string | undefined, options: PushOptions): Promise<void> {
  // 1. Resolve config
  const projectConfig = loadProjectConfig();

  const appId = options.app ?? projectConfig?.appId;
  if (!appId) {
    logger.error('No App ID. Run `easy-steam init` or pass --app <id>.');
    process.exit(1);
  }

  let depots: DepotConfig[];
  if (options.depot && folder) {
    depots = [{
      depotId: options.depot,
      contentRoot: folder,
      fileMapping: { localPath: '*', depotPath: '.', recursive: true },
      fileExclusions: [],
    }];
  } else if (projectConfig?.depots) {
    depots = projectConfig.depots;
    if (folder) {
      depots = depots.map((d) => ({ ...d, contentRoot: folder }));
    }
  } else {
    logger.error('No depot config. Run `easy-steam init` or pass --depot <id> with a folder.');
    process.exit(1);
  }

  // 2. Validate content folders
  for (const depot of depots) {
    const absPath = resolve(depot.contentRoot);
    if (!existsSync(absPath)) {
      logger.error(`Content folder not found: ${absPath}`);
      process.exit(1);
    }
    const files = readdirSync(absPath);
    if (files.length === 0) {
      logger.warn(`Content folder is empty: ${absPath}`);
    }
  }

  let description = options.desc;
  if (!description) {
    const inquirer = (await import('inquirer')).default;
    const { desc } = await inquirer.prompt([
      {
        type: 'input',
        name: 'desc',
        message: 'Build description:',
        default: `easy-steam build ${new Date().toISOString().slice(0, 19)}`,
      },
    ]);
    description = desc as string;
  }
  const outputDir = resolve(getOutputDir());

  const vdfConfig: AppBuildVdfConfig = {
    appId,
    description,
    contentRoot: resolve(depots[0].contentRoot),
    buildOutput: outputDir,
    setLive: options.setLive ?? null,
    depots,
  };

  // 3. Dry run mode
  if (options.dryRun) {
    logger.info('Dry run — generated VDF files:\n');
    console.log('--- app_build.vdf ---');
    console.log(generateAppBuildVdf(vdfConfig));
    console.log('');
    for (const depot of depots) {
      console.log(`--- depot_build_${depot.depotId}.vdf ---`);
      console.log(generateDepotBuildVdf(depot));
      console.log('');
    }
    return;
  }

  // 4. Check auth
  const username = getUsername();
  if (!username) {
    logger.error('Not logged in. Run `easy-steam login` first.');
    process.exit(1);
  }

  // 5. Ensure SteamCMD
  const steamcmdPath = await ensureSteamCmd();

  // 6. Write VDF
  const { appVdfPath } = writeVdfFiles(vdfConfig, outputDir);
  logger.dim(`  VDF written to ${appVdfPath}`);

  // 7. Execute upload
  const spin = logger.spinner(`Uploading App ${appId}...`);
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
          spin.text = `Uploading App ${appId}... ${progress.toFixed(1)}%`;
          return;
        }

        // Build phases SteamCMD reports
        if (/Building depot/i.test(line)) {
          const depotMatch = line.match(/depot\s+(\d+)/i);
          spin.text = `Building depot ${depotMatch?.[1] ?? ''}...`;
        } else if (/Scanning content/i.test(line)) {
          spin.text = 'Scanning content files...';
        } else if (/Uploading content/i.test(line)) {
          spin.text = `Uploading App ${appId}...`;
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
    description,
    appId,
    success: false,
  };

  if (isSuccessfulBuild(combined)) {
    lastPush.success = true;
    saveLastPush(lastPush);
    spin.succeed(`Build uploaded successfully!${buildId ? ` BuildID: ${buildId}` : ''}`);
    logger.dim('  Set it live in the Steamworks dashboard or use --set-live <branch>.');
  } else if (isRateLimited(combined)) {
    saveLastPush(lastPush);
    spin.fail('Rate limited by Steam');
    logger.error('Too many login attempts. Wait 15-30 minutes before trying again.');
    process.exit(1);
  } else if (isLoginFailure(combined)) {
    saveLastPush(lastPush);
    spin.fail('Upload failed — login error');
    logger.error('Your cached credentials may have expired. Run `easy-steam login` again.');
    process.exit(1);
  } else {
    saveLastPush(lastPush);
    spin.fail(`Upload failed (exit code ${result.exitCode})`);
    // Save full log for debugging
    const logPath = resolve(outputDir, 'last-error.log');
    const { writeFileSync } = await import('fs');
    writeFileSync(logPath, combined, 'utf-8');
    logger.error(`Full SteamCMD output saved to ${logPath}`);
    process.exit(1);
  }
}
