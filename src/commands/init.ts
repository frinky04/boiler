import inquirer from 'inquirer';
import { projectConfigExists, saveProjectConfig } from '../core/config.js';
import { validateAppId, validateDepotId } from '../util/validation.js';
import * as logger from '../util/logger.js';
import type { DepotConfig, ProjectConfig } from '../types/index.js';

const DEFAULT_EXCLUSIONS = ['*.pdb', '*.map', '.DS_Store', 'Thumbs.db', '*.debug'];

export async function initCommand(): Promise<void> {
  if (projectConfigExists()) {
    const { overwrite } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'overwrite',
        message: '.easy-steam.json already exists. Overwrite?',
        default: false,
      },
    ]);
    if (!overwrite) {
      logger.info('Init cancelled.');
      return;
    }
  }

  const { appId } = await inquirer.prompt([
    {
      type: 'input',
      name: 'appId',
      message: 'Steam App ID:',
      validate: (v: string) => {
        const result = validateAppId(v);
        return typeof result === 'string' ? result : true;
      },
    },
  ]);

  const depots: DepotConfig[] = [];
  let addMore = true;

  while (addMore) {
    const depotAnswers = await inquirer.prompt([
      {
        type: 'input',
        name: 'depotId',
        message: 'Depot ID:',
        validate: (v: string) => {
          const result = validateDepotId(v);
          return typeof result === 'string' ? result : true;
        },
      },
      {
        type: 'input',
        name: 'contentRoot',
        message: 'Content root (path to your build folder):',
        default: './build',
      },
      {
        type: 'checkbox',
        name: 'exclusions',
        message: 'File exclusions:',
        choices: DEFAULT_EXCLUSIONS.map((e) => ({ name: e, checked: true })),
      },
    ]);

    depots.push({
      depotId: parseInt(depotAnswers.depotId, 10),
      contentRoot: depotAnswers.contentRoot,
      fileMapping: {
        localPath: '*',
        depotPath: '.',
        recursive: true,
      },
      fileExclusions: depotAnswers.exclusions,
    });

    const { another } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'another',
        message: 'Add another depot?',
        default: false,
      },
    ]);
    addMore = another;
  }

  const config: ProjectConfig = {
    appId: parseInt(appId, 10),
    depots,
    buildOutput: '.easy-steam-output',
    setLive: null,
  };

  saveProjectConfig(config);
  logger.success('Created .easy-steam.json');
  logger.dim('  Run `easy-steam push` to upload your first build.');
}
