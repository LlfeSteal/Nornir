import { describe, expect, it } from 'vitest';
import {
  addPortfolio,
  deletePortfolio,
  matchingPortfolio,
  nameProblem,
  parsePortfolios,
  renamePortfolio,
  setDefault,
  updateView,
} from './portfolios';

const state = {
  portfolios: [
    { id: 'a', name: 'Release', query: 'period=year&view=month&label=release' },
    { id: 'b', name: 'Mine', query: 'period=quarter&view=week&q=pay' },
  ],
  defaultId: 'b',
};

describe('parsePortfolios', () => {
  it('reads what was stored', () => {
    expect(parsePortfolios(JSON.stringify(state))).toEqual(state);
  });

  it('treats anything broken as empty, and drops broken entries', () => {
    expect(parsePortfolios(null)).toEqual({ portfolios: [] });
    expect(parsePortfolios('{oops')).toEqual({ portfolios: [] });
    expect(parsePortfolios('[]')).toEqual({ portfolios: [] });
    // A blank name, a query that isn't text, and an entry of the older shape (items).
    const mixed = {
      portfolios: [state.portfolios[0], { id: 'x', name: ' ', query: '' }, { id: 'y', name: 'Y', query: 1 }, { id: 'z', name: 'Z', items: ['m1'] }],
      defaultId: 'y',
    };
    expect(parsePortfolios(JSON.stringify(mixed))).toEqual({ portfolios: [state.portfolios[0]], defaultId: undefined });
  });
});

describe('portfolio helpers', () => {
  it('finds the portfolio showing exactly this view', () => {
    expect(matchingPortfolio(state, 'period=quarter&view=week&q=pay')?.name).toBe('Mine');
    expect(matchingPortfolio(state, 'period=quarter&view=day&q=pay')).toBeUndefined();
  });

  it('requires unique names, ignoring case', () => {
    expect(nameProblem(state, '  ')).toBe('Enter a name');
    expect(nameProblem(state, 'release')).toBe('“release” already exists');
    expect(nameProblem(state, 'Release', 'a')).toBeUndefined(); // renaming it to itself
    expect(nameProblem(state, 'Q4')).toBeUndefined();
  });

  it('adds, renames, updates and deletes, clearing the default with it', () => {
    let next = addPortfolio(state, { id: 'c', name: ' Q4 ', query: 'period=quarter&view=week' });
    expect(next.portfolios.map((p) => p.name)).toEqual(['Release', 'Mine', 'Q4']);
    next = renamePortfolio(next, 'c', 'Q4 2026');
    next = updateView(next, 'c', 'period=quarter&view=week&blocked=1');
    expect(next.portfolios[2]).toEqual({ id: 'c', name: 'Q4 2026', query: 'period=quarter&view=week&blocked=1' });
    expect(deletePortfolio(next, 'a').defaultId).toBe('b');
    expect(deletePortfolio(next, 'b')).toMatchObject({ defaultId: undefined });
    expect(setDefault(next, 'c').defaultId).toBe('c');
    expect(setDefault(next, undefined).defaultId).toBeUndefined();
  });
});
