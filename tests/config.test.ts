import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { saveProjectConfig, loadProjectConfig, projectConfigExists, resolveBuildOutputDir, saveLastPush, loadLastPush } from '../src/core/config.js';
import type { LastPush, ProjectConfig } from '../src/types/index.js';

const TEST_DIR = join(process.cwd(), '.test-config-tmp');

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe('project config', () => {
  function createConfig(): ProjectConfig {
    return {
      appId: 480,
      depots: [
        {
          depotId: 481,
          contentRoot: './build',
          fileMappings: [{ localPath: '*', depotPath: '.', recursive: true }],
          fileExclusions: ['*.pdb'],
        },
      ],
      buildOutput: '.easy-steam-output',
      setLive: null,
    };
  }

  it('saves and loads config', () => {
    const config = createConfig();

    saveProjectConfig(config, TEST_DIR);
    expect(projectConfigExists(TEST_DIR)).toBe(true);

    const loaded = loadProjectConfig(TEST_DIR);
    expect(loaded).toEqual(config);
  });

  it('returns null when no config exists', () => {
    expect(loadProjectConfig(TEST_DIR)).toBeNull();
    expect(projectConfigExists(TEST_DIR)).toBe(false);
  });

  it('writes valid JSON', () => {
    const config: ProjectConfig = {
      ...createConfig(),
      appId: 12345,
      setLive: 'beta',
    };

    saveProjectConfig(config, TEST_DIR);
    const raw = readFileSync(join(TEST_DIR, '.easy-steam.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.appId).toBe(12345);
    expect(parsed.setLive).toBe('beta');
  });

  it('throws a readable error for malformed project config JSON', () => {
    const configPath = join(TEST_DIR, '.easy-steam.json');
    writeFileSync(configPath, '{ invalid json', 'utf-8');
    expect(() => loadProjectConfig(TEST_DIR)).toThrow(/Invalid JSON/);
  });

  it('throws a readable error for invalid project config semantics', () => {
    const configPath = join(TEST_DIR, '.easy-steam.json');
    writeFileSync(configPath, JSON.stringify({
      appId: 480,
      depots: [
        {
          depotId: 481,
          contentRoot: './build',
          fileMapping: { localPath: 'C:\\abs\\*', depotPath: '.', recursive: true },
          fileExclusions: [],
        },
        {
          depotId: 481,
          contentRoot: './other-build',
          fileMapping: { localPath: '*', depotPath: '.', recursive: true },
          fileExclusions: [],
        },
      ],
      buildOutput: '   ',
      setLive: null,
    }), 'utf-8');

    expect(() => loadProjectConfig(TEST_DIR)).toThrow(/Invalid project config/);
    expect(() => loadProjectConfig(TEST_DIR)).toThrow(/duplicated|non-empty string|absolute/i);
  });

  it('resolves custom build output relative to the project directory', () => {
    expect(resolveBuildOutputDir('.artifacts/steam', TEST_DIR)).toBe(join(TEST_DIR, '.artifacts/steam'));
  });

  it('saves and loads last push data from a custom output directory', () => {
    const outputDir = join(TEST_DIR, '.artifacts/steam');
    const lastPush: LastPush = {
      timestamp: '2026-03-19T00:00:00.000Z',
      buildId: '12345',
      description: 'test build',
      appId: 480,
      success: true,
    };

    saveLastPush(lastPush, outputDir);

    expect(loadLastPush(outputDir)).toEqual(lastPush);
  });

  it('rejects saving invalid project config', () => {
    const invalidConfig = {
      ...createConfig(),
      depots: [],
    } as ProjectConfig;

    expect(() => saveProjectConfig(invalidConfig, TEST_DIR)).toThrow(/at least one depot/i);
  });

  it('loads legacy configs that use a single fileMapping object', () => {
    const configPath = join(TEST_DIR, '.easy-steam.json');
    writeFileSync(configPath, JSON.stringify({
      appId: 480,
      depots: [
        {
          depotId: 481,
          contentRoot: './build',
          fileMapping: { localPath: '*', depotPath: '.', recursive: true },
          fileExclusions: [],
        },
      ],
      buildOutput: '.easy-steam-output',
      setLive: null,
    }), 'utf-8');

    const loaded = loadProjectConfig(TEST_DIR);
    expect(loaded?.depots[0].fileMappings).toEqual([
      { localPath: '*', depotPath: '.', recursive: true },
    ]);
  });
});
