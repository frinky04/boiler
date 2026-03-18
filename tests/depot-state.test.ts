import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { join } from 'path';
import { computeDepotStateRecord, detectChangedDepots, loadDepotState, persistDepotStateSnapshots } from '../src/core/depot-state.js';
import type { DepotConfig } from '../src/types/index.js';

const TEST_DIR = join(process.cwd(), '.test-depot-state-tmp');

function createDepot(depotId: number, contentRoot: string, localPath: string = '*', recursive: boolean = true): DepotConfig {
  return {
    depotId,
    contentRoot,
    fileMappings: [{ localPath, depotPath: '.', recursive }],
    fileExclusions: [],
  };
}

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe('computeDepotStateRecord', () => {
  it('honors file mappings and exclusions when fingerprinting', () => {
    const contentDir = join(TEST_DIR, 'content');
    mkdirSync(join(contentDir, 'nested'), { recursive: true });
    writeFileSync(join(contentDir, 'root.txt'), 'root', 'utf-8');
    writeFileSync(join(contentDir, 'nested', 'keep.dll'), 'keep', 'utf-8');
    writeFileSync(join(contentDir, 'nested', 'skip.dll'), 'skip', 'utf-8');

    const depot = createDepot(481, contentDir, '*.dll', true);
    depot.fileExclusions = ['skip.dll'];

    const snapshot = computeDepotStateRecord(depot);
    expect(snapshot.fileCount).toBe(1);
    expect(snapshot.totalBytes).toBe(Buffer.byteLength('keep'));
    expect(snapshot.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('can hash content bytes in strict mode', () => {
    const contentDir = join(TEST_DIR, 'content-strict');
    mkdirSync(contentDir, { recursive: true });
    const filePath = join(contentDir, 'data.bin');
    writeFileSync(filePath, 'ab', 'utf-8');
    const fixedTime = new Date('2026-01-01T00:00:00.000Z');
    utimesSync(filePath, fixedTime, fixedTime);

    const depot = createDepot(999, contentDir);

    const metadataSnapshotA = computeDepotStateRecord(depot, { mode: 'metadata' });
    writeFileSync(filePath, 'cd', 'utf-8'); // same size, new bytes
    utimesSync(filePath, fixedTime, fixedTime); // restore timestamps to keep metadata stable
    const metadataSnapshotB = computeDepotStateRecord(depot, { mode: 'metadata' });
    const contentSnapshotB = computeDepotStateRecord(depot, { mode: 'content' });

    expect(metadataSnapshotA.fingerprint).toBe(metadataSnapshotB.fingerprint);
    expect(metadataSnapshotA.mode).toBe('metadata');
    expect(contentSnapshotB.mode).toBe('content');
    expect(contentSnapshotB.fingerprint).not.toBe(metadataSnapshotB.fingerprint);
  });
});

describe('detectChangedDepots', () => {
  it('detects initial change, then stable state, then content updates', () => {
    const contentDir = join(TEST_DIR, 'content');
    const outputDir = join(TEST_DIR, 'output');
    mkdirSync(contentDir, { recursive: true });
    writeFileSync(join(contentDir, 'game.exe'), 'v1', 'utf-8');

    const depot = createDepot(700, contentDir);

    const first = detectChangedDepots([depot], outputDir);
    expect(first.changedDepots.map((d) => d.depotId)).toEqual([700]);
    persistDepotStateSnapshots(outputDir, first.snapshots);

    const second = detectChangedDepots([depot], outputDir);
    expect(second.changedDepots).toHaveLength(0);
    expect(second.unchangedDepotIds).toEqual([700]);

    writeFileSync(join(contentDir, 'game.exe'), 'v2', 'utf-8');
    const third = detectChangedDepots([depot], outputDir);
    expect(third.changedDepots.map((d) => d.depotId)).toEqual([700]);
  });

  it('merges persisted snapshots without dropping existing depots', () => {
    const outputDir = join(TEST_DIR, 'output');
    persistDepotStateSnapshots(outputDir, {
      100: {
        mode: 'metadata',
        fingerprint: 'a'.repeat(64),
        fileCount: 1,
        totalBytes: 10,
        updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
      },
    });

    persistDepotStateSnapshots(outputDir, {
      200: {
        mode: 'metadata',
        fingerprint: 'b'.repeat(64),
        fileCount: 2,
        totalBytes: 20,
        updatedAt: new Date('2026-01-02T00:00:00.000Z').toISOString(),
      },
    });

    const state = loadDepotState(outputDir);
    expect(Object.keys(state.depots).sort()).toEqual(['100', '200']);
  });
});
