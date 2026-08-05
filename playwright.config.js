// @ts-check
/* End-to-end layer. Deliberately narrow: it covers ONLY what the `node:test` suite structurally
   cannot reach — real trusted input (the 4px click-vs-drag threshold), and a live mount of the real
   `index.html`. Everything provable against the mock DOM in `tests/_load.js` stays there.

   `reuseExistingServer:false` is load-bearing: reusing whatever happens to be on the port is exactly
   the stale-server failure this layer exists to remove. */
const { defineConfig, devices } = require('@playwright/test');

const PORT = 8901;

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node tools/static-server.mjs`,
    env: { PORT: String(PORT) },
    url: `http://localhost:${PORT}/index.html`,
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
