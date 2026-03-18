import { existsSync, statSync } from 'fs';
import { resolve, isAbsolute } from 'path';
import { loadGlobalConfig, loadProjectConfig, resolveBuildOutputDir } from '../core/config.js';
import { findSteamCmd, probeCachedLogin } from '../core/steamcmd.js';
import { isValidAppId, isValidDepotId } from '../util/validation.js';
import * as logger from '../util/logger.js';
import type { ProjectConfig } from '../types/index.js';

export interface DoctorIssue {
  level: 'error' | 'warning';
  message: string;
}

function isAbsoluteLocalPath(value: string): boolean {
  return isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value);
}

export function validateProjectConfigForDoctor(project: ProjectConfig | null, cwd: string = process.cwd()): DoctorIssue[] {
  if (!project) {
    return [{ level: 'error', message: 'No `.easy-steam.json` found in the current directory.' }];
  }

  const issues: DoctorIssue[] = [];
  const seenDepotIds = new Set<number>();

  if (!isValidAppId(project.appId)) {
    issues.push({ level: 'error', message: `App ID is invalid: ${project.appId}` });
  }

  if (!project.depots.length) {
    issues.push({ level: 'error', message: 'At least one depot must be configured.' });
  }

  if (!project.buildOutput.trim()) {
    issues.push({ level: 'error', message: '`buildOutput` must not be empty.' });
  }

  if (project.setLive !== null && !project.setLive.trim()) {
    issues.push({ level: 'error', message: '`setLive` must be a branch name or null.' });
  }

  for (const depot of project.depots) {
    if (!isValidDepotId(depot.depotId)) {
      issues.push({ level: 'error', message: `Depot ID is invalid: ${depot.depotId}` });
    }

    if (seenDepotIds.has(depot.depotId)) {
      issues.push({ level: 'error', message: `Duplicate depot ID: ${depot.depotId}` });
    }
    seenDepotIds.add(depot.depotId);

    if (!depot.contentRoot.trim()) {
      issues.push({ level: 'error', message: `Depot ${depot.depotId} is missing a content root.` });
      continue;
    }

    const absPath = resolve(cwd, depot.contentRoot);
    if (!existsSync(absPath)) {
      issues.push({ level: 'error', message: `Depot ${depot.depotId} content root does not exist: ${absPath}` });
    } else if (!statSync(absPath).isDirectory()) {
      issues.push({ level: 'error', message: `Depot ${depot.depotId} content root is not a directory: ${absPath}` });
    }

    if (isAbsoluteLocalPath(depot.fileMapping.localPath)) {
      issues.push({
        level: 'error',
        message: `Depot ${depot.depotId} has an absolute fileMapping.localPath, which is unsupported.`,
      });
    }

    if (!depot.fileMapping.depotPath.trim()) {
      issues.push({ level: 'error', message: `Depot ${depot.depotId} is missing fileMapping.depotPath.` });
    }
  }

  return issues;
}

export async function doctorCommand(): Promise<void> {
  logger.banner();

  let hasErrors = false;
  let hasWarnings = false;

  let project: ProjectConfig | null = null;
  try {
    project = loadProjectConfig();
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const projectIssues = validateProjectConfigForDoctor(project);
  if (projectIssues.length === 0) {
    logger.success('Project config looks valid.');
    logger.keyValue('  Output Dir', resolveBuildOutputDir(project?.buildOutput));
  } else {
    for (const issue of projectIssues) {
      if (issue.level === 'error') {
        hasErrors = true;
        logger.error(issue.message);
      } else {
        hasWarnings = true;
        logger.warn(issue.message);
      }
    }
  }

  const steamcmdPath = await findSteamCmd();
  if (steamcmdPath) {
    logger.success(`SteamCMD found at ${steamcmdPath}`);
  } else {
    hasErrors = true;
    logger.error('SteamCMD was not found. Install it or run `easy-steam login` once to let easy-steam download it.');
  }

  const global = loadGlobalConfig();
  if (global.username) {
    logger.success(`Saved Steam username: ${global.username}`);
  } else {
    hasErrors = true;
    logger.error('No saved Steam username. Run `easy-steam login` first.');
  }

  if (steamcmdPath && global.username) {
    const loginProbe = await probeCachedLogin(steamcmdPath, global.username);
    if (loginProbe.status === 'valid') {
      logger.success(loginProbe.message);
    } else if (loginProbe.status === 'unknown') {
      hasWarnings = true;
      logger.warn(`${loginProbe.message} Run \`easy-steam login\` if uploads still fail.`);
    } else {
      hasErrors = true;
      logger.error(loginProbe.message);
    }
  }

  console.log('');

  if (hasErrors) {
    process.exit(1);
  }

  if (hasWarnings) {
    logger.warn('Doctor completed with warnings.');
    return;
  }

  logger.success('Doctor checks passed.');
}
