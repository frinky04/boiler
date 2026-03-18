import { existsSync, statSync } from 'fs';
import { resolve } from 'path';
import { loadGlobalConfig, loadProjectConfig, resolveBuildOutputDir } from '../core/config.js';
import { findSteamCmd, probeCachedLogin } from '../core/steamcmd.js';
import * as logger from '../util/logger.js';
import type { ProjectConfig } from '../types/index.js';

export interface DoctorIssue {
  level: 'error' | 'warning';
  message: string;
}

export function validateProjectFilesystemForDoctor(project: ProjectConfig | null, cwd: string = process.cwd()): DoctorIssue[] {
  if (!project) {
    return [{ level: 'error', message: 'No `.easy-steam.json` found in the current directory.' }];
  }

  const issues: DoctorIssue[] = [];

  for (const depot of project.depots) {
    const absPath = resolve(cwd, depot.contentRoot);
    if (!existsSync(absPath)) {
      issues.push({ level: 'error', message: `Depot ${depot.depotId} content root does not exist: ${absPath}` });
    } else if (!statSync(absPath).isDirectory()) {
      issues.push({ level: 'error', message: `Depot ${depot.depotId} content root is not a directory: ${absPath}` });
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

  const projectIssues = validateProjectFilesystemForDoctor(project);
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
