import { describe, expect, it } from 'vitest';
import { applyFilters, canonicalId, DEFAULT_FILTERS, Filters, isFiltering, normalizeText } from './filters';
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
