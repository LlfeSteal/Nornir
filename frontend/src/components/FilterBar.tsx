import React from 'react';
import { FilterMenu } from './FilterMenu';
import { BlockedIcon, ClearIcon, SearchIcon } from './Icons';
import { GanttTaskType } from '../types/gantt';
import { DEFAULT_FILTERS, FilterOption, Filters, HEALTH_OPTIONS, isFiltering } from '../utils/filters';
import { HealthStatus } from '../types/gantt';

const TYPES: { value: GanttTaskType; label: string }[] = [
  { value: 'milestone', label: 'Milestones' },
  { value: 'epic', label: 'Epics' },
  { value: 'issue', label: 'Issues' },
];

interface Props {
  filters: Filters;
  onChange: (filters: Filters) => void;
  labels: FilterOption[];
}

/** Picks the items to show: search field, item types (all pressed by default, none = nothing),
 * labels, health status and blocked items. */
export const FilterBar: React.FC<Props> = ({ filters, onChange, labels }) => {
  const toggleType = (type: GanttTaskType) =>
    onChange({
      ...filters,
      types: filters.types.includes(type) ? filters.types.filter((t) => t !== type) : [...filters.types, type],
    });

  return (
    <div className="filter-bar" role="search" aria-label="Filters">
      <div className="search-field">
        <SearchIcon size={14} />
        <input
          type="text"
          placeholder="Search"
          aria-label="Search"
          value={filters.search}
          onChange={(event) => onChange({ ...filters, search: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && filters.search) onChange({ ...filters, search: '' });
          }}
        />
        {filters.search && (
          <button
            type="button"
            className="search-clear"
            aria-label="Clear search"
            onClick={() => onChange({ ...filters, search: '' })}
          >
            <ClearIcon size={14} />
          </button>
        )}
      </div>
      <div className="toggle-group" role="group" aria-label="Show">
        {TYPES.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            aria-pressed={filters.types.includes(value)}
            onClick={() => toggleType(value)}
          >
            <span className="type-dot" style={{ background: `var(--${value})` }} />
            {label}
          </button>
        ))}
      </div>
      <FilterMenu
        label="Labels"
        plural="labels"
        options={labels}
        selected={filters.labels}
        onChange={(values) => onChange({ ...filters, labels: values })}
        emptyText="No labels in this group"
      />
      <FilterMenu
        label="Health"
        plural="statuses"
        options={HEALTH_OPTIONS}
        selected={filters.health}
        onChange={(values) => onChange({ ...filters, health: values as HealthStatus[] })}
        emptyText="No health status"
      />
      <button
        type="button"
        className="button"
        aria-pressed={filters.blocked}
        onClick={() => onChange({ ...filters, blocked: !filters.blocked })}
      >
        <BlockedIcon size={13} />
        Blocked
      </button>
      {isFiltering(filters) && (
        <button type="button" className="button plain" onClick={() => onChange(DEFAULT_FILTERS)}>
          Clear
        </button>
      )}
    </div>
  );
};
