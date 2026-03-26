import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

function loadCliVersion(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const packageJsonPath = resolve(moduleDir, '../../package.json');

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { version?: unknown };
    if (typeof packageJson.version === 'string' && packageJson.version.trim().length > 0) {
      return packageJson.version;
    }
  } catch {
    // Fall through to a safe placeholder when package metadata is unavailable.
  }

  return '0.0.0';
}

export const CLI_VERSION = loadCliVersion();
