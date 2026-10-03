import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTERS } from './filters';
import { decodeView, encodeView } from './urlState';

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
        items: ['m1', 'w42'],
        search: 'pay ment',
        types: ['epic' as const, 'issue' as const],
        labels: ['team, a', 'backend'],
        health: ['atRisk' as const],
        attention: ['late' as const, 'pastParent' as const],
        blocked: true,
      },
    };
    const query = encodeView(view);
    expect(query).toBe(
      'period=quarter&offset=-2&view=day&q=pay+ment&types=e%2Ci&label=team%2C+a&label=backend&health=atRisk&attention=late%2CpastParent&blocked=1&items=m1%2Cw42',
    );
    expect(decodeView(`?${query}`)).toEqual(view);
  });

  it('keeps "no type" apart from "every type"', () => {
    const none = { ...DEFAULT_FILTERS, types: [] };
    expect(encodeView({ filters: none })).toBe('types=');
    expect(decodeView('types=').filters.types).toEqual([]);
  });

  it('drops what it does not know, value by value', () => {
    const view = decodeView('period=decade&offset=x&view=year&types=e,z&health=atRisk,bad&attention=late,nope&items=m1,w,x9,m1&blocked=yes');
    expect(view).toMatchObject({ preset: undefined, offset: undefined, viewMode: undefined });
    expect(view.filters).toEqual({ ...DEFAULT_FILTERS, types: ['epic'], health: ['atRisk'], attention: ['late'], items: ['m1'] });
  });

  it('ignores an offset for all dates', () => {
    expect(decodeView('period=all&offset=3').offset).toBeUndefined();
  });
});
