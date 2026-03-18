import { describe, it, expect } from 'vitest';
import { prepareDepotsForVdf, resolvePushDepots } from '../src/commands/push.js';
import type { DepotConfig, ProjectConfig, PushOptions } from '../src/types/index.js';

function createDepot(depotId: number, contentRoot: string, localPath: string = '*'): DepotConfig {
  return {
    depotId,
    contentRoot,
    fileMapping: {
      localPath,
      depotPath: '.',
      recursive: true,
    },
    fileExclusions: [],
  };
}

function createProjectConfig(depots: DepotConfig[]): ProjectConfig {
  return {
    appId: 480,
    depots,
    buildOutput: '.easy-steam-output',
    setLive: null,
  };
}

describe('prepareDepotsForVdf', () => {
  it('keeps local path for a single depot', () => {
    const depot = createDepot(1001, './build');
    const result = prepareDepotsForVdf([depot]);

    expect(result.depots).toHaveLength(1);
    expect(result.depots[0].fileMapping.localPath).toBe('*');
  });

  it('prefixes local paths for multiple depot roots', () => {
    const result = prepareDepotsForVdf([
      createDepot(2001, './build/win'),
      createDepot(2002, './build/linux', '*.so'),
    ]);

    expect(result.depots[0].fileMapping.localPath).toBe('win/*');
    expect(result.depots[1].fileMapping.localPath).toBe('linux/*.so');
  });

  it('throws for absolute fileMapping localPath values', () => {
    const depot = createDepot(3001, './build', 'C:\\abs\\*');
    expect(() => prepareDepotsForVdf([depot])).toThrow(/absolute fileMapping\.localPath/i);
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
        fileMapping: { localPath: '*', depotPath: '.', recursive: true },
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
