import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ViewMode } from 'gantt-task-react';
import { GanttChart, GanttChartHandle } from './components/GanttChart';
import { Toolbar } from './components/Toolbar';
import { Legend } from './components/Legend';
import { EmptyState, ErrorBanner, Skeleton } from './components/StateViews';
import { AppConfig, errorMessage, fetchConfig, fetchGantt } from './api/gantt';
import { GanttTask } from './types/gantt';
import { ColorSchemeContext, useAppearance } from './utils/appearance';

export const App: React.FC = () => {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [data, setData] = useState<GanttTask[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Week);
  const chart = useRef<GanttChartHandle>(null);
  const { appearance, scheme, setAppearance } = useAppearance();

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

  const hasItems = !!data && data.length > 0;

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
      />
      <main className="content">
        {error && <ErrorBanner message={error} onRetry={() => void load(true)} />}
        {hasItems && <Legend />}
        {/* First load only: afterwards the chart stays mounted during a refresh, so the
            expanded rows are preserved. */}
        {loading && !data && !error && <Skeleton />}
        {data && data.length === 0 && <EmptyState />}
        {hasItems && <GanttChart ref={chart} data={data} viewMode={viewMode} />}
      </main>
    </ColorSchemeContext.Provider>
  );
};
