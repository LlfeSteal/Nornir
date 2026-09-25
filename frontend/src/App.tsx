import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ViewMode } from 'gantt-task-react';
import { GanttChart, GanttChartHandle } from './components/GanttChart';
import { Toolbar } from './components/Toolbar';
import { Legend } from './components/Legend';
import { EmptyState, ErrorBanner, Skeleton } from './components/StateViews';
import { AppConfig, errorMessage, fetchConfig, fetchGantt } from './api/gantt';
import { GanttTask } from './types/gantt';
import { ColorSchemeContext, useAppearance } from './utils/appearance';
import { withoutClosed } from './utils/flatten';
import { useStoredBoolean } from './utils/preferences';

export const App: React.FC = () => {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [data, setData] = useState<GanttTask[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Week);
  const chart = useRef<GanttChartHandle>(null);
  const { appearance, scheme, setAppearance } = useAppearance();
  // Closed items are hidden unless the user asks for them (remembered).
  const [showClosed, setShowClosed] = useStoredBoolean('nornir.showClosed', false);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchGantt(refresh));
      setLastUpdated(new Date());
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

  const visibleData = useMemo(() => (data && !showClosed ? withoutClosed(data) : data), [data, showClosed]);
  const hasItems = !!visibleData && visibleData.length > 0;
  const allClosed = !!data && data.length > 0 && !hasItems;

  return (
    <ColorSchemeContext.Provider value={scheme}>
      <Toolbar
        config={config}
        lastUpdated={lastUpdated}
        loading={loading}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onToday={() => chart.current?.scrollToToday()}
        onRefresh={() => void load(true)}
        chartReady={hasItems}
        appearance={appearance}
        onAppearanceChange={setAppearance}
        showClosed={showClosed}
        onShowClosedChange={setShowClosed}
      />
      <main className="content">
        {error && <ErrorBanner message={error} onRetry={() => void load(true)} />}
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
        {hasItems && <GanttChart ref={chart} data={visibleData} viewMode={viewMode} />}
      </main>
    </ColorSchemeContext.Provider>
  );
};
