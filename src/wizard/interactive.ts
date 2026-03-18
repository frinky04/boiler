import inquirer from 'inquirer';
import * as logger from '../util/logger.js';
import { loginCommand } from '../commands/login.js';
import { initCommand } from '../commands/init.js';
import { pushCommand } from '../commands/push.js';
import { statusCommand } from '../commands/status.js';

type Action = 'login' | 'init' | 'push' | 'status' | 'exit';

export async function interactiveWizard(): Promise<void> {
  logger.banner();

  while (true) {
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          { name: 'Login to Steam', value: 'login' },
          { name: 'Init project config', value: 'init' },
          { name: 'Push a build', value: 'push' },
          { name: 'Check status', value: 'status' },
          new inquirer.Separator(),
          { name: 'Exit', value: 'exit' },
        ],
      },
    ]);

    if (action === 'exit') {
      break;
    }

    try {
      switch (action as Action) {
        case 'login':
          await loginCommand();
          break;
        case 'init':
          await initCommand();
          break;
        case 'push':
          await interactivePush();
          break;
        case 'status':
          await statusCommand();
          break;
      }
    } catch (err) {
      if (err instanceof Error) {
        logger.error(err.message);
      }
    }

    console.log('');
  }
}

async function interactivePush(): Promise<void> {
  const { folder, desc, dryRun } = await inquirer.prompt([
    {
      type: 'input',
      name: 'folder',
      message: 'Build folder (leave empty to use config):',
    },
    {
      type: 'input',
      name: 'desc',
      message: 'Build description (optional):',
    },
    {
      type: 'confirm',
      name: 'dryRun',
      message: 'Dry run (preview VDF without uploading)?',
      default: false,
    },
  ]);

  await pushCommand(
    folder || undefined,
    { desc: desc || undefined, dryRun }
  );
}
