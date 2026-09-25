import { expect, test } from '@playwright/test';
import { config, mockApi } from './fixtures';

test.describe('Gantt (mocked API)', () => {
  test('shows the configured group and only the collapsed top-level rows', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');

    await expect(page).toHaveTitle('Nornir');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Nornir');
    const groupLink = page.getByRole('link', { name: config.group });
    await expect(groupLink).toHaveAttribute('href', `${config.gitlabUrl}/${config.group}`);

    for (const name of ['[Milestone] Sprint 1', '[Milestone] Empty sprint', 'Main epic']) {
      await expect(page.getByTitle(name).first()).toBeVisible();
    }
    // Everything starts collapsed: no child row is rendered.
    await expect(page.getByTitle('Shared issue')).toHaveCount(0);
    await expect(page.getByTitle('Standalone issue')).toHaveCount(0);
    await expect(page.getByTitle('Deep issue')).toHaveCount(0);
  });

  test('a nested epic is also listed at the top level', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');

    // Only the top-level copy is visible while its parent is collapsed.
    await expect(page.getByTitle('Child epic')).toHaveCount(1);
    await page.getByTitle('Child epic').locator('..').getByText('▶').click();
    await expect(page.getByTitle('Deep issue')).toHaveCount(1);

    // Expanding the parent shows the nested epic in its hierarchy too.
    await page.getByTitle('Main epic').locator('..').getByText('▶').click();
    await expect(page.getByTitle('Child epic')).toHaveCount(2);
  });

  test('expanding and collapsing a group shows and hides its children', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');

    const epicRow = page.getByTitle('Main epic').locator('..');
    await epicRow.getByText('▶').click();
    await expect(page.getByTitle('Standalone issue')).toBeVisible();
    await expect(page.getByTitle('Shared issue')).toHaveCount(1);

    // The issue attached to both the epic and the milestone also shows up under the milestone.
    await page.getByTitle('[Milestone] Sprint 1').locator('..').getByText('▶').click();
    await expect(page.getByTitle('Shared issue')).toHaveCount(2);

    await epicRow.getByText('▼').click();
    await expect(page.getByTitle('Standalone issue')).toHaveCount(0);
    await expect(page.getByTitle('Shared issue')).toHaveCount(1); // the copy under the milestone remains
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

  test('Refresh bypasses the cache and keeps expanded rows', async ({ page }) => {
    const calls = await mockApi(page);
    await page.goto('/');
    await expect(page.getByTitle('Main epic')).toBeVisible();
    expect(calls.at(-1)).not.toContain('refresh=1');

    await page.getByTitle('Main epic').locator('..').getByText('▶').click();
    await expect(page.getByTitle('Standalone issue')).toBeVisible();

    await page.getByRole('button', { name: 'Refresh' }).click();
    await expect.poll(() => calls.at(-1)).toContain('refresh=1');
    // The rows expanded before the refresh stay expanded.
    await expect(page.getByTitle('Standalone issue')).toBeVisible();
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
