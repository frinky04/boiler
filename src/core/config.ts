import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { ProjectConfig, GlobalConfig, LastPush } from '../types/index.js';

const PROJECT_CONFIG_FILE = '.easy-steam.json';
const GLOBAL_DIR = join(homedir(), '.easy-steam');
const GLOBAL_CONFIG_FILE = join(GLOBAL_DIR, 'config.json');
const OUTPUT_DIR = '.easy-steam-output';

export function getProjectConfigPath(cwd: string = process.cwd()): string {
  return join(cwd, PROJECT_CONFIG_FILE);
}

export function getOutputDir(cwd: string = process.cwd()): string {
  return join(cwd, OUTPUT_DIR);
}

export function projectConfigExists(cwd: string = process.cwd()): boolean {
  return existsSync(getProjectConfigPath(cwd));
}

export function loadProjectConfig(cwd: string = process.cwd()): ProjectConfig | null {
  const path = getProjectConfigPath(cwd);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf-8');
  return JSON.parse(raw) as ProjectConfig;
}

export function saveProjectConfig(config: ProjectConfig, cwd: string = process.cwd()): void {
  const path = getProjectConfigPath(cwd);
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

function ensureGlobalDir(): void {
  if (!existsSync(GLOBAL_DIR)) {
    mkdirSync(GLOBAL_DIR, { recursive: true });
  }
}

export function loadGlobalConfig(): GlobalConfig {
  ensureGlobalDir();
  if (!existsSync(GLOBAL_CONFIG_FILE)) {
    return { steamcmdPath: null, username: null };
  }
  const raw = readFileSync(GLOBAL_CONFIG_FILE, 'utf-8');
  return JSON.parse(raw) as GlobalConfig;
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

export function saveLastPush(data: LastPush, cwd: string = process.cwd()): void {
  const dir = getOutputDir(cwd);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'last-push.json'), JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

export function loadLastPush(cwd: string = process.cwd()): LastPush | null {
  const path = join(getOutputDir(cwd), 'last-push.json');
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8')) as LastPush;
}
