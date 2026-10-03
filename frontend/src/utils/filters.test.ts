import { describe, expect, it } from 'vitest';
import { attentionIndex } from './attention';
import { applyFilters, canonicalId, DEFAULT_FILTERS, Filters, fullId, hasFilters, isFiltering, itemOptions, normalizeText, shortId } from './filters';
import { task } from './testing';

// Shaped like the backend output: a milestone holding the `_ms_` copy of an issue, an epic
// holding the original and a nested epic, and the nested epic's `_root_` copy.
const tree = [
  task('M1', { type: 'milestone', name: '[Milestone] Sprint 1', children: [task('I1_ms_I1', { name: 'Webhooks', health: 'needsAttention' })] }),
  task('E1', {
    type: 'epic',
    name: 'Payments',
    health: 'onTrack',
    labels: [{ title: 'team-a', color: '#f0ad4e' }],
    children: [
      task('I1', { name: 'Webhooks', health: 'needsAttention' }),
      task('I2', { name: 'Refund API', health: 'atRisk', labels: [{ title: 'backend', color: '#428bca' }] }),
      task('I3', { name: 'Old risk', health: 'atRisk', closed: true }),
      task('E2', { type: 'epic', name: 'Élan', children: [task('I4', { name: 'Deep issue' })] }),
    ],
  }),
  task('E2_root_E2', { type: 'epic', name: 'Élan', children: [task('I4_root_E2', { name: 'Deep issue' })] }),
];

const filter = (fields: Partial<Filters>) => applyFilters(tree, { ...DEFAULT_FILTERS, ...fields }).map((node) => node.id);

describe('applyFilters', () => {
  it('returns the tree itself without filters', () => {
    expect(isFiltering(DEFAULT_FILTERS)).toBe(false);
    expect(applyFilters(tree, DEFAULT_FILTERS)).toBe(tree);
  });

  it('lists milestones, epics then issues flat, each issue once with a _top copy', () => {
    expect(filter({ types: ['issue'] })).toEqual(['I1_ms_I1_top', 'I2_top', 'I3_top', 'I4_top']);
    expect(filter({ types: ['epic'] })).toEqual(['E1', 'E2_root_E2']);
  });

  it('filters by health status: own status for items, open items for milestones', () => {
    expect(filter({ health: ['atRisk'] })).toEqual(['I2_top', 'I3_top']);
    expect(filter({ health: ['needsAttention'] })).toEqual(['M1', 'I1_ms_I1_top']);
    expect(filter({ health: ['onTrack'] })).toEqual(['E1']);
    // A milestone doesn't match through a closed item.
    const closedOnly = [task('M2', { type: 'milestone', children: [task('X', { health: 'atRisk', closed: true })] })];
    expect(applyFilters(closedOnly, { ...DEFAULT_FILTERS, health: ['atRisk'] }).map((n) => n.id)).toEqual(['X_top']);
  });

  it('ANDs the health status with the types, labels and search', () => {
    expect(filter({ health: ['atRisk', 'needsAttention'], types: ['issue'] })).toEqual(['I1_ms_I1_top', 'I2_top', 'I3_top']);
    expect(filter({ health: ['atRisk'], labels: ['backend'] })).toEqual(['I2_top']);
    expect(filter({ health: ['atRisk'], search: 'refund' })).toEqual(['I2_top']);
  });

  it('keeps the whole content of a listed item', () => {
    const [epic] = applyFilters(tree, { ...DEFAULT_FILTERS, labels: ['team-a'] });
    expect(epic.children?.map((child) => child.id)).toEqual(['I1', 'I2', 'I3', 'E2']);
  });

  it('searches ignoring case and accents', () => {
    expect(normalizeText('Élan')).toBe('elan');
    expect(filter({ search: 'ELAN', types: ['epic'] })).toEqual(['E2_root_E2']);
  });
});

describe('canonicalId', () => {
  it('strips the copy suffixes of the backend', () => {
    expect(canonicalId('gid://gitlab/WorkItem/42_ms_42')).toBe('gid://gitlab/WorkItem/42');
    expect(canonicalId('gid://gitlab/WorkItem/43_root_40')).toBe('gid://gitlab/WorkItem/43');
    expect(canonicalId('gid://gitlab/WorkItem/42')).toBe('gid://gitlab/WorkItem/42');
  });
});

