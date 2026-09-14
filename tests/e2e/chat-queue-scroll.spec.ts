import { test, expect, type Locator, type Page } from '@playwright/test';

test.use({ ignoreHTTPSErrors: true, viewport: { width: 1920, height: 1080 } });
test.setTimeout(300_000);

async function isVisible(locator: Locator): Promise<boolean> {
  return locator.isVisible().catch(() => false);
}

// O shell monta o painel de chat em mais de um slot (normal e fullscreen), então
// todo seletor do chat casa várias vezes; só um deles está visível.
const visible = (locator: Locator) => locator.filter({ visible: true }).first();

async function openShell(page: Page) {
  await page.goto('');
  const userSelect = page.locator('select').first();
  await userSelect.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
  if (await isVisible(userSelect)) {
    await userSelect.selectOption('ettore');
    await page.getByRole('button', { name: 'Open Session' }).click();
  }
  await expect(visible(page.locator('textarea[placeholder]'))).toBeVisible({ timeout: 60000 });
}

test('input stays free during a cycle; queued message is editable and then delivered', async ({ page }) => {
  await openShell(page);

  const input = visible(page.locator('textarea[placeholder]'));
  await input.fill('Rode `ls /uby/zero/hooks` com run_terminal_command e me diga quantos arquivos apareceram.');
  await input.press('Control+Enter');

  const stop = visible(page.getByTitle('Stop generation'));
  await expect(stop).toBeVisible({ timeout: 60000 });

  // 1. a barra continua livre enquanto o agente trabalha
  const liveInput = visible(page.getByPlaceholder('Message — queued until the cycle ends...'));
  await expect(liveInput).toBeEnabled();
  await liveInput.fill('mensagem enfileirada original');
  await liveInput.press('Control+Enter');

  const queuedBadge = visible(page.getByText('Queued', { exact: true }));
  await expect(queuedBadge).toBeVisible();
  await expect(visible(page.getByText('mensagem enfileirada original'))).toBeVisible();

  // 2. edição inline dentro do balão
  await visible(page.getByRole('button', { name: 'Edit', exact: true })).click();
  const editor = visible(page.locator('textarea:not([placeholder])'));
  await expect(editor).toBeVisible();
  await editor.fill('mensagem enfileirada editada');
  await visible(page.getByRole('button', { name: 'Save', exact: true })).click();
  await expect(visible(page.getByText('mensagem enfileirada editada'))).toBeVisible();

  // 3. entrega: fechado o ciclo, o balão deixa de estar na fila e o texto vira
  // mensagem de verdade, que abre o ciclo seguinte.
  await expect(queuedBadge).toBeHidden({ timeout: 240000 });
  // A entrega recarrega a sessão pelo SSE, então a mensagem reaparece como
  // mensagem de verdade alguns frames depois de o balão sair.
  await expect(visible(page.getByText('mensagem enfileirada editada'))).toBeVisible({ timeout: 30000 });
});

test('scrolling up holds the position and the jump button brings it back', async ({ page }) => {
  await openShell(page);

  const scroller = visible(page.locator('div.h-full.overflow-y-auto.custom-scrollbar'));
  await expect(scroller).toBeVisible();

  // Uma conversa curta demais não rola, e aí não há nada a verificar.
  const scrollable = await scroller.evaluate((el) => el.scrollHeight - el.clientHeight);
  test.skip(scrollable < 200, 'histórico curto demais para rolar');

  const jump = visible(page.getByTitle('Jump to latest'));
  await expect(jump).toBeHidden();

  const before = await scroller.evaluate((el) => el.scrollTop);
  await scroller.hover();
  await page.mouse.wheel(0, -3000);
  await expect(jump).toBeVisible({ timeout: 10000 });
  const after = await scroller.evaluate((el) => el.scrollTop);
  expect(after).toBeLessThan(before);

  await jump.click();
  await expect(jump).toBeHidden({ timeout: 10000 });
  await expect
    .poll(async () => scroller.evaluate((el) => Math.abs(el.scrollHeight - el.scrollTop - el.clientHeight)), { timeout: 10000 })
    .toBeLessThanOrEqual(80);
});

test('an expanded tool run is capped and collapses back from the bottom', async ({ page }) => {
  await openShell(page);

  // O nó de atividade fechado: "Worked for 12.3s · 9 tool calls".
  const activity = visible(page.getByRole('button', { name: /Work(ed|ing)/ }));
  await expect(activity).toBeVisible({ timeout: 30000 });
  await activity.click();

  const details = visible(page.locator('div.max-h-\\[50vh\\].overflow-y-auto'));
  await expect(details).toBeVisible();

  const box = await details.evaluate((el) => ({ height: el.clientHeight, scroll: el.scrollHeight }));
  expect(box.height).toBeLessThanOrEqual(Math.round(1080 * 0.5) + 2);

  const collapse = visible(page.getByRole('button', { name: 'Collapse', exact: true }));
  await expect(collapse).toBeVisible();
  await collapse.click();
  await expect(details).toBeHidden();
  // Fechar mantém o cabeçalho no campo de visão em vez de deixar a tela onde estava.
  await expect(activity).toBeInViewport();
});

test('the command stream keeps the same scroll contract', async ({ page }) => {
  await openShell(page);

  await visible(page.locator('[aria-label="Stream"]')).click();
  // A classe de fundo distingue o viewport do stream do wrapper do canvas, que
  // também é `h-full overflow-auto`.
  const scroller = visible(page.locator('div.h-full.overflow-auto.bg-slate-200'));
  await expect(scroller).toBeVisible({ timeout: 20000 });

  const scrollable = await scroller.evaluate((el) => el.scrollHeight - el.clientHeight);
  test.skip(scrollable < 200, 'stream curto demais para rolar');

  const jump = visible(page.getByTitle('Jump to latest'));
  await expect(jump).toBeHidden();

  await scroller.hover();
  await page.mouse.wheel(0, -3000);
  await expect(jump).toBeVisible({ timeout: 10000 });

  await jump.click();
  await expect
    .poll(async () => scroller.evaluate((el) => Math.abs(el.scrollHeight - el.scrollTop - el.clientHeight)), { timeout: 10000 })
    .toBeLessThanOrEqual(80);
});
