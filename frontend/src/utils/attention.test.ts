import { describe, expect, it } from 'vitest';
import { DependencyRef } from '../types/gantt';
import { attentionFlags, attentionIndex } from './attention';
import { task } from './testing';

const blocker = (fields: Partial<DependencyRef> = {}): DependencyRef => ({ id: 'B', name: 'B', start: '2026-09-01', end: '2026-10-05', ...fields });
const ids = (index: ReturnType<typeof attentionIndex>) =>
  Object.fromEntries([...index].filter(([, set]) => set.size > 0).map(([flag, set]) => [flag, [...set].sort()]));

describe('attentionFlags', () => {
  it('gives groups a schedule flag, as in the chart', () => {
    const group = (progress: number, linearProgress: number) => task('G', { type: 'epic', progress, linearProgress, children: [task('c')] });
    expect(attentionFlags(group(0, 50), undefined)).toEqual(['late']);
    expect(attentionFlags(group(46, 50), undefined)).toEqual(['behind']);
    expect(attentionFlags(group(50, 50), undefined)).toEqual([]);
    // A leaf behind its linear progress has no schedule status.
    expect(attentionFlags(task('L', { progress: 0, linearProgress: 90 }), undefined)).toEqual([]);
    // Nor a group whose dates are made up, or without children.
    expect(attentionFlags(task('U', { type: 'milestone', linearProgress: 90, noDueDate: true }), undefined)).toEqual(['noDates']);
    expect(attentionFlags(task('E', { type: 'milestone', linearProgress: 90, noChildren: true }), undefined)).toEqual(['noChildren']);
  });

  it('flags health, blockers, conflicts and overruns', () => {
    const parent = task('P', { end: '2026-10-05' });
    const node = task('N', {
      health: 'atRisk',
      start: '2026-10-01',
      end: '2026-10-10',
      blockedBy: [blocker()],
    });
    expect(attentionFlags(node, parent)).toEqual(['atRisk', 'blocked', 'conflict', 'pastParent']);
    expect(attentionFlags(task('H', { health: 'needsAttention' }), undefined)).toEqual(['needsAttention']);
    // A closed blocker neither blocks nor conflicts.
    expect(attentionFlags(task('C', { blockedBy: [blocker({ closed: true })] }), undefined)).toEqual([]);
  });

  it('never flags closed items', () => {
    expect(attentionFlags(task('X', { closed: true, health: 'atRisk', noStartDate: true }), undefined)).toEqual([]);
  });
});

describe('attentionIndex', () => {
  it('counts each item once across its copies, past its parent through any placement', () => {
    // I1 sits under E1 (ends in time) and, as a copy, under M1 (ends before it).
    const I1 = (id: string) => task(id, { end: '2026-10-10', health: 'needsAttention' });
    const tree = [
      task('M1', { type: 'milestone', end: '2026-10-05', progress: 100, linearProgress: 50, children: [I1('I1_ms_M1')] }),
      task('E1', { type: 'epic', end: '2026-10-20', progress: 100, linearProgress: 50, children: [I1('I1')] }),
      task('I2', { noStartDate: true }),
    ];
    expect(ids(attentionIndex(tree))).toEqual({
      needsAttention: ['I1'],
      pastParent: ['I1'],
      noDates: ['I2'],
    });
  });
});
