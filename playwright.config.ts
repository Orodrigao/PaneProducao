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
    // O token do GitHub que o CI entrega ao smoke de fotos so serve a consulta
    // do preview da PR, feita pelo teste; o servidor do site nao herda.
    env: { PREVIEW_DA_PR_GITHUB_TOKEN: '' },
  },
})
