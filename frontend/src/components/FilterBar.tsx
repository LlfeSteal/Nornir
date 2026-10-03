import React, { useEffect, useState } from 'react';
import { FilterMenu } from './FilterMenu';
import { BlockedIcon, ClearIcon, LinkIcon, SearchIcon } from './Icons';
import { PortfolioMenu } from './PortfolioMenu';
import { Portfolios } from '../utils/portfolios';
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
  items: FilterOption[]; // the milestones and epics a portfolio can hold
  portfolios: Portfolios;
  onPortfoliosChange: (change: (state: Portfolios) => Portfolios) => void;
  activePortfolio?: string;
  onActivePortfolioChange: (id: string | undefined) => void;
  shareLink: () => string; // the URL of the view, for Copy link
}

/** Picks the items to show: a portfolio (named set of milestones and epics, picked in Items),
 * search field, item types (all pressed by default, none = nothing), labels, health status and
 * blocked items; then copies a link to the view. */
export const FilterBar: React.FC<Props> = ({
  filters,
  onChange,
  labels,
  items,
  portfolios,
  onPortfoliosChange,
  activePortfolio,
  onActivePortfolioChange,
  shareLink,
}) => {
  const toggleType = (type: GanttTaskType) =>
    onChange({
      ...filters,
      types: filters.types.includes(type) ? filters.types.filter((t) => t !== type) : [...filters.types, type],
    });

  return (
    <div className="filter-bar" role="search" aria-label="Filters">
      <PortfolioMenu
        portfolios={portfolios}
        onPortfoliosChange={onPortfoliosChange}
        items={filters.items}
        onItemsChange={(values) => onChange({ ...filters, items: values })}
        activeId={activePortfolio}
        onActiveChange={onActivePortfolioChange}
      />
      <FilterMenu
        label="Items"
        plural="items"
        options={items}
        selected={filters.items}
        onChange={(values) => onChange({ ...filters, items: values })}
        emptyText="No milestones or epics"
      />
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
        // The portfolio stays: it has its own "All items".
        <button type="button" className="button plain" onClick={() => onChange({ ...DEFAULT_FILTERS, items: filters.items })}>
          Clear
        </button>
      )}
      <CopyLinkButton link={shareLink} />
    </div>
  );
};

/** Copies the link of the view (period, scale, filters, portfolio items) to the clipboard. */
const CopyLinkButton: React.FC<{ link: () => string }> = ({ link }) => {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const timer = window.setTimeout(() => setState('idle'), 2000);
    return () => window.clearTimeout(timer);
  }, [state]);
  const text = state === 'copied' ? 'Link copied' : state === 'failed' ? 'Copy the address bar instead' : 'Copy link';
  return (
    <button
      type="button"
      className="button copy-link"
      data-state={state}
      onClick={() => {
        const url = link();
        // The clipboard API needs a secure context (https or localhost): on plain http, the
        // older copy command.
        if (!navigator.clipboard) {
          setState(copyWithSelection(url) ? 'copied' : 'failed');
          return;
        }
        navigator.clipboard.writeText(url).then(
          () => setState('copied'),
          () => setState(copyWithSelection(url) ? 'copied' : 'failed'),
        );
      }}
    >
      <LinkIcon size={13} />
      <span aria-live="polite">{text}</span>
    </button>
  );
};

function copyWithSelection(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
