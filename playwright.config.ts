import { defineConfig } from "@playwright/test";

/**
 * Browser-level end-to-end tests for the solo game.
 *
 * Run with `npm run test:e2e`. The dev server (vite on :9000 + local game
 * server) is started automatically if it isn't already running.
 *
 * The game demands GPU-accelerated WebGL2 by default; the tests opt into the
 * software-rendering escape hatch (localStorage "allowSoftwareGL") so they
 * can run headless on machines without a GPU. See src/client/render/gl/initGL.ts.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 240_000,
  expect: { timeout: 30_000 },
  // The solo flow test is a single long scenario; keep one worker.
  workers: 1,
  use: {
    screenshot: "only-on-failure",
    baseURL: "http://localhost:9000",
    viewport: { width: 1440, height: 900 },
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? {
          launchOptions: {
            executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH,
          },
        }
      : {}),
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:9000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
