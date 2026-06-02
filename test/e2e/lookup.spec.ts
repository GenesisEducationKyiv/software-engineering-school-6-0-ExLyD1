import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';

async function apiSubscribe(email: string, repo: string): Promise<Response> {
    return fetch(`${BASE_URL}/api/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, repo }),
    });
}

test.describe('Subscriptions lookup', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('unknown email shows No subscriptions found', async ({ page }) => {
        const email = `unknown-${Date.now()}@example.com`;
        await page.fill('#lookup-email', email);
        await page.click('#lookup-btn');

        const results = page.locator('#lookup-results');
        await expect(results).toContainText(/No subscriptions found/i, { timeout: 10000 });
    });

    test('pending subscription shows Pending confirmation badge', async ({ page }) => {
        const email = `pending-${Date.now()}@example.com`;
        await apiSubscribe(email, 'vitest-dev/vitest');

        await page.fill('#lookup-email', email);
        await page.click('#lookup-btn');

        const results = page.locator('#lookup-results');
        await expect(results).toContainText(/Pending confirmation/i, { timeout: 10000 });
    });
});
