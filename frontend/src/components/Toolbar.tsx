import React from 'react';
import { ViewMode } from 'gantt-task-react';
import { AppConfig } from '../api/gantt';
import { SegmentedControl } from './SegmentedControl';
import { AppearanceMenu } from './AppearanceMenu';
import { Appearance } from '../utils/appearance';
import { ClosedIcon, RefreshIcon, TimelineIcon, TodayIcon } from './Icons';

export const VIEW_MODES: { label: string; value: ViewMode }[] = [
  { label: 'Day', value: ViewMode.Day },
  { label: 'Week', value: ViewMode.Week },
  { label: 'Month', value: ViewMode.Month },
];

interface Props {
  config: AppConfig | null;
  lastUpdated: Date | null;
  loading: boolean;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onToday: () => void;
  onRefresh: () => void;
  chartReady: boolean;
  appearance: Appearance;
  onAppearanceChange: (appearance: Appearance) => void;
  showClosed: boolean;
  onShowClosedChange: (show: boolean) => void;
}

const timeFormat: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };

export const Toolbar: React.FC<Props> = ({
  config,
  lastUpdated,
  loading,
  viewMode,
  onViewModeChange,
  onToday,
  onRefresh,
  chartReady,
  appearance,
  onAppearanceChange,
  showClosed,
  onShowClosedChange,
}) => (
  <header className="toolbar">
    <div className="toolbar-title">
      <div className="app-icon">
        <TimelineIcon size={18} />
      </div>
      <div>
        <h1>
          Nornir
          {config && (
            <span className="group">
              {' · '}
              <a href={`${config.gitlabUrl}/${config.group}`} target="_blank" rel="noopener noreferrer">
                {config.group}
              </a>
            </span>
          )}
        </h1>
        <div className="updated" aria-live="polite">
          {loading ? 'Updating…' : lastUpdated ? `Updated at ${lastUpdated.toLocaleTimeString('en-US', timeFormat)}` : ''}
        </div>
      </div>
    </div>
    <div className="toolbar-actions">
      <SegmentedControl label="Time scale" options={VIEW_MODES} value={viewMode} onChange={onViewModeChange} />
      <button
        type="button"
        className="button"
        aria-pressed={showClosed}
        title={showClosed ? 'Hide closed items' : 'Show closed items'}
        onClick={() => onShowClosedChange(!showClosed)}
      >
        <ClosedIcon size={15} />
        Closed
      </button>
      <button type="button" className="button" onClick={onToday} disabled={!chartReady}>
        <TodayIcon size={15} />
        Today
      </button>
      <button
        type="button"
        className="button icon"
        onClick={onRefresh}
        disabled={loading}
        aria-label="Refresh"
        title="Reload from GitLab"
      >
        <RefreshIcon size={15} className={loading ? 'spin' : undefined} />
      </button>
      <AppearanceMenu appearance={appearance} onChange={onAppearanceChange} />
    </div>
  </header>
);
