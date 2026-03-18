import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getStatusReport } from '../src/commands/status.js';
import type { ProjectConfig } from '../src/types/index.js';

const TEST_DIR = join(process.cwd(), '.test-status-tmp');

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

function createProjectConfig(): ProjectConfig {
  return {
    appId: 480,
    depots: [
      {
        depotId: 481,
        contentRoot: './build',
        fileMappings: [
          { localPath: '*', depotPath: '.', recursive: true },
          { localPath: 'extras/*.dll', depotPath: './bin', recursive: false },
        ],
        fileExclusions: ['*.pdb'],
      },
    ],
    buildOutput: '.artifacts/steam',
    setLive: 'beta',
  };
}

describe('getStatusReport', () => {
  it('reports project details, artifacts, and valid cached auth', async () => {
    const outputDir = join(TEST_DIR, '.artifacts/steam');
    const vdfDir = join(outputDir, 'vdf');
    mkdirSync(join(TEST_DIR, 'build'), { recursive: true });
    mkdirSync(vdfDir, { recursive: true });
    writeFileSync(join(outputDir, 'last-push.json'), JSON.stringify({
      timestamp: '2026-03-20T00:00:00.000Z',
      buildId: '12345',
      description: 'release',
      appId: 480,
      success: true,
    }), 'utf-8');
    writeFileSync(join(outputDir, 'last-error.log'), 'error', 'utf-8');

    const report = await getStatusReport({
      cwd: TEST_DIR,
      loadProjectConfig: () => createProjectConfig(),
      loadGlobalConfig: () => ({ steamcmdPath: '/usr/bin/steamcmd', username: 'buildbot' }),
      loadLastPush: (dir?: string) => {
        if (dir !== outputDir) throw new Error(`Unexpected loadLastPush dir: ${dir}`);
        return {
          timestamp: '2026-03-20T00:00:00.000Z',
          buildId: '12345',
          description: 'release',
          appId: 480,
          success: true,
        };
      },
      findSteamCmd: async () => '/usr/bin/steamcmd',
      probeCachedLogin: async () => ({
        status: 'valid',
        message: 'Cached Steam login is valid.',
        output: '',
      }),
    });

    expect(report.project?.buildOutput).toBe(outputDir);
    expect(report.project?.depots[0].fileMappingCount).toBe(2);
    expect(report.project?.depots[0].fileMappings[1].depotPath).toBe('./bin');
    expect(report.account.authStatus).toBe('valid');
    expect(report.artifacts.vdfDirExists).toBe(true);
    expect(report.artifacts.lastErrorLogExists).toBe(true);
    expect(report.lastPush?.buildId).toBe('12345');
  });

  it('reports when auth cannot be checked because prerequisites are missing', async () => {
    const report = await getStatusReport({
      cwd: TEST_DIR,
      loadProjectConfig: () => null,
      loadGlobalConfig: () => ({ steamcmdPath: null, username: null }),
      loadLastPush: () => null,
      findSteamCmd: async () => null,
      probeCachedLogin: async () => ({
        status: 'valid',
        message: 'should not be used',
        output: '',
      }),
    });

    expect(report.project).toBeNull();
    expect(report.account.authStatus).toBe('not_checked');
    expect(report.account.authMessage).toMatch(/No saved Steam username/i);
    expect(report.steamcmd.path).toBeNull();
  });
});
