import { expect, Page, test } from '@playwright/test';
import { groupSubgroups, mockApi, subgroupTree } from './fixtures';

// The Subgroups menu picks the items of GitLab subgroups (a subgroup holds its nested ones)
// or of the group itself (outside every subgroup).

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('nornir.period', 'all'));
});

const listedNames = (page: Page) => page.locator('.task-list-row > div[title]').evaluateAll((cells) => cells.map((cell) => cell.getAttribute('title')));

async function pick(page: Page, menu: string, option: string) {
  await page.getByRole('button', { name: menu }).click();
  await page.getByRole('dialog', { name: 'Subgroups' }).getByRole('option', { name: option, exact: true }).click();
  await page.keyboard.press('Escape');
}

test('a subgroup shows its items and those of its nested subgroups', async ({ page }) => {
  await mockApi(page, { body: subgroupTree }, undefined, { body: groupSubgroups });
  await page.goto('/');
  await expect(page.getByTitle('Group epic', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Subgroups' }).click();
  const menu = page.getByRole('dialog', { name: 'Subgroups' });
  await expect(menu.getByRole('option')).toHaveText(['group (outside subgroups)', 'Design', 'Operations', 'Team', 'Core']);
  await menu.getByRole('option', { name: 'Team', exact: true }).click();
  await page.keyboard.press('Escape');

  await expect(page.getByRole('button', { name: 'Subgroups: Team' })).toBeVisible();
  // The milestone holds a Team/Core issue; the epic is the group's own.
  await expect.poll(() => listedNames(page)).toEqual(['[Milestone] Sprint 1', 'Core issue', 'Team issue']);
  await expect(page).toHaveURL(/subgroup=team(&|$)/);

  // The view comes back with the URL.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Subgroups: Team' })).toBeVisible();
  await expect.poll(() => listedNames(page)).toEqual(['[Milestone] Sprint 1', 'Core issue', 'Team issue']);
});

test('the group itself lists the items outside every subgroup', async ({ page }) => {
  await mockApi(page, { body: subgroupTree }, undefined, { body: groupSubgroups });
  await page.goto('/');
  await expect(page.getByTitle('Group epic', { exact: true })).toBeVisible();

  await pick(page, 'Subgroups', 'group (outside subgroups)');
  await expect.poll(() => listedNames(page)).toEqual(['Group epic', 'Group issue']);
  await expect(page).toHaveURL(/subgroup=\.(&|$)/);
});

test('the menu lists the subgroups found on the items until /api/subgroups answers', async ({ page }) => {
  await mockApi(page, { body: subgroupTree }, undefined, { status: 502, body: { error: 'down' } });
  await page.goto('/');
  await page.getByRole('button', { name: 'Subgroups' }).click();
  await expect(page.getByRole('dialog', { name: 'Subgroups' }).getByRole('option')).toHaveText([
    'group (outside subgroups)',
    'ops',
    'team',
    'core',
  ]);
});

test('no Subgroups menu in a group without subgroups', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Labels/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Subgroups/ })).toHaveCount(0);
});
