import { describe, expect, it } from 'vitest';
import { DependencyRef, GanttTask } from '../types/gantt';
import {
  arrowPath,
  blockedMessage,
  blockedSpan,
  blockerConflicts,
  conflictMessage,
  criticalPath,
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
  it('counts the links needed to finish a row, not what it unblocks', () => {
    const data = tree();
    const index = dependencyIndex(data, false);
    const [m1, m2, copy] = data;
    expect(dependencyCount(index, m1)).toBe(3);
    expect(dependencyCount(index, m2)).toBe(0); // X only blocks C, in m1
    expect(dependencyCount(index, m1.children![0])).toBe(0); // A only blocks B
    expect(dependencyCount(index, m1.children![1])).toBe(1); // B, blocked by A
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
    const { rows, links, critical } = dependencySubgraph(index, tree()[0]);
    expect(rows.map((row) => [row.node.id, row.dependency])).toEqual([
      ['ext', { linked: true, external: true, path: undefined }],
      ['A', { linked: false, external: false, path: 'm1', critical: true }],
      ['X', { linked: true, external: false, path: 'm2' }],
      ['C', { linked: false, external: false, path: 'm1' }],
      ['B', { linked: false, external: false, path: 'm1', critical: true }],
    ]);
    // Flat rows: no chevrons in the dialog.
    expect(rows.every((row) => !row.hasChildren && !row.node.children && row.depth === 0)).toBe(true);
    expect(links).toEqual([
      { from: 'A', to: 'B', conflict: false, critical: true },
      { from: 'X', to: 'C', conflict: true }, // C starts on the 5th, X ends on the 15th
      { from: 'ext', to: 'C', conflict: true },
    ]);
    // Of the leaves (A, B and C's c1), B ends last; A holds it up.
    expect(critical).toBe(2);
  });

  it('leaves out what the row only unblocks', () => {
    const index = dependencyIndex(tree(), false);
    // X only blocks C, in m1: nothing is needed to finish m2.
    expect(dependencySubgraph(index, tree()[1])).toEqual({ rows: [], links: [], critical: 0 });
  });

  it('follows the blockers from elsewhere, their descendants and their own blockers', () => {
    // m1 holds C. X (in m2) blocks C; V blocks X; x1, child of X, is blocked by W (outside the
    // group). C blocks Z (in m2): not needed to finish m1.
    const x1 = task('x1', { blockedBy: [ref('W', { external: true })] });
    const X = task('X', { blocking: [ref('C')], blockedBy: [ref('V')], children: [x1] });
    const V = task('V', { blocking: [ref('X')] });
    const Z = task('Z', { blockedBy: [ref('C')] });
    const C = task('C', { blockedBy: [ref('X')], blocking: [ref('Z')] });
    const data = [task('m1', { type: 'milestone', children: [C] }), task('m2', { type: 'milestone', children: [X, V, Z] })];
    const index = dependencyIndex(data, false);
    const { rows, links } = dependencySubgraph(index, data[0]);
    expect(rows.map((row) => row.node.id).sort()).toEqual(['C', 'V', 'W', 'X', 'x1']);
    expect(links.filter((link) => !link.derived).map((link) => `${link.from} ${link.to}`)).toEqual(['X C', 'V X', 'W x1']);
    // The critical path, on the leaves: W → x1, then x1 → C through X → C (dashed).
    expect(links.filter((link) => link.critical)).toEqual([
      { from: 'W', to: 'x1', conflict: true, critical: true }, // same dates: each starts before its blocker ends
      { from: 'x1', to: 'C', conflict: true, critical: true, derived: true },
    ]);
    expect(rows.find((row) => row.node.id === 'C')?.dependency?.criticalVia).toBe('after x1 (through X → C)');
    expect(rows.find((row) => row.node.id === 'x1')?.dependency).toMatchObject({ linked: true, path: 'm2 › X' });
    expect(dependencyCount(index, data[0])).toBe(3);
  });

  it('shows the items of the subtree under their parents, those from elsewhere at the top level', () => {
    // m › cap › f1 (u1, u2), f2 (u3): u1 blocks u3, ext (outside the group) blocks u1.
    const u1 = task('u1', { start: '2026-10-01', blockedBy: [ref('ext', { external: true })], blocking: [ref('u3')] });
    const u3 = task('u3', { start: '2026-10-10', blockedBy: [ref('u1')] });
    const f1 = task('f1', { type: 'epic', children: [u1, task('u2')] });
    const f2 = task('f2', { type: 'epic', children: [u3] });
    const cap = task('cap', { type: 'epic', children: [f2, f1] });
    const m = task('m', { type: 'milestone', children: [cap] });
    const index = dependencyIndex([m], false);
    const { rows, critical } = dependencySubgraph(index, m);
    expect(rows.map((row) => [row.node.id, row.depth, !!row.dependency?.context, row.parent?.id])).toEqual([
      ['ext', 0, false, undefined],
      ['cap', 0, true, undefined],
      ['f1', 1, true, 'cap'], // holds u1, which comes before u3
      ['u1', 2, false, 'f1'],
      ['f2', 1, true, 'cap'],
      ['u3', 2, false, 'f2'],
    ]);
    expect(rows.find((row) => row.node.id === 'u1')).toMatchObject({ guides: [true], isLast: true });
    expect(rows.find((row) => row.node.id === 'cap')?.hasChildren).toBe(true);
    expect(critical).toBe(3); // ext → u1 → u3
    // From f2: u3 is its own child, no context row; u1 and its blocker come from elsewhere.
    expect(dependencySubgraph(index, f2).rows.map((row) => [row.node.id, row.depth, row.dependency?.linked])).toEqual([
      ['ext', 0, true],
      ['u1', 0, true],
      ['u3', 0, false],
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

describe('criticalPath', () => {
  const ids = (index: ReturnType<typeof dependencyIndex>, root: GanttTask) => criticalPath(index, root).ids;

  it('ends at the leaf that ends last, even when nothing blocks it', () => {
    const b = task('b', { end: '2026-10-20', blockedBy: [ref('c')] });
    const m = task('m', { type: 'milestone', children: [task('a', { end: '2026-10-30' }), b] });
    const index = dependencyIndex([m, task('c', { end: '2026-10-12' })], false);
    expect(criticalPath(index, m)).toEqual({ ids: ['a'], steps: [] });
  });

  it('goes from user story to user story, through the blocked and blocking epics', () => {
    // Milestone 1 › Capability 2 › Feature 2 (US 1), Feature 1 (US 6, US 7); Milestone 2 ›
    // Capability 1 › Feature 4 (US 9, US 10), feature 3 (US 4, without due date).
    const us = (id: string, start: string, end: string, blockedBy: string[] = [], fields: Partial<GanttTask> = {}) =>
      task(id, { start, end, blockedBy: blockedBy.map((blocker) => ref(blocker)), ...fields });
    const f1 = task('F1', {
      type: 'epic',
      blockedBy: [ref('F2'), ref('F4')],
      children: [us('US6', '2026-10-05', '2026-10-16', ['US1', 'US4']), us('US7', '2026-10-12', '2026-11-06', ['US1', 'US6', 'US10'])],
    });
    const f2 = task('F2', { type: 'epic', children: [us('US1', '2026-09-14', '2026-10-09')] });
    const m1 = task('M1', { type: 'milestone', children: [task('CAP2', { type: 'epic', children: [f2, f1] })] });
    const f4 = task('F4', { type: 'epic', end: '2026-10-20', children: [us('US9', '2026-09-15', '2026-10-02'), us('US10', '2026-09-28', '2026-10-14', ['US9'])] });
    const f3 = task('F3', { type: 'epic', children: [us('US4', '2026-10-02', '2026-10-03', [], { noDueDate: true })] });
    const m2 = task('M2', { type: 'milestone', children: [task('CAP1', { type: 'epic', children: [f4, f3] })] });
    const index = dependencyIndex([m1, m2], false);
    const path = criticalPath(index, m1);
    // US 7 ends last. US 6 (10/16) ends after US 10 (10/14); US 10 holds US 6 up through
    // Feature 4 → Feature 1 (F4's own dates don't count, its user stories do).
    expect(path.ids).toEqual(['US9', 'US10', 'US6', 'US7']);
    expect(path.steps.map((step) => [step.from, step.to, step.direct, `${step.edge.blocker} ${step.edge.blocked}`])).toEqual([
      ['US9', 'US10', true, 'US9 US10'],
      ['US10', 'US6', false, 'F4 F1'],
      ['US6', 'US7', true, 'US6 US7'],
    ]);
  });

  it("prefers the leaf's own links in a tie and skips closed and undated leaves", () => {
    const leaf = task('L', {
      end: '2026-10-30',
      blockedBy: [ref('a'), ref('c', { closed: true }), ref('d')],
    });
    const epic = task('E', { type: 'epic', blockedBy: [ref('b')], children: [leaf] });
    const others = [
      task('a', { end: '2026-10-15' }),
      task('b', { end: '2026-10-15' }),
      task('c', { end: '2026-10-25', closed: true }),
      task('d', { end: '2026-10-28', noDueDate: true }),
    ];
    const index = dependencyIndex([epic, ...others], true);
    expect(ids(index, epic)).toEqual(['a', 'L']);
  });

  it('is empty without open leaves and survives a cycle', () => {
    const done = task('m', { type: 'milestone', children: [task('x', { closed: true })] });
    expect(ids(dependencyIndex([done], true), done)).toEqual([]);
    const a = task('a', { end: '2026-10-10', blockedBy: [ref('b')] });
    const b = task('b', { end: '2026-10-12', blockedBy: [ref('a')] });
    const m = task('m', { type: 'milestone', children: [a, b] });
    expect(ids(dependencyIndex([m], false), m)).toEqual(['a', 'b']);
  });
});

describe('arrowPath', () => {
  const ROW = 40;
  const mid = (index: number) => index * ROW + ROW / 2;

  it('goes straight across when there is room between the bars', () => {
    expect(arrowPath(100, mid(0), 150, mid(2), ROW)).toBe('M100,20 H110 V100 H150');
  });

  it('goes round in a lane of the target row, off its bar', () => {
    // Down: under the target row's top (its bar starts 8 px down).
    expect(arrowPath(200, mid(0), 150, mid(2), ROW)).toBe('M200,20 h10 V84 H140 V100 H150');
    // Up: over its bottom.
    expect(arrowPath(200, mid(3), 150, mid(1), ROW)).toBe('M200,140 h10 V76 H140 V60 H150');
  });

  it('keeps apart two targets starting together in adjacent rows', () => {
    // One reached from below (row 4), the other from above (row 5): no shared segment.
    const intoFour = arrowPath(300, mid(7), 150, mid(4), ROW);
    const intoFive = arrowPath(250, mid(2), 150, mid(5), ROW);
    expect(intoFour).toBe('M300,300 h10 V196 H140 V180 H150');
    expect(intoFive).toBe('M250,100 h10 V204 H140 V220 H150');
  });
});
