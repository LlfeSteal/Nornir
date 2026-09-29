import { describe, expect, it } from 'vitest';
import { overrun, overrunMessage } from './overrun';
import { task } from './testing';

const parent = task('parent', { type: 'epic', name: 'Payments', start: '2026-10-01', end: '2026-10-04' });

describe('overrun', () => {
  it('spans from the parent end to the child end: one day late, one day', () => {
    // The example agreed with the user: parent days 1 → 4, child days 2 → 5.
    const child = task('child', { start: '2026-10-02', end: '2026-10-05' });
    const value = overrun(child, parent)!;
    expect(value.days).toBe(1);
    expect(value.from).toEqual(new Date(2026, 9, 4));
    expect(value.to).toEqual(new Date(2026, 9, 5));
    expect(overrunMessage(value, parent)).toBe('Ends 1 day after Payments');
  });

  it('counts several days, and whole days across a daylight saving change', () => {
    const child = task('child', { end: '2026-11-03' }); // DST ends on Oct 25 in Europe
    const value = overrun(child, parent)!;
    expect(value.days).toBe(30);
    expect(overrunMessage(value, parent)).toBe('Ends 30 days after Payments');
  });

  it('ignores a child ending with or before its parent', () => {
    expect(overrun(task('same', { end: '2026-10-04' }), parent)).toBeUndefined();
    expect(overrun(task('inside', { start: '2026-10-02', end: '2026-10-03' }), parent)).toBeUndefined();
  });

  it('ignores a child starting before its parent: only the end counts', () => {
    expect(overrun(task('early', { start: '2026-09-20', end: '2026-10-03' }), parent)).toBeUndefined();
  });

  it('ignores top-level rows, closed rows and made-up due dates', () => {
    const late = { start: '2026-10-02', end: '2026-10-08' };
    expect(overrun(task('top', late), undefined)).toBeUndefined();
    expect(overrun(task('closed', { ...late, closed: true }), parent)).toBeUndefined();
    expect(overrun(task('undated', { ...late, noDueDate: true }), parent)).toBeUndefined();
    expect(overrun(task('child', late), { ...parent, noDueDate: true })).toBeUndefined();
    // A made-up start date doesn't matter: the due date is real.
    expect(overrun(task('noStart', { ...late, noStartDate: true }), parent)?.days).toBe(4);
  });

  it('judges an item against its milestone like against an epic', () => {
    const milestone = task('ms', { type: 'milestone', name: '[Milestone] Sprint 1', end: '2026-10-16' });
    const value = overrun(task('issue', { end: '2026-10-18' }), milestone)!;
    expect(overrunMessage(value, milestone)).toBe('Ends 2 days after [Milestone] Sprint 1');
  });
});
