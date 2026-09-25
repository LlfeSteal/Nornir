import { expect, Page, test } from '@playwright/test';
import { config, mockApi } from './fixtures';

const LIST_WIDTH = 220;

/** Horizontal position of the today line, relative to its column and to the chart area. */
async function todayLinePosition(page: Page) {
  const line = page.locator('line.today-line');
  await expect(line).toHaveCount(1);
  const lineBox = (await line.boundingBox())!;
  const columnBox = (await page.locator('g.today rect').boundingBox())!;
  const chartBox = (await page.locator('.gantt-chart').boundingBox())!;
  const lineX = lineBox.x + lineBox.width / 2;
  return {
    offsetInColumn: lineX - columnBox.x,
    offsetFromCenter: lineX - (chartBox.x + LIST_WIDTH + (chartBox.width - LIST_WIDTH) / 2),
  };
}

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

  test('the list only shows item names', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');

    await expect(page.locator('.task-list-header')).toHaveText('Name');
    await expect(page.getByText('From', { exact: true })).toHaveCount(0);
    await expect(page.getByText('To', { exact: true })).toHaveCount(0);
    // No date is written in the list rows.
    await expect(page.locator('.task-list')).not.toContainText('2026');
  });

  test('hovering a bar shows its dates in the tooltip', async ({ page }) => {
    // The chart opens centered on today: pick a day where the hovered bar is on screen.
    await page.clock.setFixedTime(new Date('2026-10-15T12:00:00'));
    await mockApi(page);
    await page.goto('/');

    // The label doesn't receive pointer events: move the mouse onto it, over the bar.
    const label = await page.locator('svg text', { hasText: 'Main epic' }).boundingBox();
    await page.mouse.move(label!.x + label!.width / 2, label!.y + label!.height / 2);
    const tooltip = page.locator('.gantt-tooltip');
    await expect(tooltip).toContainText('Main epic');
    await expect(tooltip).toContainText('From Oct 1, 2026 to Dec 1, 2026');
    await expect(tooltip).toContainText('Progress: 50 %');
  });

  test('marks today with a line and centers the chart on it', async ({ page }) => {
    // Thursday at noon: the middle of its week column.
    await page.clock.setFixedTime(new Date('2026-10-15T12:00:00'));
    await mockApi(page);
    await page.goto('/');

    let position = await todayLinePosition(page);
    expect(position.offsetInColumn).toBeCloseTo(0.5 * 120, 0); // week columns are 120 px
    expect(Math.abs(position.offsetFromCenter)).toBeLessThanOrEqual(120);

    // Switching view mode centers again, and the line follows the new columns.
    await page.getByRole('button', { name: 'Month', exact: true }).click();
    await expect.poll(async () => (await todayLinePosition(page)).offsetInColumn).toBeCloseTo((14.5 / 31) * 200, 0);
    position = await todayLinePosition(page);
    expect(Math.abs(position.offsetFromCenter)).toBeLessThanOrEqual(200);
  });

  test('the today line stays when rows are expanded', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-15T12:00:00'));
    await mockApi(page);
    await page.goto('/');
    await expect(page.locator('line.today-line')).toHaveCount(1);

    await page.getByTitle('Main epic').locator('..').getByText('▶').click();
    await expect(page.getByTitle('Standalone issue')).toBeVisible();
    const line = page.locator('line.today-line');
    await expect(line).toHaveCount(1);
    // The line spans every visible row, including the new ones (rows are 50 px high).
    const rows = await page.locator('.task-list-row').count();
    await expect.poll(async () => Number(await line.getAttribute('y2'))).toBeGreaterThanOrEqual(rows * 50);
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
