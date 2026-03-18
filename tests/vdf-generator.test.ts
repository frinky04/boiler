import { describe, it, expect } from 'vitest';
import { generateAppBuildVdf, generateDepotBuildVdf } from '../src/core/vdf-generator.js';
import type { AppBuildVdfConfig, DepotConfig } from '../src/types/index.js';

describe('generateDepotBuildVdf', () => {
  it('generates basic depot VDF', () => {
    const depot: DepotConfig = {
      depotId: 481,
      contentRoot: './build',
      fileMappings: [{ localPath: '*', depotPath: '.', recursive: true }],
      fileExclusions: [],
    };

    const vdf = generateDepotBuildVdf(depot);
    expect(vdf).toContain('"DepotBuild"');
    expect(vdf).toContain('"DepotID"\t\t"481"');
    expect(vdf).toContain('"LocalPath"\t\t"*"');
    expect(vdf).toContain('"DepotPath"\t\t"."');
    expect(vdf).toContain('"Recursive"\t\t"1"');
  });

  it('includes file exclusions', () => {
    const depot: DepotConfig = {
      depotId: 481,
      contentRoot: './build',
      fileMappings: [{ localPath: '*', depotPath: '.', recursive: true }],
      fileExclusions: ['*.pdb', '*.map'],
    };

    const vdf = generateDepotBuildVdf(depot);
    expect(vdf).toContain('"FileExclusion"\t\t"*.pdb"');
    expect(vdf).toContain('"FileExclusion"\t\t"*.map"');
  });

  it('handles recursive false', () => {
    const depot: DepotConfig = {
      depotId: 500,
      contentRoot: './out',
      fileMappings: [{ localPath: '*.exe', depotPath: '.', recursive: false }],
      fileExclusions: [],
    };

    const vdf = generateDepotBuildVdf(depot);
    expect(vdf).toContain('"Recursive"\t\t"0"');
    expect(vdf).toContain('"LocalPath"\t\t"*.exe"');
  });

  it('supports multiple file mappings in one depot', () => {
    const depot: DepotConfig = {
      depotId: 700,
      contentRoot: './out',
      fileMappings: [
        { localPath: '*.exe', depotPath: '.', recursive: false },
        { localPath: 'extras/*', depotPath: './extras', recursive: true },
      ],
      fileExclusions: [],
    };

    const vdf = generateDepotBuildVdf(depot);
    expect(vdf.match(/"FileMapping"/g)).toHaveLength(2);
    expect(vdf).toContain('"LocalPath"\t\t"extras/*"');
    expect(vdf).toContain('"DepotPath"\t\t"./extras"');
  });

  it('sanitizes quotes and control characters in depot paths', () => {
    const depot: DepotConfig = {
      depotId: 701,
      contentRoot: './out',
      fileMappings: [{ localPath: 'build/"main"\nfiles', depotPath: './live', recursive: true }],
      fileExclusions: ['ignore\tthis'],
    };

    const vdf = generateDepotBuildVdf(depot);
    expect(vdf).toContain('"LocalPath"\t\t"build/\\"main\\" files"');
    expect(vdf).toContain('"FileExclusion"\t\t"ignore this"');
  });
});

describe('generateAppBuildVdf', () => {
  it('generates basic app build VDF', () => {
    const config: AppBuildVdfConfig = {
      appId: 480,
      description: 'Test build',
      contentRoot: 'C:\\game\\build',
      buildOutput: 'C:\\game\\output',
      depots: [
        {
          depotId: 481,
          contentRoot: './build',
          fileMappings: [{ localPath: '*', depotPath: '.', recursive: true }],
          fileExclusions: [],
        },
      ],
    };

    const vdf = generateAppBuildVdf(config);
    expect(vdf).toContain('"AppBuild"');
    expect(vdf).toContain('"AppID"\t\t"480"');
    expect(vdf).toContain('"Desc"\t\t"Test build"');
    expect(vdf).toContain('"Depots"');
    expect(vdf).toContain('"481"\t\t"depot_build_481.vdf"');
  });

  it('includes SetLive when specified', () => {
    const config: AppBuildVdfConfig = {
      appId: 480,
      description: 'Beta build',
      contentRoot: '/game/build',
      buildOutput: '/game/output',
      setLive: 'beta',
      depots: [
        {
          depotId: 481,
          contentRoot: './build',
          fileMappings: [{ localPath: '*', depotPath: '.', recursive: true }],
          fileExclusions: [],
        },
      ],
    };

    const vdf = generateAppBuildVdf(config);
    expect(vdf).toContain('"SetLive"\t\t"beta"');
  });

  it('omits SetLive when null', () => {
    const config: AppBuildVdfConfig = {
      appId: 480,
      description: 'Build',
      contentRoot: '/build',
      buildOutput: '/output',
      setLive: null,
      depots: [
        {
          depotId: 481,
          contentRoot: './build',
          fileMappings: [{ localPath: '*', depotPath: '.', recursive: true }],
          fileExclusions: [],
        },
      ],
    };

    const vdf = generateAppBuildVdf(config);
    expect(vdf).not.toContain('SetLive');
  });

  it('handles multiple depots', () => {
    const config: AppBuildVdfConfig = {
      appId: 480,
      description: 'Multi-depot',
      contentRoot: '/build',
      buildOutput: '/output',
      depots: [
        {
          depotId: 481,
          contentRoot: './build/win',
          fileMappings: [{ localPath: '*', depotPath: '.', recursive: true }],
          fileExclusions: [],
        },
        {
          depotId: 482,
          contentRoot: './build/linux',
          fileMappings: [{ localPath: '*', depotPath: '.', recursive: true }],
          fileExclusions: [],
        },
      ],
    };

    const vdf = generateAppBuildVdf(config);
    expect(vdf).toContain('"481"\t\t"depot_build_481.vdf"');
    expect(vdf).toContain('"482"\t\t"depot_build_482.vdf"');
  });

  it('sanitizes string fields while preserving unicode text', () => {
    const config: AppBuildVdfConfig = {
      appId: 480,
      description: 'Release "café"\nnightly',
      contentRoot: '/build',
      buildOutput: '/output',
      setLive: 'beta\tbranch',
      depots: [
        {
          depotId: 481,
          contentRoot: './build',
          fileMappings: [{ localPath: '*', depotPath: '.', recursive: true }],
          fileExclusions: [],
        },
      ],
    };

    const vdf = generateAppBuildVdf(config);
    expect(vdf).toContain('"Desc"\t\t"Release \\"café\\" nightly"');
    expect(vdf).toContain('"SetLive"\t\t"beta branch"');
  });
});
