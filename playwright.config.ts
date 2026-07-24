import { defineConfig, devices } from '@playwright/test';

const envSource = globalThis as typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
};
const runtimeEnv = envSource.process?.env ?? {};
const rawBaseURL = (runtimeEnv.PLAYWRIGHT_BASE_URL ?? runtimeEnv.VITE_APP_BASE_URL ?? 'https://nginx/zero/').trim();
const normalizedBaseURL = rawBaseURL.endsWith('/') ? rawBaseURL : `${rawBaseURL}/`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  use: {
    baseURL: normalizedBaseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
