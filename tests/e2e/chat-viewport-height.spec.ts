import { test, expect, type Page } from '@playwright/test';

// A tablet browser's toolbar collapses and expands the viewport by a few dozen
// pixels, including while the user is typing. Layout locks the app's root
// height to window.innerHeight; if it ever skips one of those changes the root
// stays taller than the window and the message input drops off the bottom of
// the screen -- reported as "the chat area is disappearing", on both Chrome and
// Safari on an iPad.
//
// An earlier version of this file pinned the opposite contract: it asserted
// that small changes while typing were IGNORED, as a way to avoid re-rendering
// the shell on keyboard-driven resizes. That optimisation targeted a stutter
// which later measurement attributed to Chrome-on-iOS input handling instead,
// and the skip is what broke the layout. The invariant below is the real one.
test.use({ ignoreHTTPSErrors: true, viewport: { width: 1180, height: 688 }, hasTouch: true });

const TOOLBAR_PX = 66; // measured on the affected device: 688 <-> 622

// Layout's outermost div carries the inline viewport lock. Identified by its
// class signature: a positional selector matches a sibling and reads back an
// empty style.
const rootHeight = (page: Page) =>
  page.evaluate(() => {
    const roots = Array.from(document.querySelectorAll<HTMLElement>('div[style*="height"]'))
      .filter((el) => el.style.height && el.className.includes('font-sans'));
    if (roots.length !== 1) throw new Error(`expected exactly 1 app root, found ${roots.length}`);
    return roots[0].style.height;
  });

const inputIsOnScreen = (page: Page) =>
  page.evaluate(() => {
    const ta = document.querySelector('textarea');
    if (!ta) throw new Error('no chat input');
    const b = ta.getBoundingClientRect();
    return b.bottom <= window.innerHeight && b.top >= 0 && b.height > 0;
  });

async function openChat(page: Page) {
  await page.goto('');
  // By value: the option label is `Display Name (username)`.
  await page.locator('select').selectOption('ettore');
  await page.getByRole('button', { name: /open session/i }).click();
  await expect(page.getByText('Agents').first()).toBeVisible({ timeout: 60_000 });
  const ta = page.locator('textarea').first();
  await expect(ta).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(500);
  return ta;
}

test('a toolbar-sized shrink while typing keeps the input on screen', async ({ page }) => {
  test.setTimeout(120_000);
  const ta = await openChat(page);
  await ta.click();
  await page.keyboard.type('digitando');
  expect(await rootHeight(page)).toBe('688px');

  await page.setViewportSize({ width: 1180, height: 688 - TOOLBAR_PX });
  await page.waitForTimeout(500);

  expect(await rootHeight(page)).toBe(`${688 - TOOLBAR_PX}px`);
  expect(await inputIsOnScreen(page)).toBe(true);
});

test('the same shrink with nothing focused is honoured too', async ({ page }) => {
  test.setTimeout(120_000);
  await openChat(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  await page.setViewportSize({ width: 1180, height: 688 - TOOLBAR_PX });
  await page.waitForTimeout(500);

  expect(await rootHeight(page)).toBe(`${688 - TOOLBAR_PX}px`);
  expect(await inputIsOnScreen(page)).toBe(true);
});

test('growing back restores the height, while typing', async ({ page }) => {
  test.setTimeout(120_000);
  const ta = await openChat(page);
  await ta.click();
  await page.setViewportSize({ width: 1180, height: 688 - TOOLBAR_PX });
  await page.waitForTimeout(400);
  await page.keyboard.type('mais texto');

  await page.setViewportSize({ width: 1180, height: 688 });
  await page.waitForTimeout(500);

  expect(await rootHeight(page)).toBe('688px');
  expect(await inputIsOnScreen(page)).toBe(true);
});

test('a keyboard-sized shrink keeps the input above the keyboard', async ({ page }) => {
  test.setTimeout(120_000);
  const ta = await openChat(page);
  await ta.click();

  await page.setViewportSize({ width: 1180, height: 320 });
  await page.waitForTimeout(500);

  expect(await rootHeight(page)).toBe('320px');
  expect(await inputIsOnScreen(page)).toBe(true);
});