describe('applyFilters: blocked', () => {
  const ref = (id: string, closed = false) => ({ id, name: id, start: '2026-10-01', end: '2026-10-10', closed });
  const blockedTree = [
    task('M', { type: 'milestone', children: [task('A', { blockedBy: [ref('B')] })] }),
    task('E', { type: 'epic', blockedBy: [ref('X', true)], children: [task('B', { blocking: [ref('A')] })] }),
  ];

  it('lists the items with an open blocker', () => {
    expect(isFiltering({ ...DEFAULT_FILTERS, blocked: true })).toBe(true);
    expect(applyFilters(blockedTree, { ...DEFAULT_FILTERS, blocked: true }).map((node) => node.id)).toEqual(['A_top']);
  });
});

describe('shortId / fullId', () => {
  it('shortens milestone and work item IDs, copies included, and back', () => {
    expect(shortId('gid://gitlab/Milestone/123')).toBe('m123');
    expect(shortId('gid://gitlab/WorkItem/456_root_gid://gitlab/WorkItem/9')).toBe('w456');
    expect(fullId('m123')).toBe('gid://gitlab/Milestone/123');
    expect(fullId('w456')).toBe('gid://gitlab/WorkItem/456');
  });

  it('refuses anything else', () => {
    expect(shortId('gid://gitlab/Group/1')).toBeUndefined();
    expect(shortId('E1')).toBeUndefined();
    expect(fullId('x1')).toBeUndefined();
    expect(fullId('m12a')).toBeUndefined();
  });
});

describe('items (portfolios)', () => {
  // Like the backend: milestone M1 holds epic E2's `_ms_` copy; E2 is under E1, so its
  // top-level row is the `_root_` copy.
  const W = (n: number) => `gid://gitlab/WorkItem/${n}`;
  const M = (n: number) => `gid://gitlab/Milestone/${n}`;
  const items = [
    task(M(1), { type: 'milestone', name: 'Release', children: [task(`${W(2)}_ms_${W(2)}`, { type: 'epic', name: 'Search' })] }),
    task(M(2), { type: 'milestone', name: 'Later' }),
    task(W(1), { type: 'epic', name: 'Payments', children: [task(W(2), { type: 'epic', name: 'Search', children: [task(W(3), { name: 'Index' })] })] }),
    task(`${W(2)}_root_${W(2)}`, { type: 'epic', name: 'Search', children: [task(`${W(3)}_root_${W(2)}`, { name: 'Index' })] }),
  ];
  const pick = (fields: Partial<Filters>) => applyFilters(items, { ...DEFAULT_FILTERS, ...fields }).map((node) => node.id);

  it('keeps the top-level rows of the picked milestones then epics, as a tree', () => {
    const shown = applyFilters(items, { ...DEFAULT_FILTERS, items: ['w2', 'm1', 'm99'] });
    expect(shown.map((node) => node.id)).toEqual([M(1), `${W(2)}_root_${W(2)}`]);
    expect(shown[1]).toBe(items[3]); // unchanged: expanded rows survive
    expect(hasFilters({ ...DEFAULT_FILTERS, items: ['m1'] })).toBe(true);
    expect(isFiltering({ ...DEFAULT_FILTERS, items: ['m1'] })).toBe(false);
  });

  it('applies the other filters inside the picked items, flat', () => {
    expect(pick({ items: ['w2'], types: ['issue'] })).toEqual([`${W(3)}_root_${W(2)}_top`]);
    expect(pick({ items: ['m2'], search: 'search' })).toEqual([]);
  });

  it('offers the milestones and epics of the tree', () => {
    expect(itemOptions(items)).toEqual([
      { value: 'm1', label: 'Release', section: 'Milestones' },
      { value: 'm2', label: 'Later', section: 'Milestones' },
      { value: 'w1', label: 'Payments', section: 'Epics' },
      { value: 'w2', label: 'Search', section: 'Epics' },
    ]);
  });

  it('filters by what needs attention, through the index', () => {
    const late = task(W(5), { type: 'epic', name: 'Late', progress: 0, linearProgress: 50, children: [task(W(6))] });
    const tree = [late, task(W(7), { name: 'Fine' })];
    const index = attentionIndex(tree);
    expect(applyFilters(tree, { ...DEFAULT_FILTERS, attention: ['late'] }, index).map((node) => node.id)).toEqual([W(5)]);
    expect(applyFilters(tree, { ...DEFAULT_FILTERS, attention: ['noDates'] }, index)).toEqual([]);
  });
});
