import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import type { AppBuildVdfConfig, DepotConfig } from '../types/index.js';
import { toVdfPath } from '../util/platform.js';

function indent(level: number): string {
  return '\t'.repeat(level);
}

export function sanitizeVdfValue(value: string): string {
  return value
    .replace(/\u0000/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/"/g, '\\"');
}

function vdfKeyValue(key: string, value: string, level: number): string {
  return `${indent(level)}"${sanitizeVdfValue(key)}"\t\t"${sanitizeVdfValue(value)}"`;
}

export function generateDepotBuildVdf(depot: DepotConfig): string {
  const lines: string[] = [];
  lines.push('"DepotBuild"');
  lines.push('{');
  lines.push(vdfKeyValue('DepotID', String(depot.depotId), 1));
  lines.push('');

  depot.fileMappings.forEach((mapping, index) => {
    lines.push(`${indent(1)}"FileMapping"`);
    lines.push(`${indent(1)}{`);
    lines.push(vdfKeyValue('LocalPath', mapping.localPath, 2));
    lines.push(vdfKeyValue('DepotPath', mapping.depotPath, 2));
    lines.push(vdfKeyValue('Recursive', mapping.recursive ? '1' : '0', 2));
    lines.push(`${indent(1)}}`);
    if (index < depot.fileMappings.length - 1 || depot.fileExclusions.length > 0) {
      lines.push('');
    }
  });

  for (const exclusion of depot.fileExclusions) {
    lines.push(vdfKeyValue('FileExclusion', exclusion, 1));
  }

  lines.push('}');
  return lines.join('\n');
}

export function generateAppBuildVdf(config: AppBuildVdfConfig): string {
  const lines: string[] = [];
  lines.push('"AppBuild"');
  lines.push('{');
  lines.push(vdfKeyValue('AppID', String(config.appId), 1));
  lines.push(vdfKeyValue('Desc', config.description, 1));
  lines.push(vdfKeyValue('ContentRoot', toVdfPath(config.contentRoot), 1));
  lines.push(vdfKeyValue('BuildOutput', toVdfPath(config.buildOutput), 1));

  if (config.setLive) {
    lines.push(vdfKeyValue('SetLive', config.setLive, 1));
  }

  lines.push('');
  lines.push(`${indent(1)}"Depots"`);
  lines.push(`${indent(1)}{`);

  for (const depot of config.depots) {
    lines.push(vdfKeyValue(String(depot.depotId), `depot_build_${depot.depotId}.vdf`, 2));
  }

  lines.push(`${indent(1)}}`);
  lines.push('}');
  return lines.join('\n');
}

export interface WriteVdfResult {
  appVdfPath: string;
  depotVdfPaths: string[];
}

export function writeVdfFiles(config: AppBuildVdfConfig, outputDir: string): WriteVdfResult {
  const vdfDir = join(outputDir, 'vdf');
  if (!existsSync(vdfDir)) mkdirSync(vdfDir, { recursive: true });

  const appVdfPath = join(vdfDir, `app_build_${config.appId}.vdf`);
  writeFileSync(appVdfPath, generateAppBuildVdf(config), 'utf-8');

  const depotVdfPaths: string[] = [];
  for (const depot of config.depots) {
    const depotPath = join(vdfDir, `depot_build_${depot.depotId}.vdf`);
    writeFileSync(depotPath, generateDepotBuildVdf(depot), 'utf-8');
    depotVdfPaths.push(depotPath);
  }

  return { appVdfPath, depotVdfPaths };
}
