import { describe, expect, it } from 'vitest';
import { DependencyRef, GanttTask } from '../types/gantt';
import {
  blockedMessage,
  blockedSpan,
  blockerConflicts,
  conflictMessage,
  dependencyCount,
  dependencyIndex,
  dependencySubgraph,
  gitlabId,
  openBlockers,
} from './dependencies';
import { task } from './testing';
import { parseDay } from './timeline';

const ref = (id: string, fields: Partial<DependencyRef> = {}): DependencyRef => ({
  id,
  name: id,
  start: '2026-10-01',
  end: '2026-10-10',
  ...fields,
});

// Milestone 1.0: epics A → B (A blocks B) and C, blocked by X of milestone 2.0 and by an item
// outside the group. Every link is on both of its ends, as the backend sends it.
function tree(): GanttTask[] {
  const A = task('A', { type: 'epic', start: '2026-10-01', end: '2026-10-10', blocking: [ref('B')] });
  const B = task('B', { type: 'epic', start: '2026-10-12', end: '2026-10-20', blockedBy: [ref('A')] });
  const C = task('C', {
    type: 'epic',
    start: '2026-10-05',
    end: '2026-10-30',
    blockedBy: [ref('X', { end: '2026-10-15' }), ref('ext', { external: true, end: '2026-10-08' })],
    children: [task('c1')],
  });
  const X = task('X', { type: 'epic', start: '2026-10-01', end: '2026-10-15', blocking: [ref('C')] });
  return [
    task('m1', { type: 'milestone', children: [A, B, C] }),
    task('m2', { type: 'milestone', children: [X] }),
    // Top-level copies of the epics, as the backend lists them.
    { ...C, id: 'C_root_C', children: [task('c1_root_C')] },
  ];
}

describe('gitlabId', () => {
  it('strips the suffixes of the copies', () => {
    expect(gitlabId('gid://gitlab/WorkItem/1_ms_2')).toBe('gid://gitlab/WorkItem/1');
    expect(gitlabId('gid://gitlab/WorkItem/1_root_2')).toBe('gid://gitlab/WorkItem/1');
    expect(gitlabId('gid://gitlab/WorkItem/1_root_2_top')).toBe('gid://gitlab/WorkItem/1');
    expect(gitlabId('gid://gitlab/WorkItem/1')).toBe('gid://gitlab/WorkItem/1');
  });
});

describe('openBlockers / blockedMessage', () => {
  it('lists the open blockers only', () => {
    const node = task('n', { blockedBy: [ref('a', { closed: true }), ref('b'), ref('c'), ref('d'), ref('e')] });
    expect(openBlockers(node).map((r) => r.id)).toEqual(['b', 'c', 'd', 'e']);
    expect(blockedMessage(node)).toBe('Blocked by b, c, d and 1 more');
    expect(blockedMessage(task('n', { blockedBy: [ref('a', { closed: true })] }))).toBeUndefined();
    expect(blockedMessage(task('n'))).toBeUndefined();
  });
});

describe('blockerConflicts', () => {
  it('flags open blockers ending after the row starts', () => {
    const node = task('n', { start: '2026-10-05', blockedBy: [ref('late', { end: '2026-10-08' }), ref('done', { end: '2026-10-05' })] });
    const conflicts = blockerConflicts(node);
    expect(conflicts.map((c) => [c.blocker.id, c.days])).toEqual([['late', 3]]);
    expect(conflictMessage(conflicts[0])).toBe('Starts 3 days before late ends');
    expect(conflictMessage({ blocker: ref('x'), days: 1 })).toBe('Starts 1 day before x ends');
  });

  it('counts days across a daylight saving change', () => {
    // Europe/Paris goes back to winter time on 2026-10-25.
    const node = task('n', { start: '2026-10-20', blockedBy: [ref('b', { end: '2026-10-30' })] });
    expect(blockerConflicts(node)[0].days).toBe(10);
  });

  it('ignores closed items and made-up dates', () => {
    const blocker = ref('b', { end: '2026-10-08' });
    expect(blockerConflicts(task('n', { start: '2026-10-05', closed: true, blockedBy: [blocker] }))).toEqual([]);
    expect(blockerConflicts(task('n', { start: '2026-10-05', noStartDate: true, blockedBy: [blocker] }))).toEqual([]);
    expect(blockerConflicts(task('n', { start: '2026-10-05', blockedBy: [{ ...blocker, closed: true }] }))).toEqual([]);
    expect(blockerConflicts(task('n', { start: '2026-10-05', blockedBy: [{ ...blocker, noDueDate: true }] }))).toEqual([]);
  });
});

