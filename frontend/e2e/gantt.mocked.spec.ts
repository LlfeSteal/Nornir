import { expect, test } from '@playwright/test';
import { config, mockApi } from './fixtures';

test.describe('Gantt (mocked API)', () => {
  test('shows the configured group and every row', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');

    await expect(page).toHaveTitle('Nornir');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Nornir');
    const groupLink = page.getByRole('link', { name: config.group });
    await expect(groupLink).toHaveAttribute('href', `${config.gitlabUrl}/${config.group}`);

    for (const name of ['[Milestone] Sprint 1', '[Milestone] Empty sprint', 'Main epic', 'Standalone issue']) {
      await expect(page.getByTitle(name).first()).toBeVisible();
    }
    // The issue attached to both the epic and the milestone appears twice.
    await expect(page.getByTitle('Shared issue')).toHaveCount(2);
  });

  test('collapsing an epic hides its children', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await expect(page.getByTitle('Standalone issue')).toBeVisible();

    const epicRow = page.getByTitle('Main epic').locator('..');
    await epicRow.getByText('▼').click();
    await expect(page.getByTitle('Standalone issue')).toHaveCount(0);
    await expect(page.getByTitle('Shared issue')).toHaveCount(1); // the copy under the milestone remains

    await epicRow.getByText('▶').click();
    await expect(page.getByTitle('Standalone issue')).toBeVisible();
  });

  test('switches view mode', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    for (const label of ['Day', 'Month', 'Week']) {
      const button = page.getByRole('button', { name: label, exact: true });
      await button.click();
      await expect(button).toHaveClass(/active/);
    }
  });

  test('Refresh bypasses the cache', async ({ page }) => {
    const calls = await mockApi(page);
    await page.goto('/');
    await expect(page.getByTitle('Main epic')).toBeVisible();
    expect(calls.at(-1)).not.toContain('refresh=1');

    await page.getByRole('button', { name: 'Refresh' }).click();
    await expect.poll(() => calls.at(-1)).toContain('refresh=1');
    await expect(page.getByTitle('Main epic')).toBeVisible();
  });

  test('shows the backend error', async ({ page }) => {
    await mockApi(page, { status: 404, body: { error: 'group not found or not accessible' } });
    await page.goto('/');
    await expect(page.getByText('Error: group not found or not accessible')).toBeVisible();
  });

  test('shows a message when the group is empty', async ({ page }) => {
    await mockApi(page, { body: [] });
    await page.goto('/');
    await expect(page.getByText('No data to display.')).toBeVisible();
  });
});
