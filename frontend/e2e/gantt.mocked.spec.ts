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

/** Visible list rows, in order: name, tree depth and whether it is its parent's last child. */
async function listRows(page: Page) {
  return page.locator('.task-list-row').evaluateAll((rows) =>
    rows.map((row) => ({
      name: row.querySelector('.task-list-cell')!.getAttribute('title')!,
      depth: Number(row.getAttribute('data-depth')),
      last: !!row.querySelector('.tree-branch.last'),
      nameX: row.querySelector('.task-list-name')!.getBoundingClientRect().x,
      background: getComputedStyle(row).backgroundColor,
    })),
  );
}

/** Fill of the bar whose label is `name` (the first one when the name is repeated). */
async function barFill(page: Page, name: string, nth = 0) {
  return page
    .locator('svg text', { hasText: name })
    .nth(nth)
    .evaluate((label) => label.parentElement!.querySelector('rect')!.getAttribute('fill')!);
}

function luminance(hex: string) {
  const value = parseInt(hex.slice(1), 16);
  return 0.2126 * ((value >> 16) & 255) + 0.7152 * ((value >> 8) & 255) + 0.0722 * (value & 255);
}

const EPIC_BAND = 'rgba(49, 130, 206, 0.1)'; // epic color #3182ce at 10%

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

  test('expanded children are indented right below their parent, with tree connectors', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await page.getByTitle('Main epic').locator('..').getByText('▶').click();

    let rows = await listRows(page);
    let parent = rows.findIndex((r) => r.name === 'Main epic');
    expect(rows.slice(parent + 1, parent + 4).map((r) => [r.name, r.depth, r.last])).toEqual([
      ['Shared issue', 1, false],
      ['Standalone issue', 1, false],
      ['Child epic', 1, true],
    ]);
    expect(rows[parent + 1].nameX).toBeGreaterThan(rows[parent].nameX);
    // The top-level copy of the nested epic stays at depth 0, after the group.
    expect(rows.filter((r) => r.name === 'Child epic').map((r) => r.depth)).toEqual([1, 0]);

    // One more level: the nested epic's child comes right below it, further indented.
    await page.locator('.task-list-row[data-depth="1"]', { has: page.getByTitle('Child epic') }).getByText('▶').click();
    rows = await listRows(page);
    parent = rows.findIndex((r) => r.name === 'Child epic' && r.depth === 1);
    expect(rows[parent + 1]).toMatchObject({ name: 'Deep issue', depth: 2, last: true });
    expect(rows[parent + 1].nameX).toBeGreaterThan(rows[parent].nameX);
  });

  test("rows of an expanded group are tinted in the group's color, in the list and the timeline", async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    const epicRow = page.getByTitle('Main epic').locator('..');
    await epicRow.getByText('▶').click();

    const rows = await listRows(page);
    const child = rows.findIndex((r) => r.name === 'Standalone issue');
    expect(rows[child].background).toBe(EPIC_BAND);
    expect(rows.find((r) => r.name === 'Main epic')!.background).not.toBe(EPIC_BAND);

    // Timeline rows are 50 px high: the child's row is the grid rect at its index.
    const timelineRow = page.locator(`g.rows rect[y="${child * 50}"]`);
    await expect.poll(() => timelineRow.evaluate((rect) => (rect as SVGRectElement).style.fill)).toBe(EPIC_BAND);

    await epicRow.getByText('▼').click();
    await expect.poll(() => timelineRow.evaluate((rect) => (rect as SVGRectElement).style.fill)).not.toBe(EPIC_BAND);
  });

  test('child bars are lighter than top-level bars', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await page.getByTitle('Main epic').locator('..').getByText('▶').click();
    await expect(page.locator('svg text', { hasText: 'Child epic' })).toHaveCount(2);

    // Same type (epic): the nested one (first, under Main epic) vs its top-level copy.
    const nested = await barFill(page, 'Child epic', 0);
    const topLevel = await barFill(page, 'Child epic', 1);
    expect(luminance(nested)).toBeGreaterThan(luminance(topLevel));
    expect(topLevel).toBe(await barFill(page, 'Main epic'));
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
