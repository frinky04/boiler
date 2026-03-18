import { describe, it, expect } from 'vitest';
import { createDefaultFileMapping, promptForDepotConfig, promptForFileMapping } from '../src/commands/init.js';

function createPromptMock(responses: Array<Record<string, unknown>>) {
  let index = 0;

  return async () => {
    const response = responses[index];
    index += 1;
    if (!response) {
      throw new Error(`No mock prompt response for call ${index}`);
    }
    return response;
  };
}

describe('createDefaultFileMapping', () => {
  it('returns the default Steam file mapping', () => {
    expect(createDefaultFileMapping()).toEqual({
      localPath: '*',
      depotPath: '.',
      recursive: true,
    });
  });
});

describe('promptForFileMapping', () => {
  it('normalizes prompted mapping values', async () => {
    const mapping = await promptForFileMapping(createPromptMock([
      {
        localPath: ' extras/*.dll ',
        depotPath: ' ./bin ',
        recursive: false,
      },
    ]));

    expect(mapping).toEqual({
      localPath: 'extras/*.dll',
      depotPath: './bin',
      recursive: false,
    });
  });
});

describe('promptForDepotConfig', () => {
  it('uses the default file mapping when requested', async () => {
    const depot = await promptForDepotConfig(createPromptMock([
      {
        depotId: '481',
        contentRoot: './build',
        exclusions: ['*.pdb'],
      },
      {
        useDefaultMapping: true,
      },
      {
        anotherMapping: false,
      },
    ]));

    expect(depot).toEqual({
      depotId: 481,
      contentRoot: './build',
      fileMappings: [
        { localPath: '*', depotPath: '.', recursive: true },
      ],
      fileExclusions: ['*.pdb'],
    });
  });

  it('collects multiple custom file mappings for a depot', async () => {
    const depot = await promptForDepotConfig(createPromptMock([
      {
        depotId: '482',
        contentRoot: './build',
        exclusions: ['*.pdb', '*.map'],
      },
      {
        useDefaultMapping: false,
      },
      {
        localPath: '*.exe',
        depotPath: '.',
        recursive: false,
      },
      {
        anotherMapping: true,
      },
      {
        localPath: 'extras/*.dll',
        depotPath: './bin',
        recursive: false,
      },
      {
        anotherMapping: false,
      },
    ]));

    expect(depot).toEqual({
      depotId: 482,
      contentRoot: './build',
      fileMappings: [
        { localPath: '*.exe', depotPath: '.', recursive: false },
        { localPath: 'extras/*.dll', depotPath: './bin', recursive: false },
      ],
      fileExclusions: ['*.pdb', '*.map'],
    });
  });
});
