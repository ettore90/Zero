import { test, expect, type Locator, type Page } from '@playwright/test';

// nginx serves a self-signed cert inside the compose network, so navigation
// fails with ERR_CERT_AUTHORITY_INVALID without this.
test.use({ ignoreHTTPSErrors: true });

// The shell takes ~15s to mount after Open Session, which leaves nothing of
// the config's 30s budget for the assertions that follow.
test.setTimeout(90_000);

async function isVisible(locator: Locator): Promise<boolean> {
  return locator.isVisible().catch(() => false);
}

async function waitForAuthenticatedShell(page: Page): Promise<void> {
  // These are the controls the shell actually renders today. The previous set
  // (Projects / Orchestration / Notifications / Agents) no longer exists, so
  // this poll could never succeed.
  const shellSignals = {
    agents: page.getByRole('button', { name: 'Open agents' }),
    sessions: page.getByRole('button', { name: 'Open sessions' }),
    theme: page.getByRole('button', { name: /Switch to (dark|light) mode/ }),
  };

  await expect
    .poll(
      async () => ({
        agents: await isVisible(shellSignals.agents),
        sessions: await isVisible(shellSignals.sessions),
        theme: await isVisible(shellSignals.theme),
      }),
      { timeout: 30000 },
    )
    .toMatchObject({ agents: true, sessions: true, theme: true });
}

test('app opens and reaches authenticated shell for ettore', async ({ page }) => {
  await page.goto('');
  await expect(page.locator('#root')).toBeVisible();
  await expect(page.getByText('Application failed to start')).not.toBeVisible();
  await expect(page.getByText('Application failed to render')).not.toBeVisible();

  const authTitle = page.getByText('Select user', { exact: true });

  if (await isVisible(authTitle)) {
    const existingUserForm = page.locator('form').filter({ has: authTitle });
    const userLabel = existingUserForm.getByText('Existing users', { exact: true });
    const userSelect = existingUserForm.locator('select');
    const openSession = existingUserForm.getByRole('button', { name: 'Open Session' });

    await expect(userLabel).toBeVisible();
    await expect(userSelect).toBeVisible();
    await userSelect.selectOption('ettore');
    await expect(openSession).toBeEnabled();
    await openSession.click();
    await expect(authTitle).not.toBeVisible({ timeout: 30000 });
  }

  await waitForAuthenticatedShell(page);
  await expect(page.getByText('Application failed to start')).not.toBeVisible();
  await expect(page.getByText('Application failed to render')).not.toBeVisible();
});
