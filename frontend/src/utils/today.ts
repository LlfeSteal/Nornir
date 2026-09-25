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
