import { test, expect, type Locator, type Page } from '@playwright/test';

// nginx serves a self-signed cert inside the compose network, so navigation
// fails with ERR_CERT_AUTHORITY_INVALID without this.
// The shell needs a desktop-width viewport: at Playwright's default 1280x720 it
// collapses to a compact layout where the nav controls exist in the DOM but are
// not visible, which reads as "the app renders nothing".
test.use({ ignoreHTTPSErrors: true, viewport: { width: 1920, height: 1080 } });

// The shell takes ~15s to mount after Open Session, which leaves nothing of
// the config's 30s budget for the assertions that follow.
test.setTimeout(90_000);

async function isVisible(locator: Locator): Promise<boolean> {
  return locator.isVisible().catch(() => false);
}

async function waitForAuthenticatedShell(page: Page): Promise<void> {
  const shellSignals = {
    // Icon-only buttons: they carry an aria-label and no text node, so
    // getByText never matched them.
    projects: page.getByRole('button', { name: 'Projects' }),
    orchestration: page.getByRole('button', { name: 'Orchestration' }),
    notifications: page.getByRole('button', { name: 'Notifications' }),
    agents: page.getByRole('button', { name: 'Agents' }),
  };

  await expect
    .poll(
      async () => ({
        projects: await isVisible(shellSignals.projects),
        orchestration: await isVisible(shellSignals.orchestration),
        notifications: await isVisible(shellSignals.notifications),
        agents: await isVisible(shellSignals.agents),
      }),
      { timeout: 30000 },
    )
    .toMatchObject({
      projects: true,
      orchestration: true,
      notifications: true,
      agents: true,
    });
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
