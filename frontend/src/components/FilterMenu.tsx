import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FilterOption, normalizeText } from '../utils/filters';
import { CheckIcon, ChevronDownIcon, SearchIcon } from './Icons';

// Long lists get a search field at the top of the popover.
const SEARCH_THRESHOLD = 8;

interface Props {
  label: string; // button text when nothing is selected, e.g. "Labels"
  plural: string; // e.g. "labels", for "3 labels"
  options: FilterOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  emptyText: string; // shown when there are no options at all
}

/** Pop-up button with a macOS-style popover of checkable options: pick one or several. */
export const FilterMenu: React.FC<Props> = ({ label, plural, options, selected, onChange, emptyText }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const anchor = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const searchable = options.length >= SEARCH_THRESHOLD;

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    setQuery('');
    if (restoreFocus) button.current?.focus();
  };

  const shown = useMemo(() => {
    const text = normalizeText(query.trim());
    return text
      ? options.filter((o) => normalizeText(o.label).includes(text) || (!!o.context && normalizeText(o.context).includes(text)))
      : options;
  }, [options, query]);

  const optionButtons = () => Array.from(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);

  // Focus the search field (or the first option) when the popover opens; close on a click
  // outside.
  useEffect(() => {
    if (!open) return;
    if (search.current) search.current.focus();
    else optionButtons()[0]?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const items = optionButtons();
      const index = items.findIndex((item) => item === document.activeElement);
      if (event.key === 'ArrowUp' && index <= 0) {
        (search.current ?? items[items.length - 1])?.focus();
        return;
      }
      const step = event.key === 'ArrowDown' ? 1 : -1;
      items[index === -1 ? 0 : (index + step + items.length) % items.length]?.focus();
    }
  };

  // Close when the focus leaves the popover (Tab, or a click elsewhere in the page).
  const onBlur = (event: React.FocusEvent) => {
    if (open && !anchor.current?.contains(event.relatedTarget as Node | null)) close(false);
  };

  const optionLabel = (value: string) => options.find((o) => o.value === value)?.label ?? value;
  const text = selected.length === 0 ? label : selected.length === 1 ? optionLabel(selected[0]) : `${selected.length} ${plural}`;
  let section: string | undefined;

  return (
    <div className="menu-anchor" ref={anchor} onBlur={onBlur}>
      <button
        ref={button}
        type="button"
        className="button popup-button"
        aria-label={selected.length > 0 ? `${label}: ${text}` : label}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-active={selected.length > 0 ? 'true' : undefined}
        title={selected.length > 1 ? selected.map(optionLabel).join(', ') : undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <span className="popup-button-text">{text}</span>
        <ChevronDownIcon size={12} />
      </button>
      {open && (
        <div className="menu filter-popover" role="dialog" aria-label={label} onKeyDown={onKeyDown}>
          {searchable && (
            <div className="menu-search">
              <SearchIcon size={13} />
              <input
                ref={search}
                type="text"
                placeholder={`Search ${plural}`}
                aria-label={`Search ${plural}`}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          )}
          <div ref={list} className="filter-options" role="listbox" aria-label={label} aria-multiselectable="true">
            {shown.length === 0 && <div className="menu-empty">{options.length === 0 ? emptyText : 'No match'}</div>}
            {shown.map((option) => {
              const header = option.section !== section && option.section;
              section = option.section;
              const checked = selected.includes(option.value);
              return (
                <React.Fragment key={option.value}>
                  {header && (
                    <div className="menu-header" role="presentation">
                      {header}
                    </div>
                  )}
                  <button
                    type="button"
                    role="option"
                    aria-selected={checked}
                    aria-label={option.label}
                    className="menu-item"
                    style={option.depth && !query.trim() ? ({ '--depth': option.depth } as React.CSSProperties) : undefined}
                    onClick={() => toggle(option.value)}
                  >
                    <CheckIcon size={13} className="check" />
                    {option.color && <span className="label-dot" style={{ background: option.color }} />}
                    <span className="menu-item-label">{option.label}</span>
                    {option.detail && <span className="menu-item-detail">{option.detail}</span>}
                    {option.context && query.trim() && <span className="menu-item-detail menu-item-context">{option.context}</span>}
                  </button>
                </React.Fragment>
              );
            })}
          </div>
          {selected.length > 0 && (
            <div className="menu-footer">
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  onChange([]);
                  // This button goes away: keep the focus in the popover.
                  (search.current ?? optionButtons()[0])?.focus();
                }}
              >
                Deselect all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
