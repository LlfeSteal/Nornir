import { defineConfig } from 'vitest/config';

// Unit tests of the pure logic (src/**/*.test.ts); e2e/*.spec.ts belong to Playwright.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
