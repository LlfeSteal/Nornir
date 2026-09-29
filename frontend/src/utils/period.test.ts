import { describe, expect, it } from 'vitest';
import { clipBar, periodLabel, periodRange, withinPeriod } from './period';
import { task } from './testing';

const now = new Date(2026, 9, 15, 12); // Thursday, October 15, 2026

describe('periodRange', () => {
  it('covers the quarter, the year or the 3 years around today, moved by offset', () => {
    expect(periodRange({ preset: 'quarter', offset: 0 }, now)).toEqual({ from: new Date(2026, 9, 1), to: new Date(2027, 0, 1) });
    expect(periodRange({ preset: 'quarter', offset: 1 }, now)).toEqual({ from: new Date(2027, 0, 1), to: new Date(2027, 3, 1) });
    expect(periodRange({ preset: 'year', offset: -1 }, now)).toEqual({ from: new Date(2025, 0, 1), to: new Date(2026, 0, 1) });
    expect(periodRange({ preset: 'threeYears', offset: 0 }, now)).toEqual({ from: new Date(2025, 0, 1), to: new Date(2028, 0, 1) });
    expect(periodRange({ preset: 'all', offset: 0 }, now)).toBeNull();
  });

  it('names the period', () => {
    expect(periodLabel({ preset: 'quarter', offset: 0 }, now)).toBe('Q4 2026');
    expect(periodLabel({ preset: 'year', offset: 0 }, now)).toBe('2026');
    expect(periodLabel({ preset: 'threeYears', offset: 0 }, now)).toBe('2025 – 2027');
    expect(periodLabel({ preset: 'all', offset: 0 }, now)).toBe('All dates');
  });
});

describe('withinPeriod', () => {
  it('keeps an item overlapping the range, or one of whose descendants does', () => {
    const range = periodRange({ preset: 'quarter', offset: 0 }, now);
    const tree = [
      task('old', { start: '2025-01-01', end: '2025-02-01' }),
      task('parent', { type: 'epic', start: '2025-01-01', end: '2025-02-01', children: [task('child', { start: '2026-12-01', end: '2027-01-10' })] }),
      task('current'),
    ];
    const kept = withinPeriod(tree, range);
    expect(kept.map((node) => node.id)).toEqual(['parent', 'current']);
    expect(kept[0].children?.map((node) => node.id)).toEqual(['child']);
  });
});

describe('clipBar', () => {
  it('cuts the bar at the range and keeps progress pointing at the same dates', () => {
    const range = { from: new Date(2026, 9, 1), to: new Date(2027, 0, 1) };
    // Dec 1 → Jan 31 (61 days), half done: Dec 31 minus half a day, i.e. near the end of the cut bar.
    const bar = clipBar({ start: '2026-12-01', end: '2027-01-31', progress: 50, linearProgress: 0 }, range);
    expect(bar.start).toEqual(new Date(2026, 11, 1));
    expect(bar.end).toEqual(new Date(2027, 0, 1));
    expect(bar.progress).toBeGreaterThan(95);
    expect(bar.progress).toBeLessThanOrEqual(100);
  });

  it('leaves a bar inside the range untouched', () => {
    const item = { start: '2026-10-02', end: '2026-10-10', progress: 30, linearProgress: 60 };
    expect(clipBar(item, { from: new Date(2026, 9, 1), to: new Date(2027, 0, 1) })).toEqual({
      start: new Date(2026, 9, 2),
      end: new Date(2026, 9, 10),
      progress: 30,
      linearProgress: 60,
    });
  });
});
