import React, { useEffect, useRef, useState } from 'react';
import { Appearance } from '../utils/appearance';
import { AutoAppearanceIcon, CheckIcon, MoonIcon, SunIcon } from './Icons';

const OPTIONS: { value: Appearance; label: string; Icon: typeof SunIcon }[] = [
  { value: 'system', label: 'Automatic', Icon: AutoAppearanceIcon },
  { value: 'light', label: 'Light', Icon: SunIcon },
  { value: 'dark', label: 'Dark', Icon: MoonIcon },
];

interface Props {
  appearance: Appearance;
  onChange: (appearance: Appearance) => void;
}

/** Toolbar button with a macOS-style menu to pick the appearance. */
export const AppearanceMenu: React.FC<Props> = ({ appearance, onChange }) => {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const current = OPTIONS.find((o) => o.value === appearance) ?? OPTIONS[0];

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) button.current?.focus();
  };

  // Focus the checked item when the menu opens; close on a click outside.
  useEffect(() => {
    if (!open) return;
    items.current[OPTIONS.indexOf(current)]?.focus();
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
      items.current[(index + step + OPTIONS.length) % OPTIONS.length]?.focus();
    }
  };

  return (
    <div className="menu-anchor" ref={anchor}>
      <button
        ref={button}
        type="button"
        className="button icon"
        aria-label="Appearance"
        title={`Appearance: ${current.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        data-appearance={appearance}
        onClick={() => setOpen((value) => !value)}
      >
        <current.Icon size={15} />
      </button>
      {open && (
        <div className="menu" role="menu" aria-label="Appearance" onKeyDown={onMenuKeyDown}>
          <div className="menu-header" aria-hidden="true">
            Appearance
          </div>
          {OPTIONS.map(({ value, label, Icon }, index) => (
            <button
              key={value}
              ref={(element) => (items.current[index] = element)}
              type="button"
              role="menuitemradio"
              aria-checked={value === appearance}
              className="menu-item"
              onClick={() => {
                onChange(value);
                close(true);
              }}
            >
              <Icon size={14} />
              {label}
              <CheckIcon size={13} className="check" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
