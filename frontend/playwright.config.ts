import { defineConfig, devices } from '@playwright/test';

// By default, tests target the docker compose stack (nginx on port 80).
// Other target: BASE_URL=http://localhost:5173 npm run test:e2e
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
