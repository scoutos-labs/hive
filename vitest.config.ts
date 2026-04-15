import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    target: 'node20',
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
