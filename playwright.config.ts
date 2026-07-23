import { defineConfig } from '@playwright/test'

const browserTestUrl = 'http://127.0.0.1:3108'

export default defineConfig({
  testDir: './test/browser',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: 'line',
  outputDir: 'test-results/browser',
  use: {
    baseURL: browserTestUrl,
    browserName: 'chromium',
    channel: 'chrome',
    screenshot: 'off',
    trace: 'off',
    video: 'off',
  },
  webServer: {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3108',
    url: browserTestUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
