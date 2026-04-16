import { describe, expect, it } from 'vitest';

import { getExecutableName, resolveSpawnInvocation } from '../src/services/spawn-command.js';

describe('resolveSpawnInvocation', () => {
  it('normalizes opencode run and injects the default model', () => {
    expect(resolveSpawnInvocation('opencode run', ['--json'])).toEqual({
      command: 'opencode',
      args: ['run', '-M', 'opencode/big-pickle', '--json'],
    });
  });

  it('does not override an explicitly selected OpenCode model', () => {
    expect(resolveSpawnInvocation('opencode run', ['--model', 'custom/model', '--json'])).toEqual({
      command: 'opencode',
      args: ['run', '--model', 'custom/model', '--json'],
    });
  });

  it('extracts the executable from composite commands for allowlist checks', () => {
    expect(getExecutableName('opencode run')).toBe('opencode');
  });
});
