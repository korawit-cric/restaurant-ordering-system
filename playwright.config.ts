import { defineConfig } from '@playwright/test';
if (
  !process.env.TEST_DATABASE_URL ||
  !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test')
)
  throw new Error(
    'Set TEST_DATABASE_URL to a disposable database ending in _test',
  );
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 60000,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3010',
    viewport: { width: 1440, height: 1000 },
    video: 'on',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node apps/api/dist/main.js',
      url: 'http://127.0.0.1:3011/auth/me',
      env: {
        DATABASE_URL: process.env.TEST_DATABASE_URL,
        API_PORT: '3011',
        APP_ORIGIN: 'http://localhost:3010',
        NODE_ENV: 'test',
      },
      timeout: 30000,
    },
    {
      command: 'npm run start -w web',
      url: 'http://localhost:3010',
      timeout: 30000,
    },
  ],
});
