import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { basename, join, relative, resolve } from 'path';
import type { DepotConfig, DepotFileMapping } from '../types/index.js';

const DEPOT_STATE_FILE = 'depot-state.json';
export type DepotFingerprintMode = 'metadata' | 'content';

export interface DepotStateRecord {
  mode: DepotFingerprintMode;
  fingerprint: string;
  fileCount: number;
  totalBytes: number;
  updatedAt: string;
}

export interface DepotStateFile {
  version: 1;
  depots: Record<string, DepotStateRecord>;
}

export interface DetectChangedDepotsResult {
  changedDepots: DepotConfig[];
  unchangedDepotIds: number[];
  snapshots: Record<number, DepotStateRecord>;
}

export interface DepotStateOptions {
  mode?: DepotFingerprintMode;
}

interface DepotFileEntry {
  relPath: string;
  size: number;
  mtimeMs: number;
}

function normalizePath(value: string): string {
  return value.split('\\').join('/').replace(/^\.\/+/, '').replace(/\/+/g, '/');
}

function normalizePattern(value: string): string {
  const normalized = normalizePath(value).replace(/^\/+/, '').replace(/\/+$/, '');
  if (!normalized || normalized === '.') return '*';
  return normalized;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function globToRegExp(pattern: string): RegExp {
  let output = '';
  for (const char of pattern) {
    if (char === '*') {
      output += '[^/]*';
    } else if (char === '?') {
      output += '[^/]';
    } else {
      output += escapeRegex(char);
    }
  }
  return new RegExp(`^${output}$`);
}

function matchesMapping(relPath: string, mapping: DepotFileMapping): boolean {
  const pattern = normalizePattern(mapping.localPath);
  const regex = globToRegExp(pattern);
  const hasSlash = pattern.includes('/');

  if (!mapping.recursive) {
    return regex.test(relPath);
  }

  if (!hasSlash) {
    return regex.test(basename(relPath));
  }

  if (regex.test(relPath)) {
    return true;
  }

  const segments = relPath.split('/');
  for (let i = 1; i < segments.length; i++) {
    if (regex.test(segments.slice(i).join('/'))) {
      return true;
    }
  }

  return false;
}

function matchesExclusion(relPath: string, exclusion: string): boolean {
  const pattern = normalizePattern(exclusion);
  const regex = globToRegExp(pattern);

  if (pattern.includes('/')) {
    return regex.test(relPath);
  }

  return regex.test(basename(relPath));
}

function shouldIncludeFile(relPath: string, depot: DepotConfig): boolean {
  const included = depot.fileMappings.some((mapping) => matchesMapping(relPath, mapping));
  if (!included) return false;

  return !depot.fileExclusions.some((pattern) => matchesExclusion(relPath, pattern));
}

function collectDepotFiles(rootDir: string): DepotFileEntry[] {
  const entries: DepotFileEntry[] = [];

  const walk = (currentDir: string): void => {
    for (const name of readdirSync(currentDir)) {
      const fullPath = join(currentDir, name);
      const stats = statSync(fullPath);
      if (stats.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!stats.isFile()) {
        continue;
      }

      entries.push({
        relPath: normalizePath(relative(rootDir, fullPath)),
        size: stats.size,
        mtimeMs: stats.mtimeMs,
      });
    }
  };

  walk(rootDir);
  entries.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return entries;
}

export function computeDepotStateRecord(depot: DepotConfig, options: DepotStateOptions = {}): DepotStateRecord {
  const absoluteRoot = resolve(depot.contentRoot);
  const mode = options.mode ?? 'metadata';

  if (!existsSync(absoluteRoot)) {
    throw new Error(`Depot ${depot.depotId} content root not found: ${absoluteRoot}`);
  }

  if (!statSync(absoluteRoot).isDirectory()) {
    throw new Error(`Depot ${depot.depotId} content root is not a directory: ${absoluteRoot}`);
  }

  const hash = createHash('sha256');
  let fileCount = 0;
  let totalBytes = 0;

  for (const entry of collectDepotFiles(absoluteRoot)) {
    if (!shouldIncludeFile(entry.relPath, depot)) {
      continue;
    }

    fileCount += 1;
    totalBytes += entry.size;
    hash.update(entry.relPath);
    hash.update('\0');
    hash.update(String(entry.size));
    hash.update('\0');
    hash.update(String(Math.floor(entry.mtimeMs)));
    hash.update('\n');

    if (mode === 'content') {
      hash.update(readFileSync(join(absoluteRoot, entry.relPath)));
      hash.update('\n');
    }
  }

  return {
    mode,
    fingerprint: hash.digest('hex'),
    fileCount,
    totalBytes,
    updatedAt: new Date().toISOString(),
  };
}

export function getDepotStatePath(outputDir: string): string {
  return join(outputDir, DEPOT_STATE_FILE);
}

export function loadDepotState(outputDir: string): DepotStateFile {
  const statePath = getDepotStatePath(outputDir);
  if (!existsSync(statePath)) {
    return { version: 1, depots: {} };
  }

  try {
    const parsed = JSON.parse(readFileSync(statePath, 'utf-8')) as Partial<DepotStateFile>;
    if (parsed.version !== 1 || typeof parsed.depots !== 'object' || parsed.depots === null) {
      return { version: 1, depots: {} };
    }

    return {
      version: 1,
      depots: parsed.depots as Record<string, DepotStateRecord>,
    };
  } catch {
    return { version: 1, depots: {} };
  }
}

export function saveDepotState(outputDir: string, state: DepotStateFile): void {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  writeFileSync(getDepotStatePath(outputDir), JSON.stringify(state, null, 2) + '\n', 'utf-8');
}

export function detectChangedDepots(
  depots: DepotConfig[],
  outputDir: string,
  options: DepotStateOptions = {}
): DetectChangedDepotsResult {
  const previousState = loadDepotState(outputDir);
  const mode = options.mode ?? 'metadata';
  const snapshots: Record<number, DepotStateRecord> = {};
  const changedDepots: DepotConfig[] = [];
  const unchangedDepotIds: number[] = [];

  for (const depot of depots) {
    const snapshot = computeDepotStateRecord(depot, { mode });
    snapshots[depot.depotId] = snapshot;

    const previous = previousState.depots[String(depot.depotId)];
    if (
      !previous ||
      previous.mode !== snapshot.mode ||
      previous.fingerprint !== snapshot.fingerprint ||
      previous.fileCount !== snapshot.fileCount ||
      previous.totalBytes !== snapshot.totalBytes
    ) {
      changedDepots.push(depot);
    } else {
      unchangedDepotIds.push(depot.depotId);
    }
  }

  return {
    changedDepots,
    unchangedDepotIds,
    snapshots,
  };
}

export function persistDepotStateSnapshots(
  outputDir: string,
  snapshots: Record<number, DepotStateRecord>
): void {
  const existing = loadDepotState(outputDir);
  const merged: Record<string, DepotStateRecord> = { ...existing.depots };

  for (const [depotId, snapshot] of Object.entries(snapshots)) {
    merged[depotId] = snapshot;
  }

  saveDepotState(outputDir, {
    version: 1,
    depots: merged,
  });
}