describe('blockedSpan', () => {
  const day = (iso: string) => parseDay(iso).getTime();

  it('runs from the row start to the latest end of its conflicting blockers', () => {
    const node = task('n', {
      start: '2026-10-05',
      end: '2026-10-20',
      blockedBy: [ref('a', { end: '2026-10-08' }), ref('b', { end: '2026-10-12' }), ref('c', { end: '2026-10-30', closed: true })],
    });
    const span = blockedSpan(node)!;
    expect([span.from.getTime(), span.to.getTime()]).toEqual([day('2026-10-05'), day('2026-10-12')]);
  });

  it("stops at the row's own end", () => {
    const node = task('n', { start: '2026-10-05', end: '2026-10-07', blockedBy: [ref('a', { end: '2026-10-12' })] });
    expect(blockedSpan(node)!.to.getTime()).toBe(day('2026-10-07'));
  });

  it('is undefined without a conflict', () => {
    expect(blockedSpan(task('n', { start: '2026-10-05', end: '2026-10-20' }))).toBeUndefined();
    expect(blockedSpan(task('n', { start: '2026-10-05', end: '2026-10-20', blockedBy: [ref('a', { end: '2026-10-05' })] }))).toBeUndefined();
    expect(blockedSpan(task('n', { start: '2026-10-05', end: '2026-10-20', closed: true, blockedBy: [ref('a', { end: '2026-10-12' })] }))).toBeUndefined();
  });
});

describe('dependencyIndex', () => {
  it('finds every link once, from either end', () => {
    const index = dependencyIndex(tree(), false);
    expect(index.edges).toEqual([
      { blocker: 'A', blocked: 'B' },
      { blocker: 'X', blocked: 'C' },
      { blocker: 'ext', blocked: 'C' },
    ]);
    expect(index.paths.get('C')).toBe('m1');
    expect(index.externals.has('ext')).toBe(true);
  });

  it('drops links to items that are not shown', () => {
    // A closed blocker hidden with the closed items is not in the tree.
    const hidden = [task('n', { blockedBy: [ref('gone', { closed: true })] })];
    expect(dependencyIndex(hidden, false).edges).toEqual([]);
    const external = [task('n', { blockedBy: [ref('ext', { closed: true, external: true })] })];
    expect(dependencyIndex(external, false).edges).toEqual([]);
    expect(dependencyIndex(external, true).edges).toEqual([{ blocker: 'ext', blocked: 'n' }]);
  });
});

describe('dependencyCount', () => {
  it('counts the links of a row and its descendants', () => {
    const data = tree();
    const index = dependencyIndex(data, false);
    const [m1, m2, copy] = data;
    expect(dependencyCount(index, m1)).toBe(3);
    expect(dependencyCount(index, m2)).toBe(1);
    expect(dependencyCount(index, m1.children![0])).toBe(1); // A
    expect(dependencyCount(index, copy)).toBe(2); // C, from its copy
    expect(dependencyCount(index, m1.children![2].children![0])).toBe(0); // c1
  });

  it('counts from the whole item, whatever the period or the filters cut', () => {
    const data = tree();
    const index = dependencyIndex(data, false);
    const cut = { ...data[0], children: [] }; // m1 with its children filtered out
    expect(dependencyCount(index, cut)).toBe(3);
    expect(dependencyCount(index, { ...data[2], id: 'C_root_C_top' })).toBe(2);
  });
});

describe('dependencySubgraph', () => {
  it('lists the items of a milestone and their blockers from elsewhere, blockers first', () => {
    const index = dependencyIndex(tree(), false);
    const { rows, links } = dependencySubgraph(index, tree()[0]);
    expect(rows.map((row) => [row.node.id, row.dependency])).toEqual([
      ['ext', { linked: true, external: true, path: undefined }],
      ['A', { linked: false, external: false, path: 'm1' }],
      ['X', { linked: true, external: false, path: 'm2' }],
      ['C', { linked: false, external: false, path: 'm1' }],
      ['B', { linked: false, external: false, path: 'm1' }],
    ]);
    // Flat rows: no chevrons in the dialog.
    expect(rows.every((row) => !row.hasChildren && !row.node.children && row.depth === 0)).toBe(true);
    expect(links).toEqual([
      { from: 'A', to: 'B', conflict: false },
      { from: 'X', to: 'C', conflict: true }, // C starts on the 5th, X ends on the 15th
      { from: 'ext', to: 'C', conflict: true },
    ]);
  });

  it("shows an epic's own links, the other end linked", () => {
    const index = dependencyIndex(tree(), false);
    const { rows } = dependencySubgraph(index, tree()[1]); // m2
    expect(rows.map((row) => [row.node.id, row.dependency?.linked])).toEqual([
      ['X', false],
      ['C', true],
    ]);
  });

  it('survives a cycle', () => {
    const a = task('a', { start: '2026-10-02', blockedBy: [ref('b')] });
    const b = task('b', { start: '2026-10-01', blockedBy: [ref('a')] });
    const root = task('m', { type: 'milestone', children: [a, b] });
    const index = dependencyIndex([root], false);
    const { rows, links } = dependencySubgraph(index, root);
    expect(rows.map((row) => row.node.id)).toEqual(['b', 'a']);
    expect(links).toHaveLength(2);
  });
});
