import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    headless: true,
  },
  webServer: {
    command: 'ALLOW_LOCAL_SCANS=true ENABLE_DEMO_FIXTURE=true npm run dev',
    url: 'http://127.0.0.1:3000/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
