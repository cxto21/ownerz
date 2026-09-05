import { test, expect } from '@playwright/test';

test.describe('Smoke Tests', () => {
  test('homepage loads successfully', async ({ page }) => {
    // Navigate to the homepage
    await page.goto('/');

    // Wait for the page to load
    await page.waitForLoadState('networkidle');

    // Verify the page title contains "DataVaultz" or "Ownerz"
    const title = await page.title();
    expect(title).toMatch(/(DataVaultz|Ownerz)/i);

    // Verify the page has loaded some content
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
    expect(body!.length).toBeGreaterThan(0);
  });

  test('page has basic UI elements', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check that the page has some visible content
    const body = await page.textContent('body');
    expect(body).toContain('DataVaultz');
  });

  test('page loads without console errors', async ({ page }) => {
    const errors: string[] = [];

    // Listen for console errors
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    // Listen for page errors
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Filter out known non-critical errors (like wallet extension errors)
    const criticalErrors = errors.filter(
      (error) =>
        !error.includes('wallet') &&
        !error.includes('starknet') &&
        !error.includes('extension') &&
        !error.includes('MetaMask')
    );

    // Should have no critical console errors
    expect(criticalErrors).toHaveLength(0);
  });
});
