import type { Command } from 'commander';

function matchesRequestedCommand(command: Command, requested: string): boolean {
  return command.name() === requested || command.aliases().includes(requested);
}

export function helpCommand(program: Command, commandName?: string): void {
  if (!commandName) {
    program.outputHelp();
    return;
  }

  const targetCommand = program.commands.find((command) => matchesRequestedCommand(command, commandName));
  if (!targetCommand) {
    throw new Error(`Unknown command "${commandName}". Run \`boiler help\` to list available commands.`);
  }

  targetCommand.outputHelp();
}
