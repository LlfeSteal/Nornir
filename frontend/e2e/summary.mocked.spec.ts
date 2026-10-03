import { expect, Page, test } from '@playwright/test';
import { dependencyTree, mockApi, attentionTree } from './fixtures';

// The attention summary: what needs attention among the items of the period, each item
// counted once; a chip lists those items. Today is October 15, 2026.

const summary = (page: Page) => page.getByRole('group', { name: 'Attention summary' });
const chipNames = (page: Page) => summary(page).getByRole('button').evaluateAll((chips) => chips.map((c) => c.getAttribute('aria-label')));
const rowNames = (page: Page) => page.locator('main .task-list-cell').evaluateAll((cells) => cells.map((c) => c.getAttribute('title')));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('nornir.period', 'all'));
  await page.clock.setFixedTime(new Date('2026-10-15T12:00:00'));
});

test('counts each item once, whatever its copies', async ({ page }) => {
  await mockApi(page, { body: attentionTree });
  await page.goto('/');
  // Payments is late under its milestone and on its own: once.
  await expect.poll(() => chipNames(page)).toEqual(['1 late', '1 at risk', '1 past their parent', '1 without children']);
});

test('a chip lists its items, and lists everything again when released', async ({ page }) => {
  await mockApi(page, { body: attentionTree });
  await page.goto('/');
  const late = summary(page).getByRole('button', { name: '1 late' });
  await late.click();
  await expect(late).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/attention=late/);
  await expect.poll(() => rowNames(page)).toEqual(['Payments']);
  // The other counts stay: they are taken before the filters.
  await expect.poll(() => chipNames(page)).toEqual(['1 late', '1 at risk', '1 past their parent', '1 without children']);

  // Two chips: either.
  await summary(page).getByRole('button', { name: '1 at risk' }).click();
  await expect.poll(() => rowNames(page)).toEqual(['Payments', 'Indexer']);

  await late.click();
  await summary(page).getByRole('button', { name: '1 at risk' }).click();
  await expect.poll(async () => (await rowNames(page)).length).toBe(5);
});

test('the counts follow the period', async ({ page }) => {
  await mockApi(page, { body: attentionTree });
  // Q3 2026: only Release 1 and Payments reach into it. Refunds, Payments' only child, doesn't:
  // as in the chart, Payments has no child there, so no schedule status — nothing is late.
  await page.goto('/?period=quarter&offset=-1');
  await expect(summary(page)).toHaveText('Nothing needs attention');
  await page.getByRole('button', { name: 'Next period' }).click();
  await expect.poll(() => chipNames(page)).toEqual(['1 late', '1 at risk', '1 past their parent', '1 without children']);
});

test('the Blocked chip is the Blocked filter', async ({ page }) => {
  await mockApi(page, { body: dependencyTree });
  await page.goto('/');
  const chip = summary(page).getByRole('button', { name: /blocked$/ });
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('search').getByRole('button', { name: 'Blocked', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('says when nothing needs attention', async ({ page }) => {
  await mockApi(page, {
    body: [{ id: 'gid://gitlab/WorkItem/1', name: 'Fine', type: 'issue', start: '2026-10-01', end: '2026-10-20', progress: 0, linearProgress: 0 }],
  });
  await page.goto('/');
  await expect(summary(page)).toHaveText('Nothing needs attention');
});
