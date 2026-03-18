import { describe, it, expect } from 'vitest';
import { prepareDepotsForVdf } from '../src/commands/push.js';
import type { DepotConfig } from '../src/types/index.js';

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
