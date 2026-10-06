import { describe, expect, it } from 'vitest';
import { attentionIndex } from './attention';
import { applyFilters, canonicalId, DEFAULT_FILTERS, Filters, isFiltering, MAIN_GROUP, normalizeText, subgroupOptions } from './filters';
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

describe('applyFilters: attention', () => {
  it('filters by what needs attention, through the index', () => {
    const late = task('E5', { type: 'epic', name: 'Late', progress: 0, linearProgress: 50, children: [task('I6')] });
    const tree = [late, task('I7', { name: 'Fine' })];
    const index = attentionIndex(tree);
    expect(isFiltering({ ...DEFAULT_FILTERS, attention: ['late'] })).toBe(true);
    expect(applyFilters(tree, { ...DEFAULT_FILTERS, attention: ['late'] }, index).map((node) => node.id)).toEqual(['E5']);
    expect(applyFilters(tree, { ...DEFAULT_FILTERS, attention: ['noDates'] }, index)).toEqual([]);
  });
});

describe('subgroups', () => {
  // Epic E1 in the group itself; its issues in team, team/core and team-b; the milestone holds
  // a copy of the team/core issue.
  const subTree = [
    task('M1', { type: 'milestone', children: [task('I2_ms_I2', { subgroup: 'team/core' })] }),
    task('M2', { type: 'milestone', children: [task('I4_ms_I4')] }),
    task('E1', {
      type: 'epic',
      children: [
        task('I1', { subgroup: 'team' }),
        task('I2', { subgroup: 'team/core' }),
        task('I3', { subgroup: 'team-b', labels: [{ title: 'bug', color: '#f00' }] }),
        task('I4'),
      ],
    }),
  ];
  const ids = (fields: Partial<Filters>) => applyFilters(subTree, { ...DEFAULT_FILTERS, ...fields }).map((node) => node.id);

  it('includes the nested subgroups of a subgroup, not its namesakes', () => {
    expect(isFiltering({ ...DEFAULT_FILTERS, subgroups: ['team'] })).toBe(true);
    expect(ids({ subgroups: ['team'] })).toEqual(['M1', 'I2_ms_I2_top', 'I1_top']);
    expect(ids({ subgroups: ['team/core'], types: ['issue'] })).toEqual(['I2_ms_I2_top']);
  });

  it('lists the items outside every subgroup for the main group', () => {
    expect(ids({ subgroups: [MAIN_GROUP] })).toEqual(['M2', 'E1', 'I4_ms_I4_top']);
  });

  it('matches any of the subgroups, ANDed with the other filters', () => {
    expect(ids({ subgroups: ['team-b', 'team/core'], types: ['issue'] })).toEqual(['I2_ms_I2_top', 'I3_top']);
    expect(ids({ subgroups: ['team-b', 'team/core'], labels: ['bug'] })).toEqual(['I3_top']);
  });
});

describe('subgroupOptions', () => {
  const items = [task('E1', { type: 'epic', children: [task('I1', { subgroup: 'team/core/api' }), task('I2', { subgroup: 'ops' })] })];

  it('starts with the group itself, then the subgroups in tree order, indented', () => {
    const options = subgroupOptions('org/product', [
      { path: 'team', name: 'Team' },
      { path: 'team-b', name: 'Team B' },
      { path: 'team/core', name: 'Core' },
    ], []);
    expect(options.map((o) => [o.value, o.label, o.depth, o.context])).toEqual([
      [MAIN_GROUP, 'product (outside subgroups)', undefined, undefined],
      ['team', 'Team', 1, undefined],
      ['team/core', 'Core', 2, 'team'],
      ['team-b', 'Team B', 1, undefined],
    ]);
  });

  it('falls back on the subgroups of the items and their parents', () => {
    expect(subgroupOptions('org/product', [{ path: 'team', name: 'Team' }], items).map((o) => [o.value, o.label])).toEqual([
      [MAIN_GROUP, 'product (outside subgroups)'],
      ['ops', 'ops'],
      ['team', 'Team'],
      ['team/core', 'core'],
      ['team/core/api', 'api'],
    ]);
  });

  it('has no options without subgroups', () => {
    expect(subgroupOptions('org/product', [], [task('I1')])).toEqual([]);
  });
});
