import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { runDoctorChecks, validateProjectFilesystemForDoctor } from '../src/commands/doctor.js';
import type { ProjectConfig } from '../src/types/index.js';

const TEST_DIR = join(process.cwd(), '.test-doctor-tmp');

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

function createProjectConfig(contentRoot: string): ProjectConfig {
  return {
    appId: 480,
    depots: [
      {
        depotId: 481,
        contentRoot,
        fileMappings: [{
          localPath: '*',
          depotPath: '.',
          recursive: true,
        }],
        fileExclusions: [],
      },
    ],
    buildOutput: '.easy-steam-output',
    setLive: null,
  };
}

describe('validateProjectFilesystemForDoctor', () => {
  it('reports a missing project config', () => {
    const issues = validateProjectFilesystemForDoctor(null, TEST_DIR);

    expect(issues).toContainEqual({
      level: 'error',
      message: 'No `.easy-steam.json` found in the current directory.',
    });
  });

  it('accepts a valid project config', () => {
    const buildDir = join(TEST_DIR, 'build');
    mkdirSync(buildDir, { recursive: true });

    const issues = validateProjectFilesystemForDoctor(createProjectConfig('./build'), TEST_DIR);
    expect(issues).toEqual([]);
  });

  it('reports missing content roots', () => {
    const project: ProjectConfig = {
      appId: 480,
      depots: [
        {
          depotId: 481,
          contentRoot: './missing-build',
          fileMappings: [{ localPath: '*', depotPath: '.', recursive: true }],
          fileExclusions: [],
        },
        {
          depotId: 482,
          contentRoot: './also-missing',
          fileMappings: [{ localPath: '*', depotPath: '.', recursive: true }],
          fileExclusions: [],
        },
      ],
      buildOutput: '.easy-steam-output',
      setLive: null,
    };

    const issues = validateProjectFilesystemForDoctor(project, TEST_DIR);
    expect(issues.some((issue) => issue.message.includes('content root does not exist'))).toBe(true);
  });
});

describe('runDoctorChecks', () => {
  it('returns a success report for a healthy environment', async () => {
    const buildDir = join(TEST_DIR, 'build');
    mkdirSync(buildDir, { recursive: true });

    const report = await runDoctorChecks({
      cwd: TEST_DIR,
      loadProjectConfig: () => createProjectConfig('./build'),
      loadGlobalConfig: () => ({ steamcmdPath: '/usr/bin/steamcmd', username: 'dev-account' }),
      findSteamCmd: async () => '/usr/bin/steamcmd',
      probeCachedLogin: async () => ({
        status: 'valid',
        message: 'Cached Steam login is valid.',
        output: '',
      }),
    });

    expect(report.hasErrors).toBe(false);
    expect(report.hasWarnings).toBe(false);
    expect(report.checks.map((check) => check.name)).toEqual(['project', 'steamcmd', 'account', 'auth']);
  });

  it('returns warning state when auth probing is inconclusive', async () => {
    const buildDir = join(TEST_DIR, 'build');
    mkdirSync(buildDir, { recursive: true });

    const report = await runDoctorChecks({
      cwd: TEST_DIR,
      loadProjectConfig: () => createProjectConfig('./build'),
      loadGlobalConfig: () => ({ steamcmdPath: '/usr/bin/steamcmd', username: 'dev-account' }),
      findSteamCmd: async () => '/usr/bin/steamcmd',
      probeCachedLogin: async () => ({
        status: 'unknown',
        message: 'SteamCMD returned exit code 0 without a clear login result.',
        output: '',
      }),
    });

    expect(report.hasErrors).toBe(false);
    expect(report.hasWarnings).toBe(true);
    expect(report.checks.some((check) => check.level === 'warning')).toBe(true);
  });
});
