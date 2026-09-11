import { test, expect } from '@playwright/test';

// Regression: canvas fullscreen is persisted in localStorage, and the canvas also
// opens on its own -- an arriving approval does it (ChatInterface.tsx), as does
// opening a note from the rail. A fullscreen flag left over from an earlier session
// therefore used to turn active the moment something opened the canvas, collapsing
// the chat column to width 0. Measured here before the fix: 1807px -> 0px, which is
// the "chat disappeared right after I sent a message" report.
test.use({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
test.setTimeout(120_000);

test('the chat survives the canvas opening with a stale fullscreen flag', async ({ page }) => {
  await page.goto('');
  await page.evaluate(() => window.localStorage.setItem('zero_canvas_fullscreen', '1'));
  await page.reload();

  const userSelect = page.locator('select').first();
  await userSelect.waitFor({ state: 'visible', timeout: 30_000 });
  // By value: the option label is `Display Name (username)`.
  await userSelect.selectOption('ettore');
  await page.getByRole('button', { name: /open session/i }).click();

  const textarea = page.locator('textarea').first();
  await expect(textarea).toBeVisible({ timeout: 30_000 });

  const chatColumn = page.locator('div[class*="transition-\\[width\\,height\\]"]').first();
  await expect.poll(() => chatColumn.evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(100);

  // Open the canvas the way an approval or a rail note does.
  await page.getByRole('button', { name: /^notes$/i }).first().click();
  await page.waitForTimeout(1500);

  const width = await chatColumn.evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBeGreaterThan(100);
});
