import { GanttTaskType, HealthStatus } from '../types/gantt';
import { ATTENTION_FLAGS, AttentionFlag } from './attention';
import { ALL_TYPES, DEFAULT_FILTERS, Filters } from './filters';
import { PERIOD_PRESETS, PeriodPreset } from './period';
import { ViewMode } from './timeline';

// The view in the page's URL, so that a link shows someone else the same chart: period,
// time scale and filters (a portfolio travels as its values, never by name). Defaults are left
// out, so a plain view has a plain URL; unknown values are dropped one by one. A portfolio
// stores its view the same way (`viewKey`).

export interface ViewState {
  preset?: PeriodPreset;
  offset?: number;
  viewMode?: ViewMode;
  filters: Filters;
}

const TYPE_CODES: [GanttTaskType, string][] = [
  ['milestone', 'm'],
  ['epic', 'e'],
  ['issue', 'i'],
];
const HEALTH: HealthStatus[] = ['atRisk', 'needsAttention', 'onTrack'];
const PRESETS = PERIOD_PRESETS.map((p) => p.value);
const VIEW_MODES = Object.values(ViewMode);

const list = (value: string | null) => (value ? value.split(',').filter(Boolean) : []);
const only = <T extends string>(values: string[], allowed: readonly T[]) =>
  [...new Set(values)].filter((value): value is T => (allowed as readonly string[]).includes(value));

/** The query string of a view, without the leading "?" (empty for the default view). */
export function encodeView({ preset, offset, viewMode, filters }: ViewState): string {
  const params = new URLSearchParams();
  if (preset) params.set('period', preset);
  if (offset) params.set('offset', String(offset));
  if (viewMode) params.set('view', viewMode.toLowerCase());
  if (filters.search.trim()) params.set('q', filters.search);
  if (ALL_TYPES.some((type) => !filters.types.includes(type))) {
    params.set('types', TYPE_CODES.filter(([type]) => filters.types.includes(type)).map(([, code]) => code).join(','));
  }
  filters.labels.forEach((label) => params.append('label', label));
  filters.subgroups.forEach((subgroup) => params.append('subgroup', subgroup));
  if (filters.health.length) params.set('health', filters.health.join(','));
  if (filters.attention.length) params.set('attention', filters.attention.join(','));
  if (filters.blocked) params.set('blocked', '1');
  return params.toString();
}

/** The view a query string asks for: what it doesn't say, or says wrong, is left at its
 * default (`preset`, `offset` and `viewMode` undefined). */
export function decodeView(search: string): ViewState {
  const params = new URLSearchParams(search);
  const preset = only([params.get('period') ?? ''], PRESETS)[0];
  const offsetText = params.get('offset');
  const offset = offsetText && /^-?\d+$/.test(offsetText) ? Number(offsetText) : undefined;
  const view = params.get('view');
  const viewMode = VIEW_MODES.find((mode) => mode.toLowerCase() === view);
  const types = params.has('types')
    ? TYPE_CODES.filter(([, code]) => list(params.get('types')).includes(code)).map(([type]) => type)
    : ALL_TYPES;
  return {
    preset,
    offset: preset === 'all' ? undefined : offset,
    viewMode,
    filters: {
      ...DEFAULT_FILTERS,
      search: params.get('q') ?? '',
      types,
      labels: [...new Set(params.getAll('label').filter(Boolean))],
      subgroups: [...new Set(params.getAll('subgroup').filter(Boolean))],
      health: only(list(params.get('health')), HEALTH),
      attention: only(list(params.get('attention')), ATTENTION_FLAGS) as AttentionFlag[],
      blocked: params.get('blocked') === '1',
    },
  };
}

/** The whole view as a query string, every field written and the lists sorted: two views that
 * show the same chart get the same key, whatever the order things were picked in. What a
 * portfolio stores, and how it is recognized. */
export function viewKey({ preset, offset, viewMode, filters }: { preset: PeriodPreset; offset: number; viewMode: ViewMode; filters: Filters }): string {
  const sorted = (values: string[]) => [...values].sort();
  return encodeView({
    preset,
    offset,
    viewMode,
    filters: {
      ...filters,
      labels: sorted(filters.labels),
      subgroups: sorted(filters.subgroups),
      health: sorted(filters.health) as Filters['health'],
      attention: sorted(filters.attention) as Filters['attention'],
    },
  });
}
