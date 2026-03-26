import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { buildPushPlan, prepareDepotsForVdf, resolvePushDepots, resolveSteamCmdPathForPush, runPrePushValidation, resolveDepotSelectionForPush, ensureCachedLoginReadyForPush } from '../src/commands/push.js';
import type { DepotConfig, ProjectConfig, PushOptions } from '../src/types/index.js';

const TEST_DIR = join(process.cwd(), '.test-push-tmp');

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

function createDepot(depotId: number, contentRoot: string, localPath: string = '*'): DepotConfig {
  return {
    depotId,
    contentRoot,
    fileMappings: [{
      localPath,
      depotPath: '.',
      recursive: true,
    }],
    fileExclusions: [],
  };
}

function createProjectConfig(depots: DepotConfig[]): ProjectConfig {
  return {
    appId: 480,
    depots,
    buildOutput: '.boiler-output',
    setLive: null,
  };
}

function createPushPlan(depots: DepotConfig[]) {
  return {
    appId: 480,
    depots,
    description: 'build test',
    outputDir: join(TEST_DIR, 'output'),
    setLive: null,
  };
}

describe('prepareDepotsForVdf', () => {
  it('keeps local path for a single depot', () => {
    const depot = createDepot(1001, './build');
    const result = prepareDepotsForVdf([depot]);

    expect(result.depots).toHaveLength(1);
    expect(result.depots[0].fileMappings[0].localPath).toBe('*');
  });

  it('prefixes local paths for multiple depot roots', () => {
    const result = prepareDepotsForVdf([
      createDepot(2001, './build/win'),
      createDepot(2002, './build/linux', '*.so'),
    ]);

    expect(result.depots[0].fileMappings[0].localPath).toBe('win/*');
    expect(result.depots[1].fileMappings[0].localPath).toBe('linux/*.so');
  });

  it('throws for absolute file mapping localPath values', () => {
    const depot = createDepot(3001, './build', 'C:\\abs\\*');
    expect(() => prepareDepotsForVdf([depot])).toThrow(/absolute localPath/i);
  });

  it('rewrites every file mapping relative to the shared content root', () => {
    const result = prepareDepotsForVdf([
      {
        depotId: 3002,
        contentRoot: './build/win',
        fileMappings: [
          { localPath: '*', depotPath: '.', recursive: true },
          { localPath: 'extras/*.dll', depotPath: './bin', recursive: false },
        ],
        fileExclusions: [],
      },
      createDepot(3003, './build/linux'),
    ]);

    expect(result.depots[0].fileMappings[0].localPath).toBe('win/*');
    expect(result.depots[0].fileMappings[1].localPath).toBe('win/extras/*.dll');
  });
});

describe('resolvePushDepots', () => {
  it('uses a one-off depot when --depot and folder are provided', () => {
    const options: PushOptions = { depot: 481 };
    const depots = resolvePushDepots('./build', options, null);

    expect(depots).toEqual([
      {
        depotId: 481,
        contentRoot: './build',
        fileMappings: [{ localPath: '*', depotPath: '.', recursive: true }],
        fileExclusions: [],
      },
    ]);
  });

  it('rejects --depot without a folder', () => {
    expect(() => resolvePushDepots(undefined, { depot: 481 }, null)).toThrow(/requires a folder/i);
  });

  it('allows folder override for single-depot configs', () => {
    const project = createProjectConfig([createDepot(481, './old-build')]);
    const depots = resolvePushDepots('./new-build', {}, project);

    expect(depots).toHaveLength(1);
    expect(depots[0].contentRoot).toBe('./new-build');
  });

  it('rejects folder override for multi-depot configs', () => {
    const project = createProjectConfig([
      createDepot(481, './build/win'),
      createDepot(482, './build/linux'),
    ]);

    expect(() => resolvePushDepots('./dist', {}, project)).toThrow(/single-depot projects/i);
  });
});

describe('buildPushPlan', () => {
  it('uses config values and computes a deterministic description', () => {
    const project = createProjectConfig([createDepot(481, './build')]);
    project.buildOutput = '.artifacts/steam';
    project.setLive = 'beta';

    const plan = buildPushPlan(undefined, {}, project, new Date('2026-03-19T12:34:56.000Z'));

    expect(plan.appId).toBe(480);
    expect(plan.description).toBe('build 2026-03-19 12:34:56');
    expect(plan.outputDir).toMatch(/\.artifacts[\\/]steam$/);
    expect(plan.setLive).toBe('beta');
  });

  it('lets CLI options override config values', () => {
    const project = createProjectConfig([createDepot(481, './build')]);

    const plan = buildPushPlan('./dist', { app: 999, desc: 'release', setLive: 'rc' }, project);

    expect(plan.appId).toBe(999);
    expect(plan.description).toBe('release');
    expect(plan.setLive).toBe('rc');
    expect(plan.depots[0].contentRoot).toBe('./dist');
  });
});

describe('resolveSteamCmdPathForPush', () => {
  it('fails when SteamCMD is missing and install is not allowed', async () => {
    await expect(resolveSteamCmdPathForPush(
      {},
      {
        findSteamCmd: async () => null,
        downloadSteamCmd: async () => '/tmp/steamcmd',
      }
    )).rejects.toThrow(/--install-steamcmd/i);
  });

  it('uses an existing SteamCMD install when present', async () => {
    await expect(resolveSteamCmdPathForPush(
      {},
      {
        findSteamCmd: async () => '/usr/bin/steamcmd',
        downloadSteamCmd: async () => '/tmp/steamcmd',
      }
    )).resolves.toBe('/usr/bin/steamcmd');
  });

  it('downloads SteamCMD when explicitly requested', async () => {
    await expect(resolveSteamCmdPathForPush(
      { installSteamcmd: true },
      {
        findSteamCmd: async () => null,
        downloadSteamCmd: async () => '/tmp/steamcmd',
      }
    )).resolves.toBe('/tmp/steamcmd');
  });
});

