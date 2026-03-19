import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { helpCommand } from '../src/commands/help.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('helpCommand', () => {
  it('prints top-level help when no command name is provided', () => {
    const program = new Command();
    const outputHelp = vi.spyOn(program, 'outputHelp').mockImplementation(() => program);

    helpCommand(program);

    expect(outputHelp).toHaveBeenCalledTimes(1);
  });

  it('prints help for a specific command', () => {
    const program = new Command();
    const push = program.command('push').description('Upload a build');

    const programOutputHelp = vi.spyOn(program, 'outputHelp').mockImplementation(() => program);
    const pushOutputHelp = vi.spyOn(push, 'outputHelp').mockImplementation(() => push);

    helpCommand(program, 'push');

    expect(pushOutputHelp).toHaveBeenCalledTimes(1);
    expect(programOutputHelp).not.toHaveBeenCalled();
  });

  it('resolves aliases when showing command help', () => {
    const program = new Command();
    const status = program.command('status').alias('st');
    const outputHelp = vi.spyOn(status, 'outputHelp').mockImplementation(() => status);

    helpCommand(program, 'st');

    expect(outputHelp).toHaveBeenCalledTimes(1);
  });

  it('throws when asked for an unknown command', () => {
    const program = new Command();
    program.command('push');

    expect(() => helpCommand(program, 'missing')).toThrow(/Unknown command "missing"/);
  });
});
