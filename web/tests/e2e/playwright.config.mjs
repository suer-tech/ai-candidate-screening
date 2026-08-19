import { defineConfig, devices } from "@playwright/test";
import { readE2eConfig } from "./config.mjs";

const config = readE2eConfig();

export default defineConfig({
  testDir: ".",
  testMatch: "required.spec.mjs",
  globalSetup: "./global-setup.mjs",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30 * 60 * 1_000,
  expect: { timeout: 30_000 },
  outputDir: "../../test-results/e2e-artifacts",
  reporter: [
    ["list"],
    ["json", { outputFile: "../../test-results/e2e-results.json" }],
    ["html", { outputFolder: "../../playwright-report", open: "never" }],
  ],
  use: {
    baseURL: config.baseUrl,
    storageState: config.storageState,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium-desktop", use: { ...devices["Desktop Chrome"], browserName: "chromium" } }],
});
