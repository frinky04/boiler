import { existsSync, statSync } from 'fs';

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
