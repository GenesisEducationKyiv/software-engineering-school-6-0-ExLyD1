import { test, expect } from '@playwright/test';

const TEST_REPO = 'vitest-dev/vitest';
const TEST_EMAIL = `e2e-${Date.now()}@example.com`;

test.describe('Subscribe form', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('valid email + real repo submits and shows success message', async ({ page }) => {
        await page.fill('#sub-email', TEST_EMAIL);
        await page.fill('#sub-repo', TEST_REPO);
        await page.click('#sub-btn');

        const msg = page.locator('#sub-message');
        await expect(msg).toBeVisible({ timeout: 15000 });
        await expect(msg).toHaveClass(/success/);
    });

    test('subscribing same email + repo twice shows already subscribed message', async ({
        page,
    }) => {
        const dupEmail = `dup-${Date.now()}@example.com`;

        // First subscription
        await page.fill('#sub-email', dupEmail);
        await page.fill('#sub-repo', TEST_REPO);
        await page.click('#sub-btn');
        await expect(page.locator('#sub-message')).toHaveClass(/success/, { timeout: 15000 });

        // Reset form and submit again
        await page.fill('#sub-email', dupEmail);
        await page.fill('#sub-repo', TEST_REPO);
        await page.click('#sub-btn');

        const msg = page.locator('#sub-message');
        await expect(msg).toHaveClass(/error/, { timeout: 10000 });
        await expect(msg).toContainText(/already/i);
    });

    test('non-existent repo shows repository not found message', async ({ page }) => {
        await page.fill('#sub-email', `notfound-${Date.now()}@example.com`);
        await page.fill('#sub-repo', 'org/this-repo-does-not-exist-xyz-12345');
        await page.click('#sub-btn');

        const msg = page.locator('#sub-message');
        await expect(msg).toHaveClass(/error/, { timeout: 15000 });
        await expect(msg).toContainText(/not found/i);
    });
});
