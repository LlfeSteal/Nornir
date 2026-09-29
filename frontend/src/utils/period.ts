import { GanttTask } from '../types/gantt';
import { parseDay, ViewMode } from './timeline';

// The period shown in the chart: a preset window around today, moved back or forward by
// whole steps with the ‹ › arrows. Rows outside it are hidden and bars are cut at its edges.

export type PeriodPreset = 'quarter' | 'year' | 'threeYears' | 'all';

export interface Period {
  preset: PeriodPreset;
  offset: number; // steps from the current period (negative: the past)
}

/** Dates at local midnight; `to` is excluded. */
export interface DateRange {
  from: Date;
  to: Date;
}

export const PERIOD_PRESETS: { value: PeriodPreset; label: string; viewMode?: ViewMode }[] = [
  { value: 'quarter', label: 'This quarter', viewMode: ViewMode.Week },
  { value: 'year', label: 'This year', viewMode: ViewMode.Month },
  { value: 'threeYears', label: '3 years', viewMode: ViewMode.Month },
  { value: 'all', label: 'All dates' },
];

export const DEFAULT_PRESET: PeriodPreset = 'year';

/** The dates covered by the period, or null for every date. A quarter moves by quarters; a
 * year and the 3 years (last year → next year) move by years. */
export function periodRange({ preset, offset }: Period, now: Date): DateRange | null {
  const year = now.getFullYear();
  switch (preset) {
    case 'quarter': {
      const month = 3 * (Math.floor(now.getMonth() / 3) + offset);
      return { from: new Date(year, month, 1), to: new Date(year, month + 3, 1) };
    }
    case 'year':
      return { from: new Date(year + offset, 0, 1), to: new Date(year + offset + 1, 0, 1) };
    case 'threeYears':
      return { from: new Date(year + offset - 1, 0, 1), to: new Date(year + offset + 2, 0, 1) };
    default:
      return null;
  }
}

/** "Q3 2026", "2026", "2025 – 2027" or "All dates". */
export function periodLabel(period: Period, now: Date): string {
  const range = periodRange(period, now);
  if (!range) return 'All dates';
  const first = range.from.getFullYear();
  switch (period.preset) {
    case 'quarter':
      return `Q${Math.floor(range.from.getMonth() / 3) + 1} ${first}`;
    case 'year':
      return String(first);
    default:
      return `${first} – ${range.to.getFullYear() - 1}`;
  }
}

function overlaps(node: GanttTask, range: DateRange): boolean {
  return parseDay(node.start) < range.to && parseDay(node.end) > range.from;
}

/** The tree without the items outside the range. An item stays when its own dates overlap
 * the range or when one of its descendants does. IDs don't change. */
export function withinPeriod(nodes: GanttTask[], range: DateRange | null): GanttTask[] {
  if (!range) return nodes;
  const result: GanttTask[] = [];
  for (const node of nodes) {
    const children = node.children && withinPeriod(node.children, range);
    if (overlaps(node, range) || (children && children.length > 0)) {
      result.push(children ? { ...node, children } : node);
    }
  }
  return result;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export interface Bar {
  start: Date;
  end: Date;
  progress: number;
  linearProgress: number;
}

/** The bar of an item cut at the edges of the range. Progress values are positions along the
 * item's real dates: they are converted into fractions of the cut bar, so that they still
 * point at the same dates. An item entirely outside the range (kept for its descendants) gets
 * a one-day bar at the nearest edge. */
export function clipBar(
  item: { start: string; end: string; progress: number; linearProgress: number },
  range: DateRange | null,
): Bar {
  const start = parseDay(item.start);
  const end = parseDay(item.end);
  const bar = { start, end, progress: item.progress || 0, linearProgress: item.linearProgress || 0 };
  if (!range) return bar;
  let clipStart = start < range.from ? range.from : start;
  let clipEnd = end > range.to ? range.to : end;
  if (clipEnd <= clipStart) {
    if (start >= range.to) clipStart = addDays(range.to, -1);
    clipEnd = addDays(clipStart, 1);
  }
  if (clipStart.getTime() === start.getTime() && clipEnd.getTime() === end.getTime()) return bar;
  const span = end.getTime() - start.getTime();
  const toBar = (percent: number) => {
    const at = start.getTime() + (percent / 100) * span;
    const fraction = (at - clipStart.getTime()) / (clipEnd.getTime() - clipStart.getTime());
    return Math.min(100, Math.max(0, fraction * 100));
  };
  return { start: clipStart, end: clipEnd, progress: toBar(bar.progress), linearProgress: toBar(bar.linearProgress) };
}
