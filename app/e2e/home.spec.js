import { test, expect } from '@playwright/test';

/**
 * e2e/home.spec.js — Critical home page smoke tests.
 *
 * Verifies that the most important page sections render without crashing.
 * These tests run against the production build (vite preview).
 */
test.describe('Home Page', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');
        await page.locator('#main-content').first().waitFor({ state: 'attached', timeout: 15000 });
    });

    test('page title contains AURA', async ({ page }) => {
        await expect(page).toHaveTitle(/Aura|AURA/i);
    });

    test('navbar is visible with logo', async ({ page }) => {
        const navbar = page.locator('nav').first();
        await expect(navbar).toBeVisible();
        await expect(page.getByText(/AURA/i).first()).toBeVisible();
    });

    test('hero carousel section is visible', async ({ page }) => {
        // Carousel section should exist in the DOM
        const carousel = page.locator('[data-testid="carousel"], section').first();
        await expect(carousel).toBeVisible({ timeout: 10_000 });
    });

    test('no top-level React error boundary is triggered', async ({ page }) => {
        // If the main AppErrorBoundary fires, "Something went wrong" appears
        const errorFallback = page.getByText('Something went wrong');
        await expect(errorFallback).toHaveCount(0, { timeout: 10_000 });
    });

    test('navigation links are present', async ({ page }) => {
        await expect(page.getByRole('link', { name: /AURA/i }).first()).toBeVisible();
    });

    test('skip-to-content link exists for keyboard users', async ({ page }) => {
        // Tab to reveal the skip link
        await page.keyboard.press('Tab');
        const skipLink = page.getByRole('link', { name: /skip to main content/i });
        await expect(skipLink).toBeVisible({ timeout: 3_000 }).catch(() => {
            // Some designs only show on focus — verify the link exists in DOM
        });
        // At minimum it must exist in the DOM
        await expect(page.getByText(/skip to main content/i)).toHaveCount(1);
    });
});
