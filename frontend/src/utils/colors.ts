import { useEffect, useState } from 'react';
import type { GanttTaskType } from '../types/gantt';

// Apple system colors. The CSS uses them through variables (styles/theme.css); the Gantt
// bars are SVG colored through props, so they need the actual values for the current
// appearance.

export type ColorScheme = 'light' | 'dark';

interface Palette {
  types: Record<GanttTaskType, string>;
  selected: string;
}

export const PALETTES: Record<ColorScheme, Palette> = {
  light: { types: { milestone: '#af52de', epic: '#007aff', issue: '#34c759' }, selected: '#0062cc' },
  dark: { types: { milestone: '#bf5af2', epic: '#0a84ff', issue: '#30d158' }, selected: '#409cff' },
};

/** The appearance of the system, kept up to date when the user switches it. */
export function useColorScheme(): ColorScheme {
  const query = '(prefers-color-scheme: dark)';
  const [scheme, setScheme] = useState<ColorScheme>(() => (window.matchMedia(query).matches ? 'dark' : 'light'));
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setScheme(media.matches ? 'dark' : 'light');
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return scheme;
}

/** CSS value of the band behind the rows of an expanded group (see theme.css). */
export function groupBand(parentType: GanttTaskType): string {
  return `var(--${parentType}-band)`;
}

function channels(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Mixes `hex` with `target`: amount 0 keeps `hex`, 1 gives `target`. */
export function mix(hex: string, target: string, amount: number): string {
  const to = channels(target);
  const mixed = channels(hex).map((c, i) => Math.round(c + (to[i] - c) * amount));
  return '#' + mixed.map((c) => c.toString(16).padStart(2, '0')).join('');
}

/** Toned-down version of a color, for the bars below the top level: lighter in the light
 * appearance, closer to the dark card background in the dark one. */
export function muted(hex: string, scheme: ColorScheme): string {
  return scheme === 'dark' ? mix(hex, '#1c1c1e', 0.35) : mix(hex, '#ffffff', 0.35);
}
