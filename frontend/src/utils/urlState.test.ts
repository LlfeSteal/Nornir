import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTERS } from './filters';
import { decodeView, encodeView, viewKey } from './urlState';

describe('encodeView / decodeView', () => {
  it('leaves the default view out of the URL', () => {
    expect(encodeView({ filters: DEFAULT_FILTERS })).toBe('');
    expect(decodeView('')).toEqual({ preset: undefined, offset: undefined, viewMode: undefined, filters: DEFAULT_FILTERS });
  });

  it('round-trips a full view', () => {
    const view = {
      preset: 'quarter' as const,
      offset: -2,
      viewMode: 'Day' as const,
      filters: {
        search: 'pay ment',
        types: ['epic' as const, 'issue' as const],
        labels: ['team, a', 'backend'],
        subgroups: ['.', 'team/core'],
        health: ['atRisk' as const],
        attention: ['late' as const, 'pastParent' as const],
        blocked: true,
      },
    };
    const query = encodeView(view);
    expect(query).toBe(
      'period=quarter&offset=-2&view=day&q=pay+ment&types=e%2Ci&label=team%2C+a&label=backend&subgroup=.&subgroup=team%2Fcore&health=atRisk&attention=late%2CpastParent&blocked=1',
    );
    expect(decodeView(`?${query}`)).toEqual(view);
  });

  it('keeps "no type" apart from "every type"', () => {
    const none = { ...DEFAULT_FILTERS, types: [] };
    expect(encodeView({ filters: none })).toBe('types=');
    expect(decodeView('types=').filters.types).toEqual([]);
  });

  it('drops what it does not know, value by value', () => {
    const view = decodeView('period=decade&offset=x&view=year&types=e,z&health=atRisk,bad&attention=late,nope&blocked=yes');
    expect(view).toMatchObject({ preset: undefined, offset: undefined, viewMode: undefined });
    expect(view.filters).toEqual({ ...DEFAULT_FILTERS, types: ['epic'], health: ['atRisk'], attention: ['late'] });
  });

  it('ignores an offset for all dates', () => {
    expect(decodeView('period=all&offset=3').offset).toBeUndefined();
  });
});

describe('viewKey', () => {
  it('writes the whole view, defaults included', () => {
    expect(viewKey({ preset: 'year', offset: 0, viewMode: 'Month', filters: DEFAULT_FILTERS })).toBe('period=year&view=month');
  });

  it('is the same whatever order things were picked in', () => {
    const view = (labels: string[], attention: ('late' | 'blocked')[], subgroups: string[] = []) =>
      viewKey({ preset: 'quarter', offset: 1, viewMode: 'Week', filters: { ...DEFAULT_FILTERS, labels, attention, subgroups } });
    expect(view(['b', 'a'], ['late', 'blocked'])).toBe(view(['a', 'b'], ['blocked', 'late']));
    expect(view([], [], ['team', '.'])).toBe(view([], [], ['.', 'team']));
    expect(view(['a'], [])).not.toBe(view(['b'], []));
  });

  it('reads back as the same view', () => {
    const filters = { ...DEFAULT_FILTERS, search: 'pay', types: ['epic' as const], blocked: true };
    expect(decodeView(viewKey({ preset: 'threeYears', offset: -1, viewMode: 'Day', filters }))).toEqual({
      preset: 'threeYears',
      offset: -1,
      viewMode: 'Day',
      filters,
    });
  });
});
