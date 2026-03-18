import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { validateProjectFilesystemForDoctor } from '../src/commands/doctor.js';
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
        fileMapping: {
          localPath: '*',
          depotPath: '.',
          recursive: true,
        },
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
          fileMapping: { localPath: '*', depotPath: '.', recursive: true },
          fileExclusions: [],
        },
        {
          depotId: 482,
          contentRoot: './also-missing',
          fileMapping: { localPath: '*', depotPath: '.', recursive: true },
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
