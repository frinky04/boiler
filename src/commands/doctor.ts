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

export interface DoctorCheck {
  name: 'project' | 'steamcmd' | 'account' | 'auth';
  level: 'success' | 'warning' | 'error';
  message: string;
  details?: Record<string, string | null>;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  hasErrors: boolean;
  hasWarnings: boolean;
}

export interface DoctorOptions {
  json?: boolean;
  strict?: boolean;
}

export interface DoctorDependencies {
  cwd?: string;
  loadProjectConfig: typeof loadProjectConfig;
  loadGlobalConfig: typeof loadGlobalConfig;
  findSteamCmd: typeof findSteamCmd;
  probeCachedLogin: typeof probeCachedLogin;
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

function addCheck(checks: DoctorCheck[], check: DoctorCheck): void {
  checks.push(check);
}

export async function runDoctorChecks(
  deps: DoctorDependencies = {
    cwd: process.cwd(),
    loadProjectConfig,
    loadGlobalConfig,
    findSteamCmd,
    probeCachedLogin,
  }
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const cwd = deps.cwd ?? process.cwd();

  let project: ProjectConfig | null = null;
  try {
    project = deps.loadProjectConfig(cwd);
    const projectIssues = validateProjectFilesystemForDoctor(project, cwd);
    if (projectIssues.length === 0) {
      addCheck(checks, {
        name: 'project',
        level: 'success',
        message: 'Project config looks valid.',
        details: {
          outputDir: project ? resolveBuildOutputDir(project.buildOutput, cwd) : null,
        },
      });
    } else {
      for (const issue of projectIssues) {
        addCheck(checks, {
          name: 'project',
          level: issue.level === 'warning' ? 'warning' : 'error',
          message: issue.message,
        });
      }
    }
  } catch (err) {
    addCheck(checks, {
      name: 'project',
      level: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  }

  const steamcmdPath = await deps.findSteamCmd();
  if (steamcmdPath) {
    addCheck(checks, {
      name: 'steamcmd',
      level: 'success',
      message: `SteamCMD found at ${steamcmdPath}`,
      details: { path: steamcmdPath },
    });
  } else {
    addCheck(checks, {
      name: 'steamcmd',
      level: 'error',
      message: 'SteamCMD was not found. Install it or run `easy-steam login` once to let easy-steam download it.',
      details: { path: null },
    });
  }

  const global = deps.loadGlobalConfig();
  if (global.username) {
    addCheck(checks, {
      name: 'account',
      level: 'success',
      message: `Saved Steam username: ${global.username}`,
      details: { username: global.username },
    });
  } else {
    addCheck(checks, {
      name: 'account',
      level: 'error',
      message: 'No saved Steam username. Run `easy-steam login` first.',
      details: { username: null },
    });
  }

  if (steamcmdPath && global.username) {
    const loginProbe = await deps.probeCachedLogin(steamcmdPath, global.username);
    if (loginProbe.status === 'valid') {
      addCheck(checks, {
        name: 'auth',
        level: 'success',
        message: loginProbe.message,
      });
    } else if (loginProbe.status === 'unknown') {
      addCheck(checks, {
        name: 'auth',
        level: 'warning',
        message: `${loginProbe.message} Run \`easy-steam login\` if uploads still fail.`,
      });
    } else {
      addCheck(checks, {
        name: 'auth',
        level: 'error',
        message: loginProbe.message,
      });
    }
  }

  return {
    checks,
    hasErrors: checks.some((check) => check.level === 'error'),
    hasWarnings: checks.some((check) => check.level === 'warning'),
  };
}

function printDoctorReport(report: DoctorReport): void {
  logger.banner();

  for (const check of report.checks) {
    if (check.level === 'success') {
      logger.success(check.message);
    } else if (check.level === 'warning') {
      logger.warn(check.message);
    } else {
      logger.error(check.message);
    }

    if (check.name === 'project' && check.details?.outputDir) {
      logger.keyValue('  Output Dir', check.details.outputDir);
    }
  }

  console.log('');
}

export async function doctorCommand(options: DoctorOptions = {}): Promise<void> {
  const report = await runDoctorChecks();

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printDoctorReport(report);
    if (!report.hasErrors && !report.hasWarnings) {
      logger.success('Doctor checks passed.');
    } else if (report.hasWarnings) {
      logger.warn('Doctor completed with warnings.');
    }
  }

  if (report.hasErrors || (options.strict && report.hasWarnings)) {
    process.exit(1);
  }
}
