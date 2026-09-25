import React, { useCallback, useEffect, useState } from 'react';
import { GanttChart } from './components/GanttChart';
import { AppConfig, errorMessage, fetchConfig, fetchGantt } from './api/gantt';
import { GanttTask } from './types/gantt';

export const App: React.FC = () => {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [data, setData] = useState<GanttTask[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchGantt(refresh));
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

  return (
    <main>
      <h1>
        Nornir
        {config && (
          <>
            {' — '}
            <a href={`${config.gitlabUrl}/${config.group}`} target="_blank" rel="noopener noreferrer">
              {config.group}
            </a>
          </>
        )}
      </h1>
      <div className="controls">
        <button type="button" disabled={loading} onClick={() => void load(true)}>
          Refresh
        </button>
      </div>
      {loading && <p>Loading…</p>}
      {error && <p className="error">Error: {error}</p>}
      {/* Kept mounted during a refresh so the expanded rows are preserved. */}
      {data && <GanttChart data={data} />}
    </main>
  );
};
