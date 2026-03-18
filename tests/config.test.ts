import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { saveProjectConfig, loadProjectConfig, projectConfigExists } from '../src/core/config.js';
import type { ProjectConfig } from '../src/types/index.js';

const TEST_DIR = join(process.cwd(), '.test-config-tmp');

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe('project config', () => {
  it('saves and loads config', () => {
    const config: ProjectConfig = {
      appId: 480,
      depots: [
        {
          depotId: 481,
          contentRoot: './build',
          fileMapping: { localPath: '*', depotPath: '.', recursive: true },
          fileExclusions: ['*.pdb'],
        },
      ],
      buildOutput: '.easy-steam-output',
      setLive: null,
    };

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
      appId: 12345,
      depots: [],
      buildOutput: '.easy-steam-output',
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
});
