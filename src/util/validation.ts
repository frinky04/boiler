import { existsSync, statSync } from 'fs';
import { isAbsolute } from 'path';
import type { DepotConfig, DepotFileMapping, ProjectConfig } from '../types/index.js';

export function validateAppId(value: string): number | string {
  const n = parseInt(value, 10);
  if (isNaN(n) || n <= 0) return 'App ID must be a positive number';
  return n;
}

export function validateDepotId(value: string): number | string {
  const n = parseInt(value, 10);
  if (isNaN(n) || n <= 0) return 'Depot ID must be a positive number';
  return n;
}

export function validateDirectory(path: string): true | string {
  if (!existsSync(path)) return `Directory does not exist: ${path}`;
  if (!statSync(path).isDirectory()) return `Not a directory: ${path}`;
  return true;
}

export function isValidAppId(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

export function isValidDepotId(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isAbsoluteLocalPath(value: string): boolean {
  return isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value);
}

function normalizeDepotFileMappings(depot: Record<string, unknown>): DepotFileMapping[] | null {
  const rawFileMappings = depot.fileMappings;
  const rawFileMapping = depot.fileMapping;

  if (Array.isArray(rawFileMappings)) {
    return rawFileMappings as DepotFileMapping[];
  }

  if (isRecord(rawFileMapping)) {
    return [rawFileMapping as unknown as DepotFileMapping];
  }

  return null;
}

export function validateProjectConfig(config: unknown): string[] {
  if (!isRecord(config)) {
    return ['Config must be a JSON object.'];
  }

  const issues: string[] = [];
  const appId = config.appId;
  const depots = config.depots;
  const buildOutput = config.buildOutput;
  const setLive = config.setLive;

  if (!isValidAppId(appId as number)) {
    issues.push('`appId` must be a positive integer.');
  }

  if (!Array.isArray(depots) || depots.length === 0) {
    issues.push('`depots` must contain at least one depot.');
  }

  if (!isNonEmptyString(buildOutput)) {
    issues.push('`buildOutput` must be a non-empty string.');
  }

  if (setLive !== null && setLive !== undefined && !isNonEmptyString(setLive)) {
    issues.push('`setLive` must be a non-empty string or null.');
  }

  if (!Array.isArray(depots)) {
    return issues;
  }

  const seenDepotIds = new Set<number>();

  depots.forEach((depot, index) => {
    if (!isRecord(depot)) {
      issues.push(`Depot ${index + 1} must be an object.`);
      return;
    }

    if (!isValidDepotId(depot.depotId as number)) {
      issues.push(`Depot ${index + 1} has an invalid \`depotId\`.`);
    } else if (seenDepotIds.has(depot.depotId as number)) {
      issues.push(`Depot ID ${depot.depotId as number} is duplicated.`);
    } else {
      seenDepotIds.add(depot.depotId as number);
    }

    if (!isNonEmptyString(depot.contentRoot)) {
      issues.push(`Depot ${index + 1} has an invalid \`contentRoot\`.`);
    }

    if (!Array.isArray(depot.fileExclusions) || depot.fileExclusions.some((value) => typeof value !== 'string')) {
      issues.push(`Depot ${index + 1} must define \`fileExclusions\` as an array of strings.`);
    }

    const fileMappings = normalizeDepotFileMappings(depot);
    if (!Array.isArray(fileMappings) || fileMappings.length === 0) {
      issues.push(`Depot ${index + 1} must define \`fileMappings\` as a non-empty array.`);
      return;
    }

    fileMappings.forEach((mapping, mappingIndex) => {
      if (!isRecord(mapping)) {
        issues.push(`Depot ${index + 1} file mapping ${mappingIndex + 1} must be an object.`);
        return;
      }

      if (!isNonEmptyString(mapping.localPath)) {
        issues.push(`Depot ${index + 1} file mapping ${mappingIndex + 1} has an invalid \`localPath\`.`);
      } else if (isAbsoluteLocalPath(mapping.localPath)) {
        issues.push(`Depot ${index + 1} file mapping ${mappingIndex + 1} must not use an absolute \`localPath\`.`);
      }

      if (!isNonEmptyString(mapping.depotPath)) {
        issues.push(`Depot ${index + 1} file mapping ${mappingIndex + 1} has an invalid \`depotPath\`.`);
      }

      if (typeof mapping.recursive !== 'boolean') {
        issues.push(`Depot ${index + 1} file mapping ${mappingIndex + 1} must define \`recursive\` as a boolean.`);
      }
    });
  });

  return issues;
}

function normalizeProjectConfig(config: Record<string, unknown>): ProjectConfig {
  const depots = (config.depots as Record<string, unknown>[]).map((depot) => ({
    depotId: depot.depotId as number,
    contentRoot: depot.contentRoot as string,
    fileMappings: normalizeDepotFileMappings(depot) as DepotFileMapping[],
    fileExclusions: depot.fileExclusions as string[],
  })) satisfies DepotConfig[];

  return {
    appId: config.appId as number,
    depots,
    buildOutput: config.buildOutput as string,
    setLive: (config.setLive as string | null | undefined) ?? null,
  };
}

export function assertValidProjectConfig(config: unknown, source: string): ProjectConfig {
  const issues = validateProjectConfig(config);
  if (issues.length === 0) {
    return normalizeProjectConfig(config as Record<string, unknown>);
  }

  throw new Error(`Invalid project config in ${source}:\n- ${issues.join('\n- ')}`);
}
