import { describe, expect, it } from 'vitest';
import {
  addPortfolio,
  deletePortfolio,
  matchingPortfolio,
  nameProblem,
  parsePortfolios,
  renamePortfolio,
  setDefault,
  updateItems,
} from './portfolios';

const state = {
  portfolios: [
    { id: 'a', name: 'Release', items: ['m1', 'w2'] },
    { id: 'b', name: 'Mine', items: ['w3'] },
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
    const mixed = { portfolios: [state.portfolios[0], { id: 'x', name: ' ', items: [] }, { id: 'y', name: 'Y', items: [1] }], defaultId: 'y' };
    expect(parsePortfolios(JSON.stringify(mixed))).toEqual({ portfolios: [state.portfolios[0]], defaultId: undefined });
  });
});

describe('portfolio helpers', () => {
  it('finds the portfolio holding exactly these items, in any order', () => {
    expect(matchingPortfolio(state, ['w2', 'm1'])?.name).toBe('Release');
    expect(matchingPortfolio(state, ['m1'])).toBeUndefined();
    expect(matchingPortfolio(state, [])).toBeUndefined();
  });

  it('requires unique names, ignoring case', () => {
    expect(nameProblem(state, '  ')).toBe('Enter a name');
    expect(nameProblem(state, 'release')).toBe('“release” already exists');
    expect(nameProblem(state, 'Release', 'a')).toBeUndefined(); // renaming it to itself
    expect(nameProblem(state, 'Q4')).toBeUndefined();
  });

  it('adds, renames, updates and deletes, clearing the default with it', () => {
    let next = addPortfolio(state, { id: 'c', name: ' Q4 ', items: ['m9'] });
    expect(next.portfolios.map((p) => p.name)).toEqual(['Release', 'Mine', 'Q4']);
    next = renamePortfolio(next, 'c', 'Q4 2026');
    next = updateItems(next, 'c', ['m9', 'w1']);
    expect(next.portfolios[2]).toEqual({ id: 'c', name: 'Q4 2026', items: ['m9', 'w1'] });
    expect(deletePortfolio(next, 'a').defaultId).toBe('b');
    expect(deletePortfolio(next, 'b')).toMatchObject({ defaultId: undefined });
    expect(setDefault(next, 'c').defaultId).toBe('c');
    expect(setDefault(next, undefined).defaultId).toBeUndefined();
  });
});
