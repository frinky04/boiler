import { existsSync } from 'fs';
import { join } from 'path';
import { loadProjectConfig, loadGlobalConfig, loadLastPush, resolveBuildOutputDir } from '../core/config.js';
import { findSteamCmd, probeCachedLogin, type CachedLoginProbeResult } from '../core/steamcmd.js';
import * as logger from '../util/logger.js';
import type { GlobalConfig, LastPush, ProjectConfig } from '../types/index.js';

export interface StatusOptions {
  json?: boolean;
}

export interface StatusDepotReport {
  depotId: number;
  contentRoot: string;
  fileMappingCount: number;
  fileMappings: Array<{
    localPath: string;
    depotPath: string;
    recursive: boolean;
  }>;
  fileExclusions: string[];
}

export interface StatusReport {
  project: {
    appId: number;
    buildOutput: string;
    setLive: string | null;
    depots: StatusDepotReport[];
  } | null;
  account: {
    username: string | null;
    authStatus: CachedLoginProbeResult['status'] | 'not_checked';
    authMessage: string;
  };
  steamcmd: {
    path: string | null;
  };
  artifacts: {
    outputDir: string;
    vdfDir: string;
    vdfDirExists: boolean;
    lastPushPath: string;
    lastErrorLogPath: string;
    lastErrorLogExists: boolean;
  };
  lastPush: LastPush | null;
}

export interface StatusDependencies {
  cwd?: string;
  loadProjectConfig: typeof loadProjectConfig;
  loadGlobalConfig: typeof loadGlobalConfig;
  loadLastPush: typeof loadLastPush;
  findSteamCmd: typeof findSteamCmd;
  probeCachedLogin: typeof probeCachedLogin;
}

export async function getStatusReport(
  deps: StatusDependencies = {
    cwd: process.cwd(),
    loadProjectConfig,
    loadGlobalConfig,
    loadLastPush,
    findSteamCmd,
    probeCachedLogin,
  }
): Promise<StatusReport> {
  const cwd = deps.cwd ?? process.cwd();
  const project = deps.loadProjectConfig(cwd);
  const global = deps.loadGlobalConfig();
  const steamcmdPath = await deps.findSteamCmd();
  const outputDir = resolveBuildOutputDir(project?.buildOutput, cwd);
  const lastPush = deps.loadLastPush(outputDir);

  let authStatus: StatusReport['account']['authStatus'] = 'not_checked';
  let authMessage = 'Steam login could not be checked.';
  if (!global.username) {
    authMessage = 'No saved Steam username. Run `easy-steam login` first.';
  } else if (!steamcmdPath) {
    authMessage = 'SteamCMD not found, so cached login could not be checked.';
  } else {
    const probe = await deps.probeCachedLogin(steamcmdPath, global.username);
    authStatus = probe.status;
    authMessage = probe.message;
  }

  return {
    project: project ? {
      appId: project.appId,
      buildOutput: outputDir,
      setLive: project.setLive,
      depots: project.depots.map((depot) => ({
        depotId: depot.depotId,
        contentRoot: depot.contentRoot,
        fileMappingCount: depot.fileMappings.length,
        fileMappings: depot.fileMappings.map((mapping) => ({ ...mapping })),
        fileExclusions: [...depot.fileExclusions],
      })),
    } : null,
    account: {
      username: global.username,
      authStatus,
      authMessage,
    },
    steamcmd: {
      path: steamcmdPath,
    },
    artifacts: {
      outputDir,
      vdfDir: join(outputDir, 'vdf'),
      vdfDirExists: existsSync(join(outputDir, 'vdf')),
      lastPushPath: join(outputDir, 'last-push.json'),
      lastErrorLogPath: join(outputDir, 'last-error.log'),
      lastErrorLogExists: existsSync(join(outputDir, 'last-error.log')),
    },
    lastPush,
  };
}

function formatMapping(mapping: StatusDepotReport['fileMappings'][number]): string {
  return `${mapping.localPath} -> ${mapping.depotPath} (${mapping.recursive ? 'recursive' : 'flat'})`;
}

function printStatusReport(report: StatusReport): void {
  logger.banner();

  if (report.project) {
    console.log('  Project Config:');
    logger.keyValue('    App ID', report.project.appId);
    logger.keyValue('    Build Output', report.project.buildOutput);
    logger.keyValue('    Set Live', report.project.setLive);
    for (const depot of report.project.depots) {
      logger.keyValue('    Depot', `${depot.depotId} → ${depot.contentRoot}`);
      logger.keyValue('      File Mappings', depot.fileMappingCount);
      for (const [index, mapping] of depot.fileMappings.entries()) {
        logger.keyValue(`      Mapping ${index + 1}`, formatMapping(mapping));
      }
      logger.keyValue('      File Exclusions', depot.fileExclusions.length || 0);
    }
    console.log('');
  } else {
    logger.dim('  No project config found. Run `easy-steam init`.\n');
  }

  console.log('  Account:');
  logger.keyValue('    Username', report.account.username);
  logger.keyValue('    Cached Login', report.account.authStatus);
  logger.keyValue('    Auth Check', report.account.authMessage);
  console.log('');

  console.log('  SteamCMD:');
  logger.keyValue('    Path', report.steamcmd.path ?? 'not found');
  console.log('');

  console.log('  Artifacts:');
  logger.keyValue('    Output Dir', report.artifacts.outputDir);
  logger.keyValue('    VDF Dir', report.artifacts.vdfDirExists ? report.artifacts.vdfDir : 'not created yet');
  logger.keyValue('    Last Push File', report.lastPush ? report.artifacts.lastPushPath : 'not created yet');
  logger.keyValue('    Last Error Log', report.artifacts.lastErrorLogExists ? report.artifacts.lastErrorLogPath : 'not created yet');
  console.log('');

  if (report.lastPush) {
    console.log('  Last Push:');
    logger.keyValue('    Time', report.lastPush.timestamp);
    logger.keyValue('    App ID', report.lastPush.appId);
    logger.keyValue('    Build ID', report.lastPush.buildId);
    logger.keyValue('    Description', report.lastPush.description);
    logger.keyValue('    Status', report.lastPush.success ? 'success' : 'failed');
  }

  console.log('');
}

export async function statusCommand(options: StatusOptions = {}): Promise<void> {
  const report = await getStatusReport();

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  printStatusReport(report);
}
