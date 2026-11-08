import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 3100);
const LIVE_PORT = Number(process.env.LIVE_PORT ?? 3101);
const baseURL = `http://127.0.0.1:${PORT}`;
const liveBaseURL = `http://127.0.0.1:${LIVE_PORT}`;

/** The live-mode suite needs a deployment that reports `live`, so it gets its own server. */
const LIVE_GATE = /live-gate\.spec\.ts/;

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      testIgnore: LIVE_GATE,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    { name: 'mobile', testIgnore: LIVE_GATE, use: { ...devices['Pixel 7'] } },
    {
      name: 'live-gate',
      testMatch: LIVE_GATE,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        baseURL: liveBaseURL,
      },
    },
  ],
  webServer: [
    {
      command: 'npm run start',
      url: baseURL,
      timeout: 120_000,
      reuseExistingServer: true,
      env: {
        // The demo limit is 20 screens per 5 minutes; the suite needs headroom.
        RATE_LIMIT_REQUESTS: '400',
        CLOCKED_MODE: 'mock',
      },
    },
    {
      // Same build, different run mode. The key is a placeholder: every
      // screening in the live suite is answered by a request stub, so no
      // request ever leaves this machine.
      command: `npx next start -p ${LIVE_PORT}`,
      url: liveBaseURL,
      timeout: 120_000,
      reuseExistingServer: true,
      env: {
        RATE_LIMIT_REQUESTS: '400',
        CLOCKED_MODE: 'live',
        CLOCKED_API_KEY: 'playwright-placeholder-not-a-real-key',
      },
    },
  ],
});
