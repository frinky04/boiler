import inquirer from 'inquirer';
import { projectConfigExists, saveProjectConfig } from '../core/config.js';
import { validateAppId, validateDepotId } from '../util/validation.js';
import * as logger from '../util/logger.js';
import type { DepotConfig, DepotFileMapping, ProjectConfig } from '../types/index.js';

const DEFAULT_EXCLUSIONS = ['*.pdb', '*.map', '.DS_Store', 'Thumbs.db', '*.debug'];
type PromptFn = typeof inquirer.prompt;

export function createDefaultFileMapping(): DepotFileMapping {
  return {
    localPath: '*',
    depotPath: '.',
    recursive: true,
  };
}

export async function promptForFileMapping(
  prompt: PromptFn = inquirer.prompt,
  defaults: DepotFileMapping = createDefaultFileMapping()
): Promise<DepotFileMapping> {
  const answers = await prompt([
    {
      type: 'input',
      name: 'localPath',
      message: 'File mapping local path:',
      default: defaults.localPath,
      validate: (v: string) => v.trim().length > 0 || 'Local path is required',
    },
    {
      type: 'input',
      name: 'depotPath',
      message: 'File mapping depot path:',
      default: defaults.depotPath,
      validate: (v: string) => v.trim().length > 0 || 'Depot path is required',
    },
    {
      type: 'confirm',
      name: 'recursive',
      message: 'Recursive?',
      default: defaults.recursive,
    },
  ]);

  return {
    localPath: String(answers.localPath).trim(),
    depotPath: String(answers.depotPath).trim(),
    recursive: Boolean(answers.recursive),
  };
}

export async function promptForDepotConfig(prompt: PromptFn = inquirer.prompt): Promise<DepotConfig> {
  const depotAnswers = await prompt([
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

  const defaultMapping = createDefaultFileMapping();
  const { useDefaultMapping } = await prompt([
    {
      type: 'confirm',
      name: 'useDefaultMapping',
      message: 'Use the default file mapping (`*` -> `.` recursive)?',
      default: true,
    },
  ]);

  const fileMappings: DepotFileMapping[] = [];
  if (useDefaultMapping) {
    fileMappings.push(defaultMapping);
  } else {
    fileMappings.push(await promptForFileMapping(prompt, defaultMapping));
  }

  let addAnotherMapping = false;
  do {
    const answers = await prompt([
      {
        type: 'confirm',
        name: 'anotherMapping',
        message: 'Add another file mapping for this depot?',
        default: false,
      },
    ]);
    addAnotherMapping = Boolean(answers.anotherMapping);

    if (addAnotherMapping) {
      fileMappings.push(await promptForFileMapping(prompt, defaultMapping));
    }
  } while (addAnotherMapping);

  return {
    depotId: parseInt(String(depotAnswers.depotId), 10),
    contentRoot: String(depotAnswers.contentRoot),
    fileMappings,
    fileExclusions: depotAnswers.exclusions as string[],
  };
}

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
    depots.push(await promptForDepotConfig());

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
