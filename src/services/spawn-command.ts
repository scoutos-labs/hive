const DEFAULT_SPAWN_ARGS = ['--context', 'mention'];
const OPENCODE_RUN_COMMAND = 'opencode run';
const OPENCODE_DEFAULT_MODEL = 'opencode/big-pickle';

function hasExplicitModelArg(args: string[]): boolean {
  return args.some((arg) => (
    arg === '-M' ||
    arg === '--model' ||
    arg.startsWith('-M=') ||
    arg.startsWith('--model=')
  ));
}

export function getExecutableName(command: string): string {
  return command.trim().split(/\s+/)[0] ?? '';
}

export function resolveSpawnInvocation(spawnCommand?: string, spawnArgs?: string[]): { command: string; args: string[] } {
  const rawCommand = (spawnCommand || 'openclaw').trim();
  let args = spawnArgs ? [...spawnArgs] : [...DEFAULT_SPAWN_ARGS];

  if (!rawCommand) {
    return { command: '', args };
  }

  if (rawCommand.replace(/\s+/g, ' ').toLowerCase() === OPENCODE_RUN_COMMAND) {
    if (args[0]?.toLowerCase() !== 'run') {
      args = ['run', ...args];
    }

    if (!hasExplicitModelArg(args)) {
      args.splice(1, 0, '-M', OPENCODE_DEFAULT_MODEL);
    }

    return {
      command: 'opencode',
      args,
    };
  }

  return {
    command: rawCommand,
    args,
  };
}
