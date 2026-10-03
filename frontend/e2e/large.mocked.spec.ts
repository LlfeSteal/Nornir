import { createHash } from 'node:crypto';
import { expect, Page, test } from '@playwright/test';
import { mockApi } from './fixtures';
import { countRows, DEEP, deepTree, isClosedTask, largeTree, linkedLargeTree, MANY_EPICS, manyEpicsTree } from './largeTree';

// A production-sized group (~5,000 items, ~16,000 rows with the backend's copies): the chart
// must show up quickly, render only the rows on screen and stay responsive.

const tree = largeTree();

// One test at a time: several browsers parsing tens of MB at once would compete for the CPU
// and blur the timings (the app itself takes a few ms to expand a row).
test.describe.configure({ mode: 'default' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('nornir.period', 'all'));
  await page.clock.setFixedTime(new Date('2026-10-15T12:00:00'));
});

/** Opens the page and returns how long the chart took to show its first row once the data
 * arrived (ms). */
async function open(page: Page, body: unknown = tree, firstRow = '[Milestone] Sprint 0') {
  const calls = await mockApi(page, { body });
  const response = page.waitForResponse((r) => r.url().includes('/api/gantt'));
  await page.goto('/');
  await response;
  const start = Date.now();
  await expect(page.getByTitle(firstRow, { exact: true })).toBeVisible({ timeout: 20_000 });
  return { calls, elapsed: Date.now() - start };
}

async function timed(action: () => Promise<void>) {
  const start = Date.now();
  await action();
  return Date.now() - start;
}

