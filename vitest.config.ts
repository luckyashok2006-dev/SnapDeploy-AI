import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'server/**/*.test.ts'],
    exclude: ['tests/**/*.spec.ts', 'node_modules', 'dist']
  }
});
