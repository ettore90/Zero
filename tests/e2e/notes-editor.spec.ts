import { test, expect, type Page } from '@playwright/test';

// Regression cover for the controlled-contentEditable rebuild loop in
// RichNotesEditor. Every assertion here failed before the fix: the editor wrote
// back the value it had just emitted, replacing its own innerHTML on each
// keystroke and taking the caret, the pending line break, the active style and
// any list structure with it.

// A desktop viewport is required: at Playwright's default 1280x720 the shell
// collapses and the canvas rail is present but not visible.
test.use({ ignoreHTTPSErrors: true, viewport: { width: 1920, height: 1080 } });
test.setTimeout(120_000);

const NOTE_EDITOR = '[contenteditable="true"]';

async function openSessionNote(page: Page) {
  await page.goto('');
  await page.locator('select').first().selectOption('ettore');
  await page.getByRole('button', { name: 'Open Session' }).click();
  await page.getByRole('button', { name: 'Agents' }).waitFor({ state: 'visible', timeout: 30000 });

  // A chat session is already open on load, so the canvas rail's Notes button
  // has a target and no agent needs to be picked first.
  // First click on the rail icon opens the list of available notes.
  const rail = page.locator('[aria-label="Notes"]:visible').first();
  await rail.waitFor({ state: 'visible', timeout: 20000 });
  await rail.click();

  // Then either create one or open the first existing note.
  const create = page.getByRole('button', { name: /new note|nova nota|create note|\+/i }).first();
  if (await create.isVisible().catch(() => false)) await create.click();

  const editor = page.locator(NOTE_EDITOR).first();
  await editor.waitFor({ state: 'visible', timeout: 20000 });
  await editor.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  return editor;
}

test('Enter keeps both lines and leaves the caret on the second', async ({ page }) => {
  const editor = await openSessionNote(page);

  await page.keyboard.type('primeira linha');
  await page.keyboard.press('Enter');
  await page.keyboard.type('segunda linha');

  // The bug dropped the break or threw the caret back into line one, which
  // interleaved the text instead of keeping two lines.
  await expect(editor).toContainText('primeira linha');
  await expect(editor).toContainText('segunda linha');

  const lines = (await editor.innerText()).split('\n').map((l) => l.trim()).filter(Boolean);
  expect(lines).toEqual(['primeira linha', 'segunda linha']);
});

test('bold applies to the selection and survives further typing', async ({ page }) => {
  const editor = await openSessionNote(page);

  // A fresh note opens as an <h1>, whose text is already bold -- pressing Bold
  // there would toggle weight *off*. Drop to normal text first so the assertion
  // measures what a user would call bold.
  await page.getByRole('button', { name: 'Normal text' }).click();
  await page.keyboard.type('antes ');
  await page.getByRole('button', { name: 'Bold' }).click();
  await page.keyboard.type('negrito');

  // Asserted on computed weight rather than on a <b> tag: the command emits a
  // span with font-weight here, and either is correct as far as the user cares.
  const weights = await editor.evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const out: Record<string, number> = {};
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent?.trim() ?? '';
      const el = node.parentElement;
      if (text && el) {
        out[text] = Number.parseInt(getComputedStyle(el).fontWeight, 10) || 400;
      }
      node = walker.nextNode();
    }
    return out;
  });

  const boldWeight = weights['negrito'];
  const plainWeight = weights['antes'] ?? weights['antes '] ?? 400;
  expect(boldWeight, `pesos medidos: ${JSON.stringify(weights)}`).toBeGreaterThanOrEqual(600);
  expect(boldWeight).toBeGreaterThan(plainWeight);
  expect(await editor.innerText()).toContain('negrito');
});

test('a bullet list keeps one item per Enter', async ({ page }) => {
  const editor = await openSessionNote(page);

  await page.getByRole('button', { name: /bullet list/i }).click();
  await page.keyboard.type('item um');
  await page.keyboard.press('Enter');
  await page.keyboard.type('item dois');

  await expect(editor.locator('ul li')).toHaveCount(2);
  await expect(editor.locator('ul li').first()).toContainText('item um');
  await expect(editor.locator('ul li').nth(1)).toContainText('item dois');
});

test('pasted html arrives without the source styling', async ({ page }) => {
  const editor = await openSessionNote(page);
  await editor.click();

  // Paste markup shaped like a real copy out of a browser or word processor.
  await page.evaluate(() => {
    const dirty =
      '<span style="color:#ff0000;font-size:48px" class="mso-x">texto colado</span>' +
      '<p style="background:yellow"><b>negrito preservado</b></p>' +
      '<script>window.__pwned = true;<\/script>';
    const data = new DataTransfer();
    data.setData('text/html', dirty);
    data.setData('text/plain', 'texto colado negrito preservado');
    const target = document.querySelector('[role="textbox"][contenteditable="true"]')!;
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });

  const html = await editor.innerHTML();
  expect(await editor.innerText()).toContain('texto colado');
  // Structure is kept, the source's presentation is not.
  expect(html).toMatch(/<(b|strong)>/i);
  expect(html).not.toMatch(/style=/i);
  expect(html).not.toMatch(/class="mso-x"/i);
  expect(html).not.toMatch(/<script/i);
  expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();
});