/** Wheels down over the chart until `name` is on screen. */
async function scrollTo(page: Page, name: string) {
  const box = (await page.locator('.gantt-chart').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const row = page.getByTitle(name, { exact: true });
  await expect(async () => {
    await page.mouse.wheel(0, 100_000);
    await expect(row).toBeInViewport({ timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

test.describe('large group', () => {
  test('the dataset is production-sized', () => {
    expect(countRows(tree)).toBeGreaterThan(15_000);
  });

  test('the chart shows up quickly and only renders the rows on screen', async ({ page }) => {
    const { elapsed } = await open(page);
    expect(elapsed).toBeLessThan(3_000);
    // About 870 top-level rows, but only those on screen are in the page.
    expect(await page.locator('.task-list-row').count()).toBeLessThan(100);
  });

  test('scrolling reaches the last row', async ({ page }) => {
    await open(page);
    // The last row: the top-level copy of the last nested epic.
    await scrollTo(page, 'Epic 39.4.2');
    await expect(page.getByTitle('[Milestone] Sprint 0', { exact: true })).not.toBeInViewport();
  });

  test('expanding and collapsing a group is immediate', async ({ page }) => {
    await open(page);
    // Sprint 2 holds open issues (Issue 2, Issue 32…).
    const group = page.locator('.task-list-row', { has: page.getByTitle('[Milestone] Sprint 2', { exact: true }) });
    const child = page.getByTitle('Issue 2', { exact: true });

    expect(await timed(async () => {
      await group.getByRole('button', { name: 'Expand' }).click();
      await expect(group.getByRole('button', { name: 'Collapse' })).toBeVisible();
      await expect(child).toBeInViewport();
    })).toBeLessThan(1_000);

    expect(await timed(async () => {
      await group.getByRole('button', { name: 'Collapse' }).click();
      await expect(group.getByRole('button', { name: 'Expand' })).toBeVisible();
    })).toBeLessThan(1_000);
  });

  test('searching narrows the list quickly', async ({ page }) => {
    await open(page);
    expect(await timed(async () => {
      await page.getByRole('textbox', { name: 'Search' }).fill('Issue 3998');
      await expect(page.locator('.task-list-row')).toHaveCount(1);
      await expect(page.getByTitle('Issue 3998', { exact: true })).toBeVisible();
    })).toBeLessThan(2_000);
  });

  test('Refresh keeps working', async ({ page }) => {
    const { calls } = await open(page);
    await page.getByRole('button', { name: 'Refresh' }).click();
    await expect.poll(() => calls.at(-1)).toContain('refresh=1');
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeEnabled();
    await expect(page.getByTitle('[Milestone] Sprint 0', { exact: true })).toBeVisible();
  });
});

test.describe('large group with blocking links', () => {
  const linked = linkedLargeTree();

  test('the chart still shows up quickly', async ({ page }) => {
    const { elapsed } = await open(page, linked);
    expect(elapsed).toBeLessThan(3_000);
    await expect(page.locator('.row-dependencies').first()).toBeVisible();
  });

  test("a milestone's dependencies open quickly, rendering only the rows on screen", async ({ page }) => {
    await open(page, linked);
    // Epic 0 holds ~100 issues, half of them blocked by another. Off screen: search it.
    await page.getByRole('textbox', { name: 'Search' }).fill('Epic 0');
    const row = page.locator('.task-list-row', { has: page.getByTitle('Epic 0', { exact: true }) });
    const button = row.locator('.row-dependencies');
    await expect(button).toBeVisible();
    const count = Number(await button.textContent());
    expect(count).toBeGreaterThan(10);
    const dialog = page.getByRole('dialog', { name: 'Dependencies of Epic 0' });
    expect(await timed(async () => {
      await button.click();
      await expect(dialog.locator('.dependency-links > path').first()).toBeVisible();
    })).toBeLessThan(1_000);
    await expect(dialog).toContainText(`${count} links`);
    expect(await dialog.locator('.task-list-row').count()).toBeLessThan(100);
  });
});

// Load test: more than 5,000 top-level epics of 2 to 5 issues each (~23,000 rows).
test.describe('5,000+ epics of 2 to 5 issues', () => {
  const epics = manyEpicsTree();
  const last = MANY_EPICS.epics - 1;
  const openIssues = epics.reduce((sum, epic) => sum + epic.children!.filter((issue) => !issue.closed).length, 0);

  test('the dataset has more than 5,000 epics of 2 to 5 issues', () => {
    expect(epics.length).toBeGreaterThan(5_000);
    for (const epic of epics) {
      expect(epic.type).toBe('epic');
      expect(epic.children!.length).toBeGreaterThanOrEqual(2);
      expect(epic.children!.length).toBeLessThanOrEqual(5);
    }
    expect(countRows(epics)).toBeGreaterThan(20_000);
  });

  test('the chart shows up quickly and only renders the rows on screen', async ({ page }) => {
    const { elapsed } = await open(page, epics, 'Epic 0');
    expect(elapsed).toBeLessThan(3_000);
    expect(await page.locator('.task-list-row').count()).toBeLessThan(100);
  });

  test('scrolling reaches the last epic, which expands at once', async ({ page }) => {
    await open(page, epics, 'Epic 0');
    await scrollTo(page, `Epic ${last}`);
    await expect(page.getByTitle('Epic 0', { exact: true })).not.toBeInViewport();
    expect(await page.locator('.task-list-row').count()).toBeLessThan(100);

    const epic = page.locator('.task-list-row', { has: page.getByTitle(`Epic ${last}`, { exact: true }) });
    expect(await timed(async () => {
      await epic.getByRole('button', { name: 'Expand' }).click();
      await expect(epic.getByRole('button', { name: 'Collapse' })).toBeVisible();
      await scrollTo(page, `Task ${last}.4`); // its last issue
    })).toBeLessThan(1_000);
    // Its open issues are listed, the closed one is hidden.
    for (let j = 0; j < 5; j++) {
      await expect(page.getByTitle(`Task ${last}.${j}`, { exact: true })).toHaveCount(isClosedTask(last, j) ? 0 : 1);
    }
  });

  test('searching an epic or an issue is quick', async ({ page }) => {
    await open(page, epics, 'Epic 0');
    const search = page.getByRole('textbox', { name: 'Search' });
    expect(await timed(async () => {
      await search.fill(`Epic ${last}`);
      await expect(page.locator('.task-list-row')).toHaveCount(1);
      await expect(page.getByTitle(`Epic ${last}`, { exact: true })).toBeVisible();
    })).toBeLessThan(2_000);

    await search.fill(`Task ${last}.2`);
    await expect(page.locator('.task-list-row')).toHaveCount(1);
    await expect(page.getByTitle(`Task ${last}.2`, { exact: true })).toBeVisible();
  });

  test('listing every issue on its own stays quick and virtualized', async ({ page }) => {
    expect(openIssues).toBeGreaterThan(14_000);
    await open(page, epics, 'Epic 0');
    const show = page.getByRole('group', { name: 'Show' });
    expect(await timed(async () => {
      await show.getByRole('button', { name: 'Milestones' }).click();
      await show.getByRole('button', { name: 'Epics' }).click();
      await expect(show.getByRole('button', { name: 'Epics' })).toHaveAttribute('aria-pressed', 'false');
      // Flat list of the issues: Task 0.0 is closed, Task 0.1 comes first.
      await expect(page.locator('.task-list-row').first()).toHaveAttribute('data-depth', '0');
      await expect(page.getByTitle('Task 0.1', { exact: true })).toBeVisible();
      await expect(page.getByTitle('Epic 0', { exact: true })).toHaveCount(0);
    })).toBeLessThan(2_000);
    expect(await page.locator('.task-list-row').count()).toBeLessThan(100);

    // The last open issue is at the end of the list.
    await scrollTo(page, `Task ${last}.4`);
  });
});

// Load test, worst case: 7 levels (milestone → 5 levels of epics → issue) and copies of every
// subtree (under milestones and at the top level): 86,270 rows, ~24 MB of JSON.
test.describe('deep hierarchy with duplicates', () => {
  const deep = deepTree();

  /** The row `name` at a given depth (the same item shows up at several places). */
  const rowAt = (page: Page, name: string, depth: number) =>
    page.locator(`.task-list-row[data-depth="${depth}"]`, { has: page.getByTitle(name, { exact: true }) });

  async function expand(page: Page, name: string, depth: number) {
    const row = rowAt(page, name, depth);
    return timed(async () => {
      await row.getByRole('button', { name: 'Expand' }).click();
      await expect(row.getByRole('button', { name: 'Collapse' })).toBeVisible();
      await expect(page.locator(`.task-list-row[data-depth="${depth + 1}"]`).first()).toBeVisible();
    });
  }

  test('the dataset is the backend output: 86,270 rows on 7 levels, IDs unique', () => {
    const hash = createHash('sha256');
    const ids = new Set<string>();
    const duplicates: string[] = [];
    let depth = 0;
    // One assertion at the end: 86,270 expect() calls would take minutes.
    const walk = (rows: typeof deep, level: number) =>
      rows.forEach((row) => {
        if (ids.has(row.id)) duplicates.push(row.id);
        ids.add(row.id);
        hash.update(row.id + '\n');
        depth = Math.max(depth, level);
        if (row.children) walk(row.children, level + 1);
      });
    walk(deep, 0);
    expect(duplicates).toEqual([]);
    expect(ids.size).toBe(DEEP.rows);
    expect(depth).toBe(DEEP.maxDepth);
    // Same IDs, in the same order, as the backend's deepGroup() (tree_builder_deep_test.go).
    expect(hash.digest('hex')).toBe(DEEP.sha256);
  });

  test('the chart shows up quickly and only renders the rows on screen', async ({ page }) => {
    const { elapsed } = await open(page, deep, '[Milestone] Sprint 00');
    expect(elapsed).toBeLessThan(3_000);
    expect(await page.locator('.task-list-row').count()).toBeLessThan(100);
  });

  test('drilling down 7 levels is immediate at every step', async ({ page }) => {
    await open(page, deep, '[Milestone] Sprint 00');
    // Sprint 05 holds the top-level Epic 1 and its whole subtree.
    const path = ['[Milestone] Sprint 05', 'Epic 1', 'Epic 1.0', 'Epic 1.0.0', 'Epic 1.0.0.0', 'Epic 1.0.0.0.0'];
    for (const [depth, name] of path.entries()) {
      expect(await expand(page, name, depth)).toBeLessThan(1_000);
    }
    // The issues, 6 levels down, with a tree line for each level.
    const issue = rowAt(page, 'Issue 1.0.0.0.0.1', 6);
    await expect(issue).toBeVisible();
    await expect(issue.locator('.tree-guide')).toHaveCount(5);
    expect(await page.locator('.task-list-row').count()).toBeLessThan(100);
  });

  test('each copy of an epic expands on its own', async ({ page }) => {
    await open(page, deep, '[Milestone] Sprint 00');
    for (const [depth, name] of ['[Milestone] Sprint 05', 'Epic 1', 'Epic 1.0'].entries()) await expand(page, name, depth);
    await rowAt(page, '[Milestone] Sprint 05', 0).getByRole('button', { name: 'Collapse' }).click();

    // Sprint 04 holds a copy of Epic 1.0: still collapsed.
    await expand(page, '[Milestone] Sprint 04', 0);
    const copy = rowAt(page, 'Epic 1.0', 1);
    await expect(copy.getByRole('button')).toHaveAttribute('aria-expanded', 'false');

    // Expanding it doesn't touch the other one, which stayed expanded.
    await copy.getByRole('button', { name: 'Expand' }).click();
    await rowAt(page, '[Milestone] Sprint 04', 0).getByRole('button', { name: 'Collapse' }).click();
    await rowAt(page, '[Milestone] Sprint 05', 0).getByRole('button', { name: 'Expand' }).click();
    await expect(rowAt(page, 'Epic 1.0', 2).getByRole('button')).toHaveAttribute('aria-expanded', 'true');
  });

  test('scrolling reaches the last row', async ({ page }) => {
    await open(page, deep, '[Milestone] Sprint 00');
    // The top-level copy of the last epic of the last root.
    await scrollTo(page, 'Epic 18.3.3.2.2');
    await expect(rowAt(page, 'Epic 18.3.3.2.2', 0)).toBeInViewport();
    expect(await page.locator('.task-list-row').count()).toBeLessThan(100);
  });

  test('an issue copied many times is found once, quickly', async ({ page }) => {
    await open(page, deep, '[Milestone] Sprint 00');
    expect(await timed(async () => {
      await page.getByRole('textbox', { name: 'Search' }).fill('Issue 18.3.3.2.2.1');
      await expect(page.locator('.task-list-row')).toHaveCount(1);
      await expect(page.getByTitle('Issue 18.3.3.2.2.1', { exact: true })).toBeVisible();
    })).toBeLessThan(2_000);
  });

  test('listing every issue on its own lists each open issue once, quickly', async ({ page }) => {
    await open(page, deep, '[Milestone] Sprint 00');
    const issues = DEEP.levels.reduce((product, n) => product * n, 1) * DEEP.issuesPerEpic;
    const open_ = issues - issues / 5; // one in five is closed
    const show = page.getByRole('group', { name: 'Show' });
    expect(await timed(async () => {
      await show.getByRole('button', { name: 'Milestones' }).click();
      await show.getByRole('button', { name: 'Epics' }).click();
      await expect(page.getByTitle('Epic 0', { exact: true })).toHaveCount(0);
      await expect(page.locator('.task-list-row').first()).toBeVisible();
    })).toBeLessThan(2_000);
    // Rows aren't all in the page: the canvas is sized for them (header + one row each).
    const header = (await page.locator('.gantt-header').boundingBox())!.height;
    const rowHeight = (await page.locator('.task-list-row').first().boundingBox())!.height;
    await expect
      .poll(async () => Math.round(((await page.locator('.gantt-canvas').boundingBox())!.height - header) / rowHeight))
      .toBe(open_);
    expect(await page.locator('.task-list-row').count()).toBeLessThan(100);
  });

  test('the attention summary counts the whole tree and filters quickly', async ({ page }) => {
    await open(page, deep, '[Milestone] Sprint 00');
    const chips = page.getByRole('group', { name: 'Attention summary' }).getByRole('button');
    await expect(chips.first()).toBeVisible();
    const chip = chips.first();
    expect(await timed(async () => {
      await chip.click();
      await expect(chip).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('.task-list-row').first()).toBeVisible();
    })).toBeLessThan(2_000);
    expect(await page.locator('.task-list-row').count()).toBeLessThan(100);
  });

  test('showing and hiding closed items stays quick', async ({ page }) => {
    await open(page, deep, '[Milestone] Sprint 00');
    const closed = page.getByRole('button', { name: 'Closed' });
    for (const pressed of ['true', 'false']) {
      expect(await timed(async () => {
        await closed.click();
        await expect(closed).toHaveAttribute('aria-pressed', pressed);
        await expect(page.getByTitle('[Milestone] Sprint 00', { exact: true })).toBeVisible();
      })).toBeLessThan(2_000);
    }
    expect(await page.locator('.task-list-row').count()).toBeLessThan(100);
  });
});
