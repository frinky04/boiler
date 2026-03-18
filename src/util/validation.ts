import { existsSync, statSync } from 'fs';
import { isAbsolute } from 'path';
import type { ProjectConfig } from '../types/index.js';

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

    if (!isRecord(depot.fileMapping)) {
      issues.push(`Depot ${index + 1} is missing a valid \`fileMapping\` object.`);
      return;
    }

    if (!isNonEmptyString(depot.fileMapping.localPath)) {
      issues.push(`Depot ${index + 1} has an invalid \`fileMapping.localPath\`.`);
    } else if (isAbsoluteLocalPath(depot.fileMapping.localPath)) {
      issues.push(`Depot ${index + 1} must not use an absolute \`fileMapping.localPath\`.`);
    }

    if (!isNonEmptyString(depot.fileMapping.depotPath)) {
      issues.push(`Depot ${index + 1} has an invalid \`fileMapping.depotPath\`.`);
    }

    if (typeof depot.fileMapping.recursive !== 'boolean') {
      issues.push(`Depot ${index + 1} must define \`fileMapping.recursive\` as a boolean.`);
    }
  });

  return issues;
}

export function assertValidProjectConfig(config: unknown, source: string): ProjectConfig {
  const issues = validateProjectConfig(config);
  if (issues.length === 0) {
    return config as ProjectConfig;
  }

  throw new Error(`Invalid project config in ${source}:\n- ${issues.join('\n- ')}`);
}
