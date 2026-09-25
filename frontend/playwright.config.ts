import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.browser.test.ts",
  fullyParallel: false,
  use: {
    browserName: "chromium",
    headless: true,
  },
});
