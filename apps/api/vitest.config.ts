import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // Integration tests share one PostgreSQL database, so files run one at a time.
    fileParallelism: false,
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
  // SWC preserves decorator metadata, which NestJS dependency injection needs.
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
