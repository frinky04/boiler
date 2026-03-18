import { loadProjectConfig, loadGlobalConfig, loadLastPush, resolveBuildOutputDir } from '../core/config.js';
import { findSteamCmd } from '../core/steamcmd.js';
import * as logger from '../util/logger.js';

export async function statusCommand(): Promise<void> {
  logger.banner();

  // Project config
  const project = loadProjectConfig();
  if (project) {
    const outputDir = resolveBuildOutputDir(project.buildOutput);
    console.log('  Project Config:');
    logger.keyValue('    App ID', project.appId);
    for (const depot of project.depots) {
      logger.keyValue('    Depot', `${depot.depotId} → ${depot.contentRoot}`);
    }
    logger.keyValue('    Build Output', outputDir);
    logger.keyValue('    Set Live', project.setLive);
    console.log('');
  } else {
    logger.dim('  No project config found. Run `easy-steam init`.\n');
  }

  // Global config
  const global = loadGlobalConfig();
  console.log('  Account:');
  logger.keyValue('    Username', global.username);
  console.log('');

  // SteamCMD
  const steamcmd = await findSteamCmd();
  console.log('  SteamCMD:');
  logger.keyValue('    Path', steamcmd ?? 'not found');
  console.log('');

  // Last push
  const lastPush = loadLastPush(resolveBuildOutputDir(project?.buildOutput));
  if (lastPush) {
    console.log('  Last Push:');
    logger.keyValue('    Time', lastPush.timestamp);
    logger.keyValue('    App ID', lastPush.appId);
    logger.keyValue('    Build ID', lastPush.buildId);
    logger.keyValue('    Description', lastPush.description);
    logger.keyValue('    Status', lastPush.success ? 'success' : 'failed');
  }

  console.log('');
}
