import { test, expect } from '@playwright/test';

// A tablet's on-screen keyboard fires `resize` while you type: the suggestion
// strip grows and shrinks by a few dozen pixels per keystroke. Layout used to
// re-lock the app's root height on every one of those, which relayouts the
// whole chat history and re-renders every panel Layout hosts -- the stutter
// only reproducible on a tablet. These tests pin the resulting contract:
// keyboard-sized noise is ignored while typing, real viewport changes are not.
test.use({ ignoreHTTPSErrors: true, viewport: { width: 1024, height: 1366 }, hasTouch: true });

const KEYBOARD_NOISE_PX = 40;   // suggestion strip: must be ignored
const KEYBOARD_OPEN_PX = 400;   // keyboard itself: must be honoured

async function openChat(page: import('@playwright/test').Page) {
  await page.goto('');
  await page.locator('select').selectOption('ettore');
  await page.getByRole('button', { name: /open session/i }).click();
  await expect(page.getByText('Agents').first()).toBeVisible({ timeout: 60_000 });
  const ta = page.locator('textarea').first();
  await expect(ta).toBeVisible({ timeout: 30_000 });
  return ta;
}

const rootHeight = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (document.querySelector('body > div') as HTMLElement)?.style.height ?? '');

test('keyboard-sized resize noise while typing does not re-lock the root height', async ({ page }) => {
  test.setTimeout(120_000);
  const ta = await openChat(page);
  await ta.click();
  await page.waitForTimeout(300);
  const before = await rootHeight(page);
  expect(before).toBe('1366px');

  await page.setViewportSize({ width: 1024, height: 1366 - KEYBOARD_NOISE_PX });
  await page.waitForTimeout(300);
  expect(await rootHeight(page)).toBe(before);
});

test('opening the keyboard still re-locks the root height', async ({ page }) => {
  test.setTimeout(120_000);
  const ta = await openChat(page);
  await ta.click();
  await page.waitForTimeout(300);
  expect(await rootHeight(page)).toBe('1366px');

  await page.setViewportSize({ width: 1024, height: 1366 - KEYBOARD_OPEN_PX });
  await page.waitForTimeout(400);
  expect(await rootHeight(page)).toBe(`${1366 - KEYBOARD_OPEN_PX}px`);
});

test('losing focus catches up on a height that was skipped while typing', async ({ page }) => {
  test.setTimeout(120_000);
  const ta = await openChat(page);
  await ta.click();
  await page.waitForTimeout(300);

  await page.setViewportSize({ width: 1024, height: 1366 - KEYBOARD_NOISE_PX });
  await page.waitForTimeout(300);
  expect(await rootHeight(page)).toBe('1366px'); // skipped, as above

  await ta.evaluate((el: HTMLElement) => el.blur());
  await page.waitForTimeout(400);
  expect(await rootHeight(page)).toBe(`${1366 - KEYBOARD_NOISE_PX}px`);
});

test('resize with nothing focused re-locks immediately', async ({ page }) => {
  test.setTimeout(120_000);
  await openChat(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.setViewportSize({ width: 1024, height: 1200 });
  await page.waitForTimeout(400);
  expect(await rootHeight(page)).toBe('1200px');
});
