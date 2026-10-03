import { useCallback, useState } from 'react';

// Portfolios: named sets of milestones and epics (compact IDs, see `shortId`), one of them
// optionally the default, applied when the app opens without a view in its URL. They are the
// only filters kept in the browser (localStorage); a link shares a portfolio's items, never
// its name.

export interface Portfolio {
  id: string;
  name: string;
  items: string[];
}

export interface Portfolios {
  portfolios: Portfolio[];
  defaultId?: string;
}

export const PORTFOLIOS_KEY = 'nornir.portfolios';
const EMPTY: Portfolios = { portfolios: [] };

/** The stored portfolios, empty when the value is missing or isn't what it should be. */
export function parsePortfolios(text: string | null): Portfolios {
  if (!text) return EMPTY;
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== 'object' || !Array.isArray((value as Portfolios).portfolios)) return EMPTY;
    const portfolios = (value as Portfolios).portfolios.filter(
      (p): p is Portfolio =>
        !!p &&
        typeof p.id === 'string' &&
        typeof p.name === 'string' &&
        p.name.trim() !== '' &&
        Array.isArray(p.items) &&
        p.items.every((item) => typeof item === 'string'),
    );
    const defaultId = (value as Portfolios).defaultId;
    return { portfolios, defaultId: portfolios.some((p) => p.id === defaultId) ? defaultId : undefined };
  } catch {
    return EMPTY;
  }
}

const key = (items: string[]) => [...new Set(items)].sort().join(',');
const sameItems = (a: string[], b: string[]) => key(a) === key(b);

/** The saved portfolio holding exactly these items (in any order), if any. */
export function matchingPortfolio(state: Portfolios, items: string[]): Portfolio | undefined {
  return items.length === 0 ? undefined : state.portfolios.find((p) => sameItems(p.items, items));
}

/** Why a name can't be used, or undefined: names are required and unique (ignoring case). */
export function nameProblem(state: Portfolios, name: string, except?: string): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) return 'Enter a name';
  const taken = state.portfolios.some((p) => p.id !== except && p.name.toLowerCase() === trimmed.toLowerCase());
  return taken ? `“${trimmed}” already exists` : undefined;
}

export function addPortfolio(state: Portfolios, portfolio: Portfolio): Portfolios {
  return { ...state, portfolios: [...state.portfolios, { ...portfolio, name: portfolio.name.trim() }] };
}

export function renamePortfolio(state: Portfolios, id: string, name: string): Portfolios {
  return { ...state, portfolios: state.portfolios.map((p) => (p.id === id ? { ...p, name: name.trim() } : p)) };
}

export function updateItems(state: Portfolios, id: string, items: string[]): Portfolios {
  return { ...state, portfolios: state.portfolios.map((p) => (p.id === id ? { ...p, items } : p)) };
}

export function deletePortfolio(state: Portfolios, id: string): Portfolios {
  return {
    portfolios: state.portfolios.filter((p) => p.id !== id),
    defaultId: state.defaultId === id ? undefined : state.defaultId,
  };
}

/** Makes a portfolio the default, or none with undefined. */
export function setDefault(state: Portfolios, id: string | undefined): Portfolios {
  return { ...state, defaultId: id };
}

export function newPortfolioId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function readPortfolios(): Portfolios {
  try {
    return parsePortfolios(localStorage.getItem(PORTFOLIOS_KEY));
  } catch {
    return EMPTY;
  }
}

/** The portfolios and a function to change them, kept in localStorage (or for this session
 * only, when storage is unavailable). */
export function usePortfolios(): [Portfolios, (change: (state: Portfolios) => Portfolios) => void] {
  const [state, setState] = useState<Portfolios>(readPortfolios);
  const update = useCallback((change: (state: Portfolios) => Portfolios) => {
    setState((current) => {
      const next = change(current);
      try {
        localStorage.setItem(PORTFOLIOS_KEY, JSON.stringify(next));
      } catch {
        // Not remembered, but still applied for this session.
      }
      return next;
    });
  }, []);
  return [state, update];
}
