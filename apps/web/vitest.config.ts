import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '#': new URL('./src', import.meta.url).pathname,
      '@family-tree/ui': new URL('../../packages/ui/src/index.ts', import.meta.url).pathname,
      '@family-tree/shared': new URL('../../packages/shared/src/index.ts', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.{ts,tsx}'],
    env: { TZ: 'UTC' },
  },
});
