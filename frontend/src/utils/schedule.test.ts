import { describe, expect, it } from 'vitest';
import { missingDatesMessage, noChildrenMessage, rowWarnings, SCHEDULE_THRESHOLD, scheduleLabel, scheduleStatus } from './schedule';

describe('scheduleStatus', () => {
  it('is on track at or above the expected progress', () => {
    expect(scheduleStatus(50, 50)).toBe('on-track');
    expect(scheduleStatus(80, 20)).toBe('on-track');
  });

  it(`is at risk up to ${SCHEDULE_THRESHOLD} points behind, late beyond`, () => {
    expect(scheduleStatus(77, 80)).toBe('at-risk');
    expect(scheduleStatus(75, 80)).toBe('at-risk');
    expect(scheduleStatus(74.9, 80)).toBe('late');
  });

  it('ignores float noise', () => {
    expect(scheduleStatus(100 / 3, 33.33333333334)).toBe('on-track');
  });
});

describe('scheduleLabel', () => {
  it('says how far ahead or behind', () => {
    expect(scheduleLabel(50, 80)).toBe('30% behind');
    expect(scheduleLabel(80, 50)).toBe('On track · 30% ahead');
    expect(scheduleLabel(50, 50)).toBe('On track');
    expect(scheduleLabel(79.9, 80)).toBe('1% behind'); // never "0% behind"
  });
});

describe('missingDatesMessage', () => {
  it('names the missing dates', () => {
    expect(missingDatesMessage({ noStartDate: true, noDueDate: true })).toBe('No dates in GitLab');
    expect(missingDatesMessage({ noStartDate: true })).toBe('No start date in GitLab');
    expect(missingDatesMessage({ noDueDate: true })).toBe('No due date in GitLab');
    expect(missingDatesMessage({})).toBeUndefined();
  });
});

describe('rowWarnings', () => {
  const EPIC = "No child items: progress can't be tracked (stays at 0% until closed)";
  const MILESTONE = "No items: progress can't be tracked (stays at 0%)";

  it('warns about open epics and milestones without child items', () => {
    expect(rowWarnings({ type: 'epic', noChildren: true })).toEqual([EPIC]);
    expect(rowWarnings({ type: 'milestone', noChildren: true })).toEqual([MILESTONE]);
  });

  it('lists the missing dates first, then the missing children', () => {
    expect(rowWarnings({ type: 'epic', noChildren: true, noStartDate: true, noDueDate: true })).toEqual(['No dates in GitLab', EPIC]);
    expect(rowWarnings({ type: 'issue', noDueDate: true })).toEqual(['No due date in GitLab']);
  });

  it('says nothing for a closed item, an issue, or an item with children', () => {
    expect(rowWarnings({ type: 'epic', noChildren: true, closed: true })).toEqual([]);
    expect(noChildrenMessage({ type: 'issue', noChildren: true })).toBeUndefined();
    expect(rowWarnings({ type: 'epic' })).toEqual([]);
  });
});

describe('rowWarnings: blockers', () => {
  it("doesn't warn about a row starting before its blocker ends: its bar is hatched instead", () => {
    const blockedBy = [{ id: 'b', name: 'Payments', start: '2026-10-01', end: '2026-10-08' }];
    const row = { type: 'issue', start: '2026-10-05', blockedBy };
    expect(rowWarnings(row)).toEqual([]);
  });
});
