// Not part of `tsc -b`: vitest 5.1.0's `vitest/config` typings re-export themselves and expose nothing.
// Add this file back to tsconfig.node.json once a fixed vitest release is installed.
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  }),
);
