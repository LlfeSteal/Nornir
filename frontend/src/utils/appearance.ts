import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ColorScheme } from './colors';

// Appearance setting, like Apple's: Automatic (follows the system), Light or Dark. The choice
// is remembered in localStorage and applied as data-theme on <html>, which selects the
// palette in styles/theme.css.
//
// index.html runs the same resolution in a small inline script before the first paint (to
// avoid a flash of the wrong theme): keep both in sync.

export type Appearance = 'system' | 'light' | 'dark';

export const APPEARANCE_KEY = 'nornir.appearance';
const DARK_QUERY = '(prefers-color-scheme: dark)';
const THEME_COLORS: Record<ColorScheme, string> = { light: '#f5f5f7', dark: '#000000' };

export function loadAppearance(): Appearance {
  try {
    const stored = localStorage.getItem(APPEARANCE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // Storage unavailable (private mode, blocked cookies): fall back to Automatic.
  }
  return 'system';
}

function saveAppearance(appearance: Appearance) {
  try {
    localStorage.setItem(APPEARANCE_KEY, appearance);
  } catch {
    // Not remembered, but still applied for this session.
  }
}

export function resolveScheme(appearance: Appearance): ColorScheme {
  if (appearance !== 'system') return appearance;
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

function applyScheme(scheme: ColorScheme) {
  document.documentElement.dataset.theme = scheme;
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((meta) => meta.setAttribute('content', THEME_COLORS[scheme]));
}

/** The appearance chosen by the user and the color scheme it resolves to right now. */
export function useAppearance() {
  const [appearance, setAppearanceState] = useState<Appearance>(loadAppearance);
  const [scheme, setScheme] = useState<ColorScheme>(() => resolveScheme(appearance));

  useEffect(() => {
    const update = () => setScheme(resolveScheme(appearance));
    update();
    if (appearance !== 'system') return;
    const media = window.matchMedia(DARK_QUERY);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [appearance]);

  useEffect(() => applyScheme(scheme), [scheme]);

  const setAppearance = useCallback((next: Appearance) => {
    saveAppearance(next);
    setAppearanceState(next);
  }, []);

  return { appearance, scheme, setAppearance };
}

/** Resolved color scheme, for components that need actual colors (the SVG bars). */
export const ColorSchemeContext = createContext<ColorScheme>('light');

export function useColorScheme(): ColorScheme {
  return useContext(ColorSchemeContext);
}
