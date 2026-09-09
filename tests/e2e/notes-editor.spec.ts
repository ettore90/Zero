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

  // "New" creates a note and opens it in the canvas. This has to be explicit:
  // relying on whatever note the canvas happened to have open made the suite
  // flaky, since on a fresh session there is no editor to find at all.
  // Each run therefore leaves one note behind.
  await page.getByRole('button', { name: 'New', exact: true }).click();

  // New creates and selects the note but does not open it; the row has to be
  // clicked to load it into the canvas editor.
  await page.getByRole('button', { name: /^Session note/ }).first().click();

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

// --- the block model, the "/" menu and its submenus -------------------------
// Everything below covers the rewrite that replaced execCommand-driven Enter
// and insertHTML-driven slash insertion with the Range-based block model in
// components/notes/blocks.ts.

const SLASH_MENU = '[role="listbox"][aria-label="Insert"]';

test('the "/" menu opens on an empty block', async ({ page }) => {
  const editor = await openSessionNote(page);

  // The old trigger required range.startContainer to be a text node, so "/" as
  // the first character of a block -- a block holding only its <br>
  // placeholder -- did nothing at all.
  await page.keyboard.type('/');

  await expect(page.locator(SLASH_MENU)).toBeVisible();
  await expect(page.getByRole('option', { name: /Task/ })).toBeVisible();
  expect(await editor.innerText()).not.toContain('Task');
});

test('a slash command inserted mid-paragraph leaves no orphan paragraph', async ({ page }) => {
  const editor = await openSessionNote(page);

  await page.getByRole('button', { name: 'Normal text' }).click();
  await page.keyboard.type('contexto antes');
  await page.keyboard.type(' /task');
  await expect(page.locator(SLASH_MENU)).toBeVisible();
  await page.keyboard.press('Enter');

  // execCommand('insertHTML') of a <p> with the caret inside another <p> made
  // the browser split the host block, which left empty paragraphs around the
  // new row.
  await expect(editor.locator('p[data-note-type="task"]')).toHaveCount(1);
  const blocks = await editor.evaluate((root) =>
    Array.from(root.children).map((el) => ({
      tag: el.tagName.toLowerCase(),
      text: (el.textContent ?? '').replace(/ /g, ' ').trim(),
      noteType: el.getAttribute('data-note-type'),
    })),
  );
  expect(blocks.filter((b) => !b.text && !b.noteType)).toEqual([]);
  expect(blocks[0].text).toBe('contexto antes');

  // The typed "/task" is consumed, not left behind as text.
  expect(await editor.innerText()).not.toContain('/task');

  // And the caret lands inside the new row, so typing continues there.
  await page.keyboard.type('comprar pao');
  await expect(editor.locator('p[data-note-type="task"] [data-note-content]')).toContainText('comprar pao');
});

test('a submenu is reachable by keyboard alone', async ({ page }) => {
  const editor = await openSessionNote(page);

  await page.getByRole('button', { name: 'Normal text' }).click();
  await page.keyboard.type('/');
  await expect(page.locator(SLASH_MENU)).toBeVisible();

  // Heading is a submenu: ArrowRight opens it, ArrowDown moves inside it.
  await page.getByRole('option', { name: /^Heading/ }).hover();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('option', { name: 'Heading 2 H2' })).toBeVisible();
  await page.getByRole('option', { name: 'Heading 2 H2' }).hover();
  await page.keyboard.press('Enter');

  await page.keyboard.type('titulo de secao');
  await expect(editor.locator('h2')).toContainText('titulo de secao');
  await expect(page.locator(SLASH_MENU)).toHaveCount(0);
});

