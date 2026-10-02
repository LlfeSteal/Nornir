import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { GanttChart, GanttChartHandle } from './components/GanttChart';
import { Toolbar } from './components/Toolbar';
import { Legend } from './components/Legend';
import { FilterBar } from './components/FilterBar';
import { EmptyState, ErrorBanner, Skeleton } from './components/StateViews';
import { AppConfig, errorMessage, fetchConfig, fetchGantt, fetchLabels } from './api/gantt';
import { GanttTask, Label } from './types/gantt';
import { useAppearance } from './utils/appearance';
import { ViewMode } from './utils/timeline';
import { withoutClosed } from './utils/flatten';
import { DEFAULT_FILTERS, Filters, applyFilters, labelOptions } from './utils/filters';
import { useStoredBoolean, useStoredValue } from './utils/preferences';
import { DEFAULT_PRESET, PERIOD_PRESETS, PeriodPreset, periodLabel, periodRange, withinPeriod } from './utils/period';
import { dependencyIndex } from './utils/dependencies';
import { DependencyContext } from './components/DependencyContext';
import { DependencyDialog } from './components/DependencyDialog';

const PRESET_VALUES = PERIOD_PRESETS.map((p) => p.value);
const suggestedViewMode = (preset: PeriodPreset) => PERIOD_PRESETS.find((p) => p.value === preset)?.viewMode;

export const App: React.FC = () => {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [data, setData] = useState<GanttTask[] | null>(null);
  const [groupLabels, setGroupLabels] = useState<Label[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  // The period shown: a remembered preset, moved by the ‹ › arrows (not remembered).
  const [preset, setPreset] = useStoredValue<PeriodPreset>('nornir.period', DEFAULT_PRESET, PRESET_VALUES);
  const [periodOffset, setPeriodOffset] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>(() => suggestedViewMode(preset) ?? ViewMode.Week);
  const chart = useRef<GanttChartHandle>(null);
  const { appearance, setAppearance } = useAppearance();
  // Closed items are hidden unless the user asks for them (remembered).
  const [showClosed, setShowClosed] = useStoredBoolean('nornir.showClosed', false);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  // Typing stays smooth on large trees: the chart follows the filters a bit later.
  const deferredFilters = useDeferredValue(filters);
  // The row whose dependencies are shown in the dialog.
  const [dependencyFor, setDependencyFor] = useState<GanttTask | null>(null);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    // The group's labels load on their own (many pages on a large group) and never block
    // the chart: without them, the Labels menu still lists the labels found on the items.
    fetchLabels(refresh).then(setGroupLabels, () => undefined);
    try {
      const { tasks, fetchedAt } = await fetchGantt(refresh);
      setData(tasks);
      // When the data comes from the backend's cache, the time it was fetched from GitLab.
      setLastUpdated(fetchedAt);
    } catch (err) {
      setError(errorMessage(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig().then(setConfig, (err) => setError(errorMessage(err)));
    void load();
  }, [load]);

  const changePreset = (next: PeriodPreset) => {
    setPreset(next);
    setPeriodOffset(0);
    // A period comes with the time scale that suits it; the user can still change it.
    const mode = suggestedViewMode(next);
    if (mode) setViewMode(mode);
  };
  const today = new Date().toDateString();
  const period = { preset, offset: periodOffset };
  // Recomputed when the day changes.
  const range = useMemo(() => periodRange({ preset, offset: periodOffset }, new Date()), [preset, periodOffset, today]);

  // data → closed items hidden (unless shown) → period → filters.
  const openData = useMemo(() => (data && !showClosed ? withoutClosed(data) : data), [data, showClosed]);
  const inPeriod = useMemo(() => (openData ? withinPeriod(openData, range) : null), [openData, range]);
  const filtered = useMemo(() => (inPeriod ? applyFilters(inPeriod, deferredFilters) : null), [inPeriod, deferredFilters]);
  const labels = useMemo(() => labelOptions(groupLabels, openData ?? []), [groupLabels, openData]);
  // The links of every item shown, whatever the period and the filters hide: a row's
  // dependencies include its descendants and blockers that are filtered out.
  const dependencies = useMemo(() => (openData ? dependencyIndex(openData, showClosed) : null), [openData, showClosed]);
  const dependencyContext = useMemo(
    () => (dependencies ? { index: dependencies, open: setDependencyFor } : null),
    [dependencies],
  );

  const hasOpenItems = !!openData && openData.length > 0;
  const hasItems = !!filtered && filtered.length > 0;
  const allClosed = !!data && data.length > 0 && !hasOpenItems;
  const emptyPeriod = hasOpenItems && !!inPeriod && inPeriod.length === 0;
  const noMatch = hasOpenItems && !emptyPeriod && !hasItems;

  return (
    <>
      <Toolbar
        config={config}
        lastUpdated={lastUpdated}
        loading={loading}
        preset={preset}
        periodLabel={periodLabel(period, new Date())}
        onPresetChange={changePreset}
        onPeriodStep={(step) => setPeriodOffset((offset) => offset + step)}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onToday={() => {
          // Back to the current period; the chart centers on today once it shows it.
          if (periodOffset !== 0) setPeriodOffset(0);
          else chart.current?.scrollToToday();
        }}
        onRefresh={() => void load(true)}
        chartReady={hasItems || periodOffset !== 0}
        appearance={appearance}
        onAppearanceChange={setAppearance}
        showClosed={showClosed}
        onShowClosedChange={setShowClosed}
      />
      <main className="content">
        {error && <ErrorBanner message={error} onRetry={() => void load(true)} />}
        {hasOpenItems && <FilterBar filters={filters} onChange={setFilters} labels={labels} />}
        {hasItems && <Legend />}
        {/* First load only: afterwards the chart stays mounted during a refresh, so the
            expanded rows are preserved. */}
        {loading && !data && !error && <Skeleton />}
        {data && data.length === 0 && <EmptyState />}
        {allClosed && (
          <EmptyState
            title="Everything is closed"
            message="Every item of this group is closed, and closed items are hidden."
            action={
              <button type="button" className="button" onClick={() => setShowClosed(true)}>
                Show closed items
              </button>
            }
          />
        )}
        {emptyPeriod && (
          <EmptyState
            title="Nothing in this period"
            message="No item has dates in this period."
            action={
              <button type="button" className="button" onClick={() => changePreset('all')}>
                Show all dates
              </button>
            }
          />
        )}
        {noMatch && (
          <EmptyState
            title="No matching items"
            message="No item matches these filters."
            action={
              <button type="button" className="button" onClick={() => setFilters(DEFAULT_FILTERS)}>
                Clear filters
              </button>
            }
          />
        )}
        {/* Stays mounted while the filters match nothing (it renders nothing then), so the
            expanded rows survive until the filters are cleared. */}
        {hasOpenItems && filtered && (
          <DependencyContext.Provider value={dependencyContext}>
            <GanttChart ref={chart} data={filtered} viewMode={viewMode} range={range} />
          </DependencyContext.Provider>
        )}
      </main>
      {dependencyFor && dependencies && (
        <DependencyDialog
          node={dependencyFor}
          index={dependencies}
          viewMode={viewMode}
          onClose={() => setDependencyFor(null)}
        />
      )}
    </>
  );
};
