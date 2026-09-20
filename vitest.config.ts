import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules/**'],
    testTimeout: 20_000,
    /* Suites that set up a store create an organization plus its roles,
     * permissions, warehouses and products in sequential queries. Against the
     * remote (Neon) database that is ~125ms per round trip, so a setup block
     * can legitimately outrun the 10s default and fail the whole file before
     * a single test runs. */
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