test('searching the "/" menu reaches a nested command directly', async ({ page }) => {
  const editor = await openSessionNote(page);

  await page.getByRole('button', { name: 'Normal text' }).click();
  // The query is matched across every level, so a submenu child is one keystroke
  // away without navigating into its parent.
  await page.keyboard.type('/h3');
  await expect(page.getByRole('option', { name: /Heading 3/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.type('sub secao');

  await expect(editor.locator('h3')).toContainText('sub secao');
});

test('Enter after a heading drops back to a paragraph', async ({ page }) => {
  const editor = await openSessionNote(page);

  await page.getByRole('button', { name: 'Heading 1' }).click();
  await page.keyboard.type('um titulo');
  await page.keyboard.press('Enter');
  await page.keyboard.type('corpo do texto');

  // execCommand('insertParagraph') used to continue the heading, so the body
  // text came out as another H1.
  await expect(editor.locator('h1')).toHaveCount(1);
  await expect(editor.locator('h1')).toContainText('um titulo');
  const second = editor.locator('> *').nth(1);
  expect((await second.evaluate((el) => el.tagName)).toLowerCase()).toBe('p');
  await expect(second).toContainText('corpo do texto');
});

test('Enter on an empty list item leaves the list', async ({ page }) => {
  const editor = await openSessionNote(page);

  await page.getByRole('button', { name: /bullet list/i }).click();
  await page.keyboard.type('unico item');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('fora da lista');

  await expect(editor.locator('ul li')).toHaveCount(1);
  await expect(editor.locator('ul li')).toContainText('unico item');
  await expect(editor.locator('ul + p')).toContainText('fora da lista');
});

test('Shift+Enter breaks the line without starting a block', async ({ page }) => {
  const editor = await openSessionNote(page);

  await page.getByRole('button', { name: 'Normal text' }).click();
  await page.keyboard.type('linha um');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('linha dois');

  // One paragraph, two visual lines. Shift+Enter used to fall through to the
  // browser and never reached onChange.
  await expect(editor.locator('p')).toHaveCount(1);
  await expect(editor.locator('p br')).toHaveCount(1);
  expect(await editor.innerText()).toContain('linha um');
  expect(await editor.innerText()).toContain('linha dois');
});

test('a task row carries no styling in its saved markup and toggles', async ({ page }) => {
  const editor = await openSessionNote(page);

  await page.getByRole('button', { name: 'Normal text' }).click();
  await page.keyboard.type('/task');
  await page.keyboard.press('Enter');
  await page.keyboard.type('revisar o plano');

  const row = editor.locator('p[data-note-type="task"]');
  await expect(row).toHaveAttribute('data-task-completed', 'false');

  // Presentation used to be baked into the persisted HTML as Tailwind class
  // lists, which froze old notes to the old look.
  const rowHtml = await row.evaluate((el) => el.outerHTML);
  expect(rowHtml).not.toMatch(/class=/i);
  expect(rowHtml).not.toMatch(/<svg/i);
  expect(rowHtml).toContain('data-note-content');

  await row.locator('[data-note-task-toggle]').click();
  await expect(row).toHaveAttribute('data-task-completed', 'true');
  await expect(row.locator('[data-note-content]')).toContainText('revisar o plano');
});

test('the table size grid inserts the picked shape', async ({ page }) => {
  const editor = await openSessionNote(page);

  await page.getByRole('button', { name: 'Normal text' }).click();
  await page.keyboard.type('/table');
  await page.getByRole('option', { name: /^Table/ }).click();
  await page.getByRole('button', { name: 'Insert 2 by 3 table' }).click();

  const table = editor.locator('table');
  await expect(table).toHaveCount(1);
  await expect(table.locator('tr')).toHaveCount(2);
  await expect(table.locator('tr').first().locator('th, td')).toHaveCount(3);
  // A trailing block is always kept so a table at the end stays escapable.
  await expect(editor.locator('table + p')).toHaveCount(1);
});

test('Escape closes the "/" menu without inserting', async ({ page }) => {
  const editor = await openSessionNote(page);

  await page.getByRole('button', { name: 'Normal text' }).click();
  await page.keyboard.type('nota /dec');
  await expect(page.locator(SLASH_MENU)).toBeVisible();
  await page.keyboard.press('Escape');

  await expect(page.locator(SLASH_MENU)).toHaveCount(0);
  await expect(editor.locator('p[data-note-type="decision"]')).toHaveCount(0);
  // The typed text is left exactly as the user typed it.
  expect(await editor.innerText()).toContain('nota /dec');
});
