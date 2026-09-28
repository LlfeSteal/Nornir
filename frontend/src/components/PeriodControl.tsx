import React, { useEffect, useRef, useState } from 'react';
import { PERIOD_PRESETS, PeriodPreset } from '../utils/period';
import { CheckIcon, ChevronDownIcon, ChevronIcon, ChevronLeftIcon } from './Icons';

interface Props {
  preset: PeriodPreset;
  label: string; // the period shown, e.g. "2026"
  onPresetChange: (preset: PeriodPreset) => void;
  onStep: (step: -1 | 1) => void;
}

/** Toolbar control picking the period shown: ‹ previous, a pull-down menu of presets
 * showing the current period, › next. */
export const PeriodControl: React.FC<Props> = ({ preset, label, onPresetChange, onStep }) => {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const current = Math.max(0, PERIOD_PRESETS.findIndex((p) => p.value === preset));
  const canStep = preset !== 'all';

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) button.current?.focus();
  };

  // Focus the checked item when the menu opens; close on a click outside.
  useEffect(() => {
    if (!open) return;
    items.current[current]?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, current]);

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    const index = items.current.findIndex((item) => item === document.activeElement);
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      items.current[(index + step + PERIOD_PRESETS.length) % PERIOD_PRESETS.length]?.focus();
    }
  };

  return (
    <div className="period-control" role="group" aria-label="Period">
      <button
        type="button"
        className="button icon"
        aria-label="Previous period"
        title="Previous period"
        disabled={!canStep}
        onClick={() => onStep(-1)}
      >
        <ChevronLeftIcon size={14} />
      </button>
      <div className="menu-anchor" ref={anchor}>
        <button
          ref={button}
          type="button"
          className="button popup-button period-button"
          aria-label={`Period: ${label}`}
          aria-haspopup="menu"
          aria-expanded={open}
          data-preset={preset}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="popup-button-text">{label}</span>
          <ChevronDownIcon size={12} />
        </button>
        {open && (
          <div className="menu period-menu" role="menu" aria-label="Period" onKeyDown={onMenuKeyDown}>
            <div className="menu-header" aria-hidden="true">
              Period
            </div>
            {PERIOD_PRESETS.map(({ value, label: text }, index) => (
              <button
                key={value}
                ref={(element) => (items.current[index] = element)}
                type="button"
                role="menuitemradio"
                aria-checked={value === preset}
                className="menu-item"
                onClick={() => {
                  onPresetChange(value);
                  close(true);
                }}
              >
                {text}
                <CheckIcon size={13} className="check" />
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        className="button icon"
        aria-label="Next period"
        title="Next period"
        disabled={!canStep}
        onClick={() => onStep(1)}
      >
        <ChevronIcon size={14} />
      </button>
    </div>
  );
};
