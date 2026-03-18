import chalk from 'chalk';
import ora, { type Ora } from 'ora';

export type LogLevel = 'normal' | 'verbose' | 'debug';

let logLevel: LogLevel = 'normal';

function resolveLogLevelFromEnv(env: NodeJS.ProcessEnv = process.env): LogLevel {
  const value = (env.BOILER_LOG_LEVEL ?? '').trim().toLowerCase();
  if (value === 'debug') return 'debug';
  if (value === 'verbose' || value === 'info') return 'verbose';
  return 'normal';
}

logLevel = resolveLogLevelFromEnv();

export function setLogLevel(level: LogLevel): void {
  logLevel = level;
}

export function getLogLevel(): LogLevel {
  return logLevel;
}

export function isVerboseEnabled(): boolean {
  return logLevel === 'verbose' || logLevel === 'debug';
}

export function isDebugEnabled(): boolean {
  return logLevel === 'debug';
}

export function info(msg: string): void {
  console.log(chalk.blue('ℹ'), msg);
}

export function success(msg: string): void {
  console.log(chalk.green('✔'), msg);
}

export function warn(msg: string): void {
  console.log(chalk.yellow('⚠'), msg);
}

export function error(msg: string): void {
  console.error(chalk.red('✖'), msg);
}

export function dim(msg: string): void {
  console.log(chalk.dim(msg));
}

export function verbose(msg: string): void {
  if (!isVerboseEnabled()) return;
  console.log(chalk.gray('›'), chalk.gray(msg));
}

export function debug(msg: string): void {
  if (!isDebugEnabled()) return;
  console.log(chalk.magenta('•'), chalk.magenta(msg));
}

export function banner(): void {
  console.log(chalk.bold.cyan('\n  boiler') + chalk.dim(' — Butler-like uploads to Steam\n'));
}

export function spinner(text: string): Ora {
  return ora({ text, color: 'cyan' });
}

export function keyValue(key: string, value: string | number | null | undefined): void {
  console.log(`  ${chalk.dim(key + ':')} ${value ?? chalk.dim('not set')}`);
}
