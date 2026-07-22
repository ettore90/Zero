import { test, expect } from '@playwright/test';

test('app opens and renders root without fatal screen', async ({ page }) => {
  await page.goto('/zero/');
  await expect(page.locator('#root')).toBeVisible();
  await expect(page.getByText('Application failed to start')).not.toBeVisible();
  await expect(page.getByText('Application failed to render')).not.toBeVisible();
});
