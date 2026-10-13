import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'jsdom',
    restoreMocks: true,
    pool: 'threads',
    maxWorkers: 1,
  },
});
