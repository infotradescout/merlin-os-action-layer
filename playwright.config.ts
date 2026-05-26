import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/browser',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:43173',
    headless: true
  },
  webServer: {
    command: 'npx tsx src/server.ts',
    url: 'http://127.0.0.1:43173/api/health',
    reuseExistingServer: false,
    env: {
      ...process.env,
      PORT: '43173',
      MERLIN_DB_PATH: 'merlin-playwright.sqlite'
    }
  }
});
