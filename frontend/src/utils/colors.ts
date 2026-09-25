import type { GanttTaskType } from '../types/gantt';

// Small color helpers for "#rrggbb" colors.

function channels(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Mixes the color with white: amount 0 keeps it, 1 gives white. */
export function lighten(hex: string, amount: number): string {
  const mixed = channels(hex).map((c) => Math.round(c + (255 - c) * amount));
  return '#' + mixed.map((c) => c.toString(16).padStart(2, '0')).join('');
}

export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = channels(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export const TYPE_COLORS: Record<GanttTaskType, string> = {
  milestone: '#6b46c1',
  epic: '#3182ce',
  issue: '#38a169',
};

/** Background of the rows inside an expanded group, in the group's color. */
export function groupBand(parentType: GanttTaskType): string {
  return withAlpha(TYPE_COLORS[parentType], 0.1);
}
