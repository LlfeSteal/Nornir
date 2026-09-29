import { expect, Page, test } from '@playwright/test';
import { mockApi, warningTree } from './fixtures';

// The warning triangle at the end of a list row: dates missing in GitLab and epics or
// milestones without child items (their progress can't be tracked), one line per warning in
// its help tag and in the bar tooltip. Today is Thursday, October 15, 2026.

const EPIC = "No child items: progress can't be tracked (stays at 0% until closed)";
const MILESTONE = "No items: progress can't be tracked (stays at 0%)";

const listRow = (page: Page, name: string) => page.locator('.task-list-row', { has: page.getByTitle(name, { exact: true }) });
const warning = (page: Page, name: string) => listRow(page, name).locator('.row-warning');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('nornir.period', 'all'));
  await page.clock.setFixedTime(new Date('2026-10-15T12:00:00'));
  await mockApi(page, { body: warningTree });
  await page.goto('/');
  await expect(page.getByTitle('Empty epic', { exact: true })).toBeVisible();
});

test('flags epics and milestones without child items', async ({ page }) => {
  await expect(warning(page, 'Empty epic')).toHaveAttribute('title', EPIC);
  await expect(listRow(page, 'Empty epic').getByRole('img', { name: EPIC })).toBeVisible();
  await expect(warning(page, '[Milestone] Empty sprint')).toHaveAttribute('title', MILESTONE);
  await expect(listRow(page, 'Empty epic')).toHaveAttribute('data-empty', 'true');

  // An epic whose only child is closed has a child, even when closed items are hidden.
  await expect(listRow(page, 'Finished epic').getByRole('button', { name: 'Expand' })).toHaveCount(0);
  await expect(warning(page, 'Finished epic')).toHaveCount(0);
  await expect(warning(page, 'Busy epic')).toHaveCount(0);
});

test('one triangle, one line per warning', async ({ page }) => {
  const both = warning(page, 'Undated empty epic');
  await expect(both).toHaveCount(1);
  await expect(both).toHaveAttribute('title', `No dates in GitLab\n${EPIC}`);
  await expect(both).toHaveAttribute('aria-label', `No dates in GitLab. ${EPIC}`);

  // The bar tooltip shows each warning on its own line.
  // A one-day bar (today only): hover the bar itself, its label is outside it.
  const bar = (await page.locator('.bar', { has: page.locator('.bar-label', { hasText: 'Undated empty epic' }) }).boundingBox())!;
  await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
  await expect(page.locator('.gantt-tooltip .warning-note')).toHaveText(['No dates in GitLab', EPIC]);
});

test('an item without child items gets no schedule status: its 0% means nothing', async ({ page }) => {
  // Half of October is gone, the empty epic is at 0%: it would be "late" otherwise.
  const bar = page.locator('.bar', { has: page.locator('.bar-label', { hasText: /^Empty epic$/ }) });
  await expect(bar).toBeVisible();
  await expect(bar).not.toHaveAttribute('data-schedule');
  await expect(bar.locator('.linear-progress')).toHaveCount(0);
  await expect(listRow(page, 'Empty epic')).not.toHaveAttribute('data-schedule');

  const box = (await bar.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const tooltip = page.locator('.gantt-tooltip');
  await expect(tooltip.locator('.warning-note')).toHaveText([EPIC]);
  await expect(tooltip).not.toContainText('Expected');
});

test('the triangle sits with the other accessories, before the health icon', async ({ page }) => {
  // Busy epic has only a health icon, Empty epic only a triangle: both end the row.
  const right = async (name: string, selector: string) => {
    const box = (await listRow(page, name).locator(selector).boundingBox())!;
    return box.x + box.width;
  };
  expect(await right('Empty epic', '.row-warning')).toBeCloseTo(await right('Busy epic', '.health'), 0);
});
