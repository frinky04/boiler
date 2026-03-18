import chalk from 'chalk';
import ora, { type Ora } from 'ora';

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

export function banner(): void {
  console.log(chalk.bold.cyan('\n  boiler') + chalk.dim(' — Butler-like uploads to Steam\n'));
}

export function spinner(text: string): Ora {
  return ora({ text, color: 'cyan' });
}

export function keyValue(key: string, value: string | number | null | undefined): void {
  console.log(`  ${chalk.dim(key + ':')} ${value ?? chalk.dim('not set')}`);
}
