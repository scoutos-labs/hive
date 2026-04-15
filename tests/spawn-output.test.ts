import { describe, expect, it } from 'vitest';

import { formatSpawnOutputForPost } from '../src/services/spawn.js';

describe('formatSpawnOutputForPost', () => {
  it('extracts final text from OpenCode JSON events', () => {
    const stdout = [
      JSON.stringify({ type: 'step_start', timestamp: 1 }),
      JSON.stringify({
        type: 'text',
        timestamp: 2,
        part: {
          type: 'text',
          text: 'OpenCode works through Hive.',
        },
      }),
      JSON.stringify({ type: 'step_finish', timestamp: 3 }),
    ].join('\n');

    expect(formatSpawnOutputForPost(stdout)).toBe('OpenCode works through Hive.');
  });

  it('falls back to raw text for non-JSON output', () => {
    expect(formatSpawnOutputForPost('plain text output')).toBe('plain text output');
  });
});
