import { test, expect, type Locator, type Page } from '@playwright/test';

const mobileViewports = [
  { name: '320px', width: 320, height: 640 },
  { name: '375px', width: 375, height: 667 },
  { name: '414px', width: 414, height: 896 },
];

test.use({ ignoreHTTPSErrors: true });
test.setTimeout(90_000);

async function isVisible(locator: Locator): Promise<boolean> {
  return locator.isVisible().catch(() => false);
}

async function openShell(page: Page): Promise<void> {
  await page.goto('');
  const authTitle = page.getByText('Select user', { exact: true });
  if (await isVisible(authTitle)) {
    const form = page.locator('form').filter({ has: authTitle });
    await form.locator('select').selectOption('ettore');
    await form.getByRole('button', { name: 'Open Session' }).click();
    await expect(authTitle).not.toBeVisible({ timeout: 30_000 });
  }
  await expect.poll(() => isVisible(page.getByRole('button', { name: 'Open agents' })), { timeout: 30_000 }).toBe(true);
}

for (const viewport of mobileViewports) {
  test.describe(`mobile ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('keeps the shell within the viewport and exposes compact navigation', async ({ page }) => {
      await openShell(page);
      await expect(page.locator('body')).toHaveJSProperty('scrollWidth', viewport.width);
      const navigation = page.getByRole('button', { name: 'Open navigation' });
      await navigation.click();
      await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Scheduler' })).toBeVisible();
      await page.getByRole('button', { name: 'Close navigation' }).click();
    });

    test('opens the Scheduler as an accessible full-screen mobile dialog', async ({ page }) => {
      await openShell(page);
      await page.getByRole('button', { name: 'Open navigation' }).click();
      await page.getByRole('button', { name: 'Scheduler' }).click();
      const dialog = page.getByRole('dialog', { name: 'Message Scheduler' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel('Target Agent')).toBeVisible();
      await expect(dialog.getByLabel('Execution Time')).toBeVisible();
      await expect(dialog.getByLabel('Message')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    });
  });
}
