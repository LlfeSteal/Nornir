import { describe, expect, it } from 'vitest';
import { visibleRows, withoutClosed } from './flatten';
import { task } from './testing';

const tree = [
  task('M1', { type: 'milestone', children: [task('I1_ms_I1')] }),
  task('E1', {
    type: 'epic',
    children: [task('I1'), task('E2', { type: 'epic', children: [task('I3')] }), task('I2', { closed: true })],
  }),
];

describe('visibleRows', () => {
  it('only descends into expanded rows', () => {
    expect(visibleRows(tree, new Set()).map((row) => row.node.id)).toEqual(['M1', 'E1']);
    expect(visibleRows(tree, new Set(['E1'])).map((row) => row.node.id)).toEqual(['M1', 'E1', 'I1', 'E2', 'I2']);
  });

  it('marks the last child of each parent and the tree lines to draw', () => {
    const rows = visibleRows(tree, new Set(['E1', 'E2']));
    const byId = Object.fromEntries(rows.map((row) => [row.node.id, row]));
    expect(byId.I2.isLast).toBe(true);
    expect(byId.E2.isLast).toBe(false);
    expect(byId.I3.guides).toEqual([true]); // E2 has a sibling after it
  });
});

describe('withoutClosed', () => {
  it('drops closed items with their subtree', () => {
    const closedEpic = [task('E', { type: 'epic', closed: true, children: [task('open')] }), task('keep')];
    expect(withoutClosed(closedEpic).map((node) => node.id)).toEqual(['keep']);
    expect(withoutClosed(tree)[1].children?.map((node) => node.id)).toEqual(['I1', 'E2']);
  });
});