describe('runPrePushValidation', () => {
  it('reports missing content roots as errors', () => {
    const result = runPrePushValidation(null, [
      createDepot(481, join(TEST_DIR, 'missing-build')),
    ]);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/Content folder not found/i);
  });

  it('reports empty content roots as warnings', () => {
    const emptyDir = join(TEST_DIR, 'empty-build');
    mkdirSync(emptyDir, { recursive: true });

    const result = runPrePushValidation(null, [
      createDepot(481, emptyDir),
    ]);

    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/Content folder is empty/i);
  });

  it('includes config schema errors in the validation result', () => {
    const invalidProject = {
      appId: 0,
      depots: [],
      buildOutput: '',
      setLive: null,
    } as unknown as ProjectConfig;

    const result = runPrePushValidation(invalidProject, []);
    expect(result.errors.some((error) => error.includes('Config error:'))).toBe(true);
  });
});

describe('resolveDepotSelectionForPush', () => {
  it('skips upload when no depots changed and SetLive is not set', () => {
    const depots = [createDepot(481, join(TEST_DIR, 'win')), createDepot(482, join(TEST_DIR, 'linux'))];
    const plan = createPushPlan(depots);

    const result = resolveDepotSelectionForPush(
      plan,
      {},
      {
        detectChangedDepots: () => ({
          changedDepots: [],
          unchangedDepotIds: [481, 482],
          snapshots: {
            481: { mode: 'metadata', fingerprint: 'a', fileCount: 0, totalBytes: 0, updatedAt: '2026-01-01T00:00:00.000Z' },
            482: { mode: 'metadata', fingerprint: 'b', fileCount: 0, totalBytes: 0, updatedAt: '2026-01-01T00:00:00.000Z' },
          },
        }),
      }
    );

    expect(result.skipUpload).toBe(true);
    expect(result.plan.depots).toHaveLength(2);
  });

  it('keeps upload enabled when SetLive is configured even with no content changes', () => {
    const depots = [createDepot(481, join(TEST_DIR, 'win'))];
    const plan = { ...createPushPlan(depots), setLive: 'beta' };

    const result = resolveDepotSelectionForPush(
      plan,
      {},
      {
        detectChangedDepots: () => ({
          changedDepots: [],
          unchangedDepotIds: [481],
          snapshots: {
            481: { mode: 'metadata', fingerprint: 'a', fileCount: 0, totalBytes: 0, updatedAt: '2026-01-01T00:00:00.000Z' },
          },
        }),
      }
    );

    expect(result.skipUpload).toBe(false);
    expect(result.plan.depots).toHaveLength(1);
  });

  it('filters depots down to only changed depots', () => {
    const depots = [createDepot(481, join(TEST_DIR, 'win')), createDepot(482, join(TEST_DIR, 'linux'))];
    const plan = createPushPlan(depots);

    const result = resolveDepotSelectionForPush(
      plan,
      {},
      {
        detectChangedDepots: () => ({
          changedDepots: [depots[1]],
          unchangedDepotIds: [481],
          snapshots: {
            481: { mode: 'metadata', fingerprint: 'a', fileCount: 0, totalBytes: 0, updatedAt: '2026-01-01T00:00:00.000Z' },
            482: { mode: 'metadata', fingerprint: 'b', fileCount: 0, totalBytes: 0, updatedAt: '2026-01-01T00:00:00.000Z' },
          },
        }),
      }
    );

    expect(result.skipUpload).toBe(false);
    expect(result.plan.depots).toHaveLength(1);
    expect(result.plan.depots[0].depotId).toBe(482);
  });

  it('uses content hashing mode when requested by env', () => {
    const depots = [createDepot(481, join(TEST_DIR, 'win'))];
    const plan = createPushPlan(depots);
    let seenMode: string | undefined;

    const result = resolveDepotSelectionForPush(
      plan,
      {},
      {
        detectChangedDepots: (_depots, _outputDir, options) => {
          seenMode = options?.mode;
          return {
            changedDepots: depots,
            unchangedDepotIds: [],
            snapshots: {
              481: { mode: 'content', fingerprint: 'a', fileCount: 1, totalBytes: 1, updatedAt: '2026-01-01T00:00:00.000Z' },
            },
          };
        },
      },
      { BOILER_CONTENT_HASH: '1' }
    );

    expect(seenMode).toBe('content');
    expect(result.fingerprintMode).toBe('content');
  });
});

describe('ensureCachedLoginReadyForPush', () => {
  it('passes when cached login is valid', async () => {
    await expect(ensureCachedLoginReadyForPush(
      '/usr/bin/steamcmd',
      'buildbot',
      {
        probeCachedLogin: async () => ({
          status: 'valid',
          message: 'Cached Steam login is valid.',
          output: '',
        }),
      }
    )).resolves.toBeUndefined();
  });

  it('fails when cached login is missing', async () => {
    await expect(ensureCachedLoginReadyForPush(
      '/usr/bin/steamcmd',
      'buildbot',
      {
        probeCachedLogin: async () => ({
          status: 'missing',
          message: 'Cached Steam login is missing or expired. Run `boiler login` again.',
          output: '',
        }),
      }
    )).rejects.toThrow(/Run `boiler login` again/i);
  });
});
