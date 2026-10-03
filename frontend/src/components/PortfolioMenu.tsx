import React, { useEffect, useRef, useState } from 'react';
import {
  addPortfolio,
  deletePortfolio,
  matchingPortfolio,
  nameProblem,
  newPortfolioId,
  Portfolio,
  Portfolios,
  renamePortfolio,
  setDefault,
  updateView,
} from '../utils/portfolios';
import { CheckIcon, ChevronDownIcon } from './Icons';

interface Props {
  portfolios: Portfolios;
  onPortfoliosChange: (change: (state: Portfolios) => Portfolios) => void;
  currentKey: string; // viewKey of the view shown: filters, period and time scale
  onApply: (query: string | undefined) => void; // shows a portfolio's view; undefined clears the filters
  activeId?: string; // the portfolio last applied or saved, to tell when it is edited
  onActiveChange: (id: string | undefined) => void;
}

type Mode = { kind: 'menu' } | { kind: 'save' } | { kind: 'rename' } | { kind: 'delete' };

/** Pop-up button to pick, save and manage portfolios: named saved views (filters, period and
 * time scale). Its button names the portfolio shown: the one whose view this is, or the one
 * applied last, "edited" since. */
export const PortfolioMenu: React.FC<Props> = ({ portfolios, onPortfoliosChange, currentKey, onApply, activeId, onActiveChange }) => {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>({ kind: 'menu' });
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string>();
  const anchor = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);

  const match = matchingPortfolio(portfolios, currentKey);
  const active = portfolios.portfolios.find((p) => p.id === activeId);
  const edited = !match && !!active;
  const current: Portfolio | undefined = match ?? (edited ? active : undefined);
  const text = match ? match.name : edited ? `${active!.name} (edited)` : undefined;

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    setMode({ kind: 'menu' });
    setProblem(undefined);
    if (restoreFocus) button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    if (field.current) field.current.focus();
    else popover.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
  }, [open, mode]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = (portfolio: Portfolio | undefined) => {
    onApply(portfolio?.query);
    onActiveChange(portfolio?.id);
    close(true);
  };

  const startNaming = (kind: 'save' | 'rename') => {
    setName(kind === 'rename' && current ? current.name : '');
    setProblem(undefined);
    setMode({ kind });
  };

  const submitName = (event: React.FormEvent) => {
    event.preventDefault();
    const except = mode.kind === 'rename' ? current?.id : undefined;
    const why = nameProblem(portfolios, name, except);
    if (why) {
      setProblem(why);
      return;
    }
    if (mode.kind === 'rename' && current) {
      onPortfoliosChange((state) => renamePortfolio(state, current.id, name));
    } else {
      const id = newPortfolioId();
      onPortfoliosChange((state) => addPortfolio(state, { id, name, query: currentKey }));
      onActiveChange(id);
    }
    close(true);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    if (mode.kind === 'menu') close(true);
    else setMode({ kind: 'menu' });
  };

  // Close when the focus leaves the popover (Tab, or a click elsewhere in the page).
  const onBlur = (event: React.FocusEvent) => {
    if (open && !anchor.current?.contains(event.relatedTarget as Node | null)) close(false);
  };

  return (
    <div className="menu-anchor" ref={anchor} onBlur={onBlur}>
      <button
        ref={button}
        type="button"
        className="button popup-button"
        aria-label={text ? `Portfolio: ${text}` : 'Portfolio'}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-active={text ? 'true' : undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <span className="popup-button-text">{text ? `Portfolio: ${text}` : 'Portfolio'}</span>
        <ChevronDownIcon size={12} />
      </button>
      {open && (
        <div ref={popover} className="menu filter-popover portfolio-popover" role="dialog" aria-label="Portfolio" onKeyDown={onKeyDown}>
          {mode.kind === 'menu' && (
            <>
              <div className="menu-header" aria-hidden="true">
                Portfolios
              </div>
              <div role="menu" aria-label="Portfolios">
                <button type="button" role="menuitemradio" aria-checked={!match && !edited} className="menu-item" onClick={() => apply(undefined)}>
                  <CheckIcon size={13} className="check" />
                  <span className="menu-item-label">No portfolio</span>
                  <span className="menu-item-detail">Clears the filters</span>
                </button>
                {portfolios.portfolios.map((portfolio) => (
                  <button
                    key={portfolio.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={portfolio === match}
                    className="menu-item"
                    onClick={() => apply(portfolio)}
                  >
                    <CheckIcon size={13} className="check" />
                    <span className="menu-item-label">{portfolio.name}</span>
                    {portfolio.id === portfolios.defaultId && <span className="menu-item-detail">Default</span>}
                  </button>
                ))}
              </div>
              {portfolios.portfolios.length === 0 && (
                <div className="menu-empty">Set filters, a period and a scale, then save them here.</div>
              )}
              <div className="menu-footer">
                <button type="button" className="menu-item" disabled={!!match} onClick={() => startNaming('save')}>
                  Save as portfolio…
                </button>
                {current && (
                  <>
                    {edited && (
                      <button
                        type="button"
                        className="menu-item"
                        onClick={() => {
                          onPortfoliosChange((state) => updateView(state, current.id, currentKey));
                          close(true);
                        }}
                      >
                        Save changes to “{current.name}”
                      </button>
                    )}
                    <button type="button" className="menu-item" onClick={() => startNaming('rename')}>
                      Rename “{current.name}”…
                    </button>
                    <button
                      type="button"
                      className="menu-item"
                      onClick={() => {
                        const isDefault = current.id === portfolios.defaultId;
                        onPortfoliosChange((state) => setDefault(state, isDefault ? undefined : current.id));
                        close(true);
                      }}
                    >
                      {current.id === portfolios.defaultId ? 'Stop using as default' : 'Use as default'}
                    </button>
                    <button type="button" className="menu-item" onClick={() => setMode({ kind: 'delete' })}>
                      Delete “{current.name}”…
                    </button>
                  </>
                )}
              </div>
            </>
          )}
          {(mode.kind === 'save' || mode.kind === 'rename') && (
            <form className="menu-form" onSubmit={submitName}>
              <div className="menu-header">{mode.kind === 'save' ? 'New portfolio' : `Rename “${current?.name}”`}</div>
              <div className="menu-search">
                <input
                  ref={field}
                  type="text"
                  placeholder="Name"
                  aria-label="Portfolio name"
                  aria-invalid={problem ? true : undefined}
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setProblem(undefined);
                  }}
                />
              </div>
              {problem && (
                <div className="menu-problem" role="alert">
                  {problem}
                </div>
              )}
              <div className="menu-actions">
                <button type="button" className="button" onClick={() => setMode({ kind: 'menu' })}>
                  Cancel
                </button>
                <button type="submit" className="button primary">
                  {mode.kind === 'save' ? 'Save' : 'Rename'}
                </button>
              </div>
            </form>
          )}
          {mode.kind === 'delete' && current && (
            <div className="menu-form">
              <div className="menu-confirm">Delete “{current.name}”? The view shown stays as it is.</div>
              <div className="menu-actions">
                <button type="button" className="button" onClick={() => setMode({ kind: 'menu' })}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="button destructive"
                  onClick={() => {
                    onPortfoliosChange((state) => deletePortfolio(state, current.id));
                    onActiveChange(undefined);
                    close(true);
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
