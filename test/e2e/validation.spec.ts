import { test, expect } from '@playwright/test';

test.describe('Client-side validation', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('GET / returns 200 and page renders', async ({ page }) => {
        await expect(page).toHaveTitle('GitHub Notifier');
        await expect(page.locator('h1')).toBeVisible();
    });

    test('submitting empty subscribe form shows field errors for email and repo', async ({
        page,
    }) => {
        await page.click('#sub-btn');
        await expect(page.locator('#sub-email-error')).not.toBeEmpty();
        await expect(page.locator('#sub-repo-error')).not.toBeEmpty();
    });

    test('valid email + invalid repo shows only repo error', async ({ page }) => {
        await page.fill('#sub-email', 'valid@example.com');
        await page.fill('#sub-repo', '-invalid/repo');
        await page.click('#sub-btn');
        await expect(page.locator('#sub-email-error')).toBeEmpty();
        await expect(page.locator('#sub-repo-error')).not.toBeEmpty();
    });

    test('invalid email + valid repo shows only email error', async ({ page }) => {
        await page.fill('#sub-email', 'not-an-email');
        await page.fill('#sub-repo', 'org/repo');
        await page.click('#sub-btn');
        await expect(page.locator('#sub-email-error')).not.toBeEmpty();
        await expect(page.locator('#sub-repo-error')).toBeEmpty();
    });

    test('correcting the email input clears the email error', async ({ page }) => {
        await page.click('#sub-btn');
        await expect(page.locator('#sub-email-error')).not.toBeEmpty();

        await page.fill('#sub-email', 'fixed@example.com');
        await expect(page.locator('#sub-email-error')).toBeEmpty();
    });

    test('lookup form with invalid email shows validation error', async ({ page }) => {
        await page.fill('#lookup-email', 'not-an-email');
        await page.click('#lookup-btn');
        await expect(page.locator('#lookup-email-error')).not.toBeEmpty();
    });
});
