import { test, expect, type Locator, type Page } from '@playwright/test';

async function isVisible(locator: Locator): Promise<boolean> {
  return locator.isVisible().catch(() => false);
}

async function waitForAuthenticatedShell(page: Page): Promise<void> {
  const shellSignals = {
    projects: page.getByText('Projects', { exact: true }),
    orchestration: page.getByText('Orchestration', { exact: true }),
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
  await page.goto('/zero/');
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
