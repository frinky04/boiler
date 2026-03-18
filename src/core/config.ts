import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import type { ProjectConfig, GlobalConfig, LastPush } from '../types/index.js';
import { assertValidProjectConfig } from '../util/validation.js';

const PROJECT_CONFIG_FILE = '.boiler.json';
const GLOBAL_DIR = join(homedir(), '.boiler');
const GLOBAL_CONFIG_FILE = join(GLOBAL_DIR, 'config.json');
const OUTPUT_DIR = '.boiler-output';

export function getProjectConfigPath(cwd: string = process.cwd()): string {
  return join(cwd, PROJECT_CONFIG_FILE);
}

export function getOutputDir(cwd: string = process.cwd()): string {
  return resolve(cwd, OUTPUT_DIR);
}

export function resolveBuildOutputDir(buildOutput: string | null | undefined, cwd: string = process.cwd()): string {
  return resolve(cwd, buildOutput ?? OUTPUT_DIR);
}

export function projectConfigExists(cwd: string = process.cwd()): boolean {
  return existsSync(getProjectConfigPath(cwd));
}

export function loadProjectConfig(cwd: string = process.cwd()): ProjectConfig | null {
  const path = getProjectConfigPath(cwd);
  if (!existsSync(path)) return null;
  return assertValidProjectConfig(parseJsonFile<unknown>(path), path);
}

export function saveProjectConfig(config: ProjectConfig, cwd: string = process.cwd()): void {
  const path = getProjectConfigPath(cwd);
  assertValidProjectConfig(config, path);
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

function ensureGlobalDir(): void {
  if (!existsSync(GLOBAL_DIR)) {
    mkdirSync(GLOBAL_DIR, { recursive: true });
  }
}

function parseJsonFile<T>(path: string, defaultValue: T | null = null): T {
  const raw = readFileSync(path, 'utf-8');
  try {
    return JSON.parse(raw) as T;
  } catch {
    if (defaultValue !== null) {
      return defaultValue;
    }
    throw new Error(`Invalid JSON in ${path}. Fix the file or regenerate it.`);
  }
}

export function loadGlobalConfig(): GlobalConfig {
  ensureGlobalDir();
  if (!existsSync(GLOBAL_CONFIG_FILE)) {
    return { steamcmdPath: null, username: null };
  }
  return parseJsonFile<GlobalConfig>(GLOBAL_CONFIG_FILE, { steamcmdPath: null, username: null });
}

export function saveGlobalConfig(config: GlobalConfig): void {
  ensureGlobalDir();
  writeFileSync(GLOBAL_CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

export function updateGlobalConfig(updates: Partial<GlobalConfig>): void {
  const current = loadGlobalConfig();
  saveGlobalConfig({ ...current, ...updates });
}

export function getGlobalDir(): string {
  return GLOBAL_DIR;
}

export function saveLastPush(data: LastPush, outputDir: string = getOutputDir()): void {
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, 'last-push.json'), JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

export function loadLastPush(outputDir: string = getOutputDir()): LastPush | null {
  const path = join(outputDir, 'last-push.json');
  if (!existsSync(path)) return null;
  return parseJsonFile<LastPush>(path);
}
