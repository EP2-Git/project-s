import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/selected-homepage',
  fullyParallel: false,
  failOnFlakyTests: Boolean(process.env.CI),
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  outputDir: 'test-results/selected-homepage-artifacts',
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4184',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/start-vite-audience.mjs hosted 4184',
    url: 'http://127.0.0.1:4184',
    env: {
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'synthetic-selected-homepage-review-key',
      VITE_PROJECT_S_API_URL: 'http://127.0.0.1:4184',
    },
    // Never accept a server from another Project S worktree or audience.
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
