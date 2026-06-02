import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './test/e2e',
    timeout: 30000,
    retries: process.env.CI ? 2 : 0,
    reporter: process.env.CI ? [['list'], ['html', { outputFolder: 'playwright-report' }]] : 'list',
    use: {
        baseURL: 'http://localhost:3000',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
        trace: 'retain-on-failure',
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: {
        command: 'node dist/app.js',
        url: 'http://localhost:3000/health',
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
            DATABASE_URL:
                process.env.DATABASE_URL ??
                'postgres://test:test@localhost:5433/github_notifier_test',
            API_KEY: process.env.API_KEY ?? 'test-api-key',
            BASE_URL: process.env.BASE_URL ?? 'http://localhost:3000',
            GITHUB_BASE_URL: process.env.GITHUB_BASE_URL ?? 'https://api.github.com',
            RESEND_API_KEY: process.env.RESEND_API_KEY ?? 'test-resend-key',
            SMTP_FROM: process.env.SMTP_FROM ?? 'test@example.com',
            MAILER_MODE: process.env.MAILER_MODE ?? 'stub',
            SCANNER_INTERVAL_MS: process.env.SCANNER_INTERVAL_MS ?? '9999999',
        },
    },
});
