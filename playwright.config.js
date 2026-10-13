const { defineConfig } = require("@playwright/test");
module.exports = defineConfig({
    testDir: "./e2e",
    workers: 1,
    fullyParallel: false,
    timeout: 30000,
    outputDir: ".data/browser-tests",
    reporter: "list",
    use: {
        baseURL: "http://127.0.0.1:3211",
        browserName: "chromium",
        channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
        headless: true,
    },
    webServer: {
        command: "node e2e/server.js",
        url: "http://127.0.0.1:3211/health",
        reuseExistingServer: false,
    },
});
