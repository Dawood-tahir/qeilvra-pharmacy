import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: { baseURL: "http://127.0.0.1:3000", trace: "on-first-retry" },
  webServer: { command: "npm run dev", url: "http://127.0.0.1:3000/login", reuseExistingServer: !process.env.CI, timeout: 120_000 },
  projects: [
    { name: "desktop-1440", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "mobile-320", use: { ...devices["iPhone SE"], browserName: "chromium", viewport: { width: 320, height: 700 } } },
    { name: "mobile-360", use: { viewport: { width: 360, height: 800 }, hasTouch: true } },
    { name: "mobile-390", use: { ...devices["iPhone 13"], browserName: "chromium", viewport: { width: 390, height: 844 } } },
    { name: "mobile-430", use: { viewport: { width: 430, height: 932 }, hasTouch: true } },
    { name: "tablet-768", use: { viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: "desktop-1024", use: { viewport: { width: 1024, height: 800 } } },
  ],
});
