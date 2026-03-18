#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { loginCommand } from './commands/login.js';
import { pushCommand } from './commands/push.js';
import { statusCommand } from './commands/status.js';
import { interactiveWizard } from './wizard/interactive.js';
import * as logger from './util/logger.js';

const program = new Command();

program
  .name('easy-steam')
  .description('Butler-like CLI for uploading builds to Steam via SteamCMD')
  .version('0.1.0');

program
  .command('login')
  .description('Authenticate with Steam (handles Steam Guard)')
  .action(loginCommand);

program
  .command('init')
  .description('Set up project config (.easy-steam.json)')
  .action(initCommand);

program
  .command('push [folder]')
  .description('Upload a build to Steam')
  .option('--app <id>', 'Steam App ID (overrides config)', parseInt)
  .option('--depot <id>', 'Steam Depot ID (overrides config)', parseInt)
  .option('--desc <text>', 'Build description')
  .option('--set-live <branch>', 'Set build live on branch after upload')
  .option('--dry-run', 'Preview generated VDF without uploading')
  .action(pushCommand);

program
  .command('status')
  .description('Show current config and last upload info')
  .action(statusCommand);

// No subcommand → interactive wizard
if (process.argv.length <= 2) {
  interactiveWizard().catch((err) => {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
} else {
  program.parseAsync().catch((err) => {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
