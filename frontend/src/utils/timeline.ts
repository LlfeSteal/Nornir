import { GanttTask } from '../types/gantt';

// The time scale of the chart: one column per day (Day), per week starting on Monday (Week)
// or per calendar month (Month), all columns of the same width. A date's position inside its
// column is proportional to the time elapsed in it. Dates are local.

export const ViewMode = { Day: 'Day', Week: 'Week', Month: 'Month' } as const;
export type ViewMode = (typeof ViewMode)[keyof typeof ViewMode];

export const COLUMN_WIDTHS: Record<ViewMode, number> = { Day: 44, Week: 110, Month: 180 };

const DAY_MS = 24 * 60 * 60 * 1000;

/** "YYYY-MM-DD" → local midnight (new Date("YYYY-MM-DD") would be parsed as UTC). */
export function parseDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Start of the column containing `date`. */
export function columnStart(date: Date, viewMode: ViewMode): Date {
  const day = startOfDay(date);
  switch (viewMode) {
    case ViewMode.Week: {
      const sinceMonday = (day.getDay() + 6) % 7;
      return new Date(day.getFullYear(), day.getMonth(), day.getDate() - sinceMonday);
    }
    case ViewMode.Month:
      return new Date(day.getFullYear(), day.getMonth(), 1);
    default:
      return day;
  }
}

/** Moves `date` by `steps` columns (negative steps go back in time). */
export function addColumns(date: Date, steps: number, viewMode: ViewMode): Date {
  switch (viewMode) {
    case ViewMode.Week:
      return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 7 * steps);
    case ViewMode.Month:
      return new Date(date.getFullYear(), date.getMonth() + steps, date.getDate());
    default:
      return new Date(date.getFullYear(), date.getMonth(), date.getDate() + steps);
  }
}

/** Day count of a date, immune to daylight saving shifts. */
function dayNumber(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;
}

/** Position of `date` in columns from `origin` (a column start), fractional. */
function columnOffset(origin: Date, date: Date, viewMode: ViewMode): number {
  const dayFraction = (date.getTime() - startOfDay(date).getTime()) / DAY_MS;
  switch (viewMode) {
    case ViewMode.Month: {
      const months = (date.getFullYear() - origin.getFullYear()) * 12 + date.getMonth() - origin.getMonth();
      const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
      return months + (date.getDate() - 1 + dayFraction) / daysInMonth;
    }
    case ViewMode.Week:
      return (dayNumber(date) - dayNumber(origin) + dayFraction) / 7;
    default:
      return dayNumber(date) - dayNumber(origin) + dayFraction;
  }
}

export interface Timeline {
  viewMode: ViewMode;
  from: Date; // start of the first column
  to: Date; // end of the last column
  columns: number;
  columnWidth: number;
  width: number; // px
  /** Horizontal position of a date, in px from the start of the timeline. */
  x: (date: Date) => number;
}

/** The columns covering `from` → `to`. */
export function makeTimeline(from: Date, to: Date, viewMode: ViewMode): Timeline {
  const start = columnStart(from, viewMode);
  const columns = Math.max(1, Math.ceil(columnOffset(start, to, viewMode)));
  const columnWidth = COLUMN_WIDTHS[viewMode];
  return {
    viewMode,
    from: start,
    to: addColumns(start, columns, viewMode),
    columns,
    columnWidth,
    width: columns * columnWidth,
    x: (date) => columnOffset(start, date, viewMode) * columnWidth,
  };
}

/** Earliest start and latest end of the whole tree, collapsed rows included (null if empty). */
export function dataSpan(nodes: GanttTask[]): { from: Date; to: Date } | null {
  let first = '';
  let last = '';
  const walk = (list: GanttTask[]) => {
    for (const node of list) {
      // ISO dates compare as strings.
      if (!first || node.start < first) first = node.start;
      if (!last || node.end > last) last = node.end;
      if (node.children) walk(node.children);
    }
  };
  walk(nodes);
  return first ? { from: parseDay(first), to: parseDay(last) } : null;
}

function isoWeek(date: Date): number {
  const thursday = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  return Math.ceil(((thursday.getTime() - yearStart) / DAY_MS + 1) / 7);
}

/** Label of a column, in the calendar header's bottom line: "15", "W42" or "October". */
export function columnLabel(start: Date, viewMode: ViewMode): string {
  switch (viewMode) {
    case ViewMode.Week:
      return `W${isoWeek(start)}`;
    case ViewMode.Month:
      return start.toLocaleDateString('en-US', { month: 'long' });
    default:
      return String(start.getDate());
  }
}

/** What a column belongs to, in the header's top line: "October 2026", or the year in Month view. */
export function columnGroup(start: Date, viewMode: ViewMode): string {
  if (viewMode === ViewMode.Month) return String(start.getFullYear());
  return start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}
