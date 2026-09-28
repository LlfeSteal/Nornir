import { ViewMode } from 'gantt-task-react';

// Date helpers for the "today" line and for centering the chart on today, matching how
// gantt-task-react lays out its columns: one column per day (Day), per week starting on
// Monday (Week) or per calendar month (Month).

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): Date {
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

/** Position of `now` inside its column, from 0 (column start) to 1 (column end). */
export function columnFraction(now: Date, viewMode: ViewMode): number {
  const start = columnStart(now, viewMode);
  const end = addColumns(start, 1, viewMode);
  return (now.getTime() - start.getTime()) / (end.getTime() - start.getTime());
}

/** Number of whole columns from `from` to `to` (0 when `to` is not after `from`). */
export function columnsBetween(from: Date, to: Date, viewMode: ViewMode): number {
  if (to <= from) return 0;
  switch (viewMode) {
    case ViewMode.Week:
      return Math.ceil((to.getTime() - from.getTime()) / (7 * DAY_MS));
    case ViewMode.Month:
      return (to.getFullYear() - from.getFullYear()) * 12 + to.getMonth() - from.getMonth() + 1;
    default:
      return Math.ceil((to.getTime() - from.getTime()) / DAY_MS);
  }
}

/** Exact number of columns from the column holding `from` to the one holding `to` (0 when
 * `to` is not after `from`). */
export function columnSteps(from: Date, to: Date, viewMode: ViewMode): number {
  const a = columnStart(from, viewMode);
  const b = columnStart(to, viewMode);
  if (b <= a) return 0;
  switch (viewMode) {
    case ViewMode.Week:
      return Math.round((b.getTime() - a.getTime()) / (7 * DAY_MS));
    case ViewMode.Month:
      return (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();
    default:
      return Math.round((b.getTime() - a.getTime()) / DAY_MS);
  }
}

/** "YYYY-MM-DD" → local midnight (new Date("YYYY-MM-DD") would be parsed as UTC). */
export function parseDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** The library's `preStepsCount` that makes its date range start with the column holding
 * `from`, when its earliest visible bar starts on `earliest`. The library crashes when a bar
 * starts exactly on its first date: then one step more. In Month view it moves back by whole
 * months keeping the day of the month, which overflows (May 31 − 1 month → "April 31" =
 * May 1): then one step more too. */
export function preStepsTo(from: Date, earliest: Date, viewMode: ViewMode): number {
  const steps = columnSteps(from, earliest, viewMode);
  if (steps === 0 && earliest.getTime() === columnStart(earliest, viewMode).getTime()) return 1;
  if (viewMode !== ViewMode.Month) return steps;
  const month = earliest.getMonth() - steps;
  const landed = new Date(earliest.getFullYear(), month, earliest.getDate());
  return landed.getMonth() === new Date(earliest.getFullYear(), month, 1).getMonth() ? steps : steps + 1;
}
