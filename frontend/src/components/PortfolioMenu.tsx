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
import { CheckIcon, ChevronDownIcon, PencilIcon, StarIcon, TrashIcon } from './Icons';

interface Props {
  portfolios: Portfolios;
  onPortfoliosChange: (change: (state: Portfolios) => Portfolios) => void;
  currentKey: string; // viewKey of the view shown: filters, period and time scale
  onApply: (query: string | undefined) => void; // shows a portfolio's view; undefined clears the filters
  activeId?: string; // the portfolio last applied or saved, to tell when it is edited
  onActiveChange: (id: string | undefined) => void;
}

/** Pop-up button to pick and manage portfolios: named saved views (filters, period and time
 * scale). Like a macOS menu with editable rows: each portfolio's row has a star (the default),
 * a pencil (rename in place, also with F2; not on double-click: a click applies the portfolio
 * and closes the menu) and a bin (asks on the row). The
 * footer saves the view as a new portfolio, or updates the one shown once it was changed. The
 * button names the portfolio whose view this is, or the one applied last, "edited" since. */
export const PortfolioMenu: React.FC<Props> = ({ portfolios, onPortfoliosChange, currentKey, onApply, activeId, onActiveChange }) => {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string>();
  const anchor = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);

  const match = matchingPortfolio(portfolios, currentKey);
  const active = portfolios.portfolios.find((p) => p.id === activeId);
  const edited = !match && active ? active : undefined;
  const text = match ? match.name : edited ? `${edited.name} (edited)` : undefined;
  // A view that is a portfolio's (opened from a link, the default, or set by hand) makes it the
  // active one, so that changing it afterwards reads "edited".
  useEffect(() => {
    if (match && match.id !== activeId) onActiveChange(match.id);
  }, [match?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    setSaving(false);
    setProblem(undefined);
    if (restoreFocus) button.current?.focus();
  };

  // Focus the name field when saving, otherwise the first item.
  const focusFirst = () => popover.current?.querySelector<HTMLElement>('[role="menuitemradio"]')?.focus();
  useEffect(() => {
    if (!open) return;
    if (field.current) field.current.focus();
    else focusFirst();
  }, [open, saving]);

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

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    const why = nameProblem(portfolios, name);
    if (why) {
      setProblem(why);
      return;
    }
    const id = newPortfolioId();
    onPortfoliosChange((state) => addPortfolio(state, { id, name, query: currentKey }));
    onActiveChange(id);
    close(true);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    if (saving) setSaving(false);
    else close(true);
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
        {/* The name may be cut; "edited" never is. */}
        <span className="popup-button-text">{match || edited ? `Portfolio: ${(match ?? edited)!.name}` : 'Portfolio'}</span>
        {edited && <span className="popup-button-note">(edited)</span>}
        <ChevronDownIcon size={12} />
      </button>
      {open && (
        <div ref={popover} className="menu filter-popover portfolio-popover" role="dialog" aria-label="Portfolio" onKeyDown={onKeyDown}>
          {!saving && (
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
                  <PortfolioRow
                    key={portfolio.id}
                    portfolio={portfolio}
                    checked={portfolio === match}
                    isDefault={portfolio.id === portfolios.defaultId}
                    onApply={() => apply(portfolio)}
                    onToggleDefault={() =>
                      onPortfoliosChange((state) => setDefault(state, state.defaultId === portfolio.id ? undefined : portfolio.id))
                    }
                    renameProblem={(value) => nameProblem(portfolios, value, portfolio.id)}
                    onRename={(value) => onPortfoliosChange((state) => renamePortfolio(state, portfolio.id, value))}
                    onDelete={() => {
                      onPortfoliosChange((state) => deletePortfolio(state, portfolio.id));
                      if (portfolio.id === activeId) onActiveChange(undefined);
                      // The row goes away: keep the focus in the menu.
                      requestAnimationFrame(focusFirst);
                    }}
                  />
                ))}
              </div>
              {portfolios.portfolios.length === 0 && (
                <div className="menu-empty">Set filters, a period and a scale, then save them here.</div>
              )}
              <div className="menu-footer">
                {edited ? (
                  <button
                    type="button"
                    className="menu-item"
                    onClick={() => {
                      onPortfoliosChange((state) => updateView(state, edited.id, currentKey));
                      close(true);
                    }}
                  >
                    Update “{edited.name}”
                  </button>
                ) : (
                  <button
                    type="button"
                    className="menu-item"
                    disabled={!!match}
                    onClick={() => {
                      setName('');
                      setProblem(undefined);
                      setSaving(true);
                    }}
                  >
                    Save as portfolio…
                  </button>
                )}
              </div>
            </>
          )}
          {saving && (
            <form className="menu-form" onSubmit={save}>
              <div className="menu-header">New portfolio</div>
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
                <button type="button" className="button" onClick={() => setSaving(false)}>
                  Cancel
                </button>
                <button type="submit" className="button primary">
                  Save
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
};

interface RowProps {
  portfolio: Portfolio;
  checked: boolean; // its view is the one shown
  isDefault: boolean;
  onApply: () => void;
  onToggleDefault: () => void;
  renameProblem: (name: string) => string | undefined;
  onRename: (name: string) => void;
  onDelete: () => void;
}

/** One portfolio in the menu: picks it; its trailing buttons (shown on hover or focus, the
 * default's star always) make it the default, rename it in place and delete it, asking on the
 * row first. Escape inside the row only leaves the rename or the question. */
const PortfolioRow: React.FC<RowProps> = ({ portfolio, checked, isDefault, onApply, onToggleDefault, renameProblem, onRename, onDelete }) => {
  const [state, setState] = useState<'idle' | 'rename' | 'confirm'>('idle');
  const [name, setName] = useState(portfolio.name);
  const [problem, setProblem] = useState<string>();
  const item = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const done = useRef(false); // the rename was committed or dropped: ignore the blur that follows

  useEffect(() => {
    if (state === 'rename') {
      input.current?.focus();
      input.current?.select();
    } else if (state === 'confirm') cancel.current?.focus();
  }, [state]);

  const startRename = () => {
    setName(portfolio.name);
    setProblem(undefined);
    done.current = false;
    setState('rename');
  };
  const backToIdle = () => {
    setState('idle');
    requestAnimationFrame(() => item.current?.focus());
  };
  const commit = (keepOnProblem: boolean) => {
    if (done.current) return;
    const why = name.trim() === portfolio.name ? undefined : renameProblem(name);
    if (why && keepOnProblem) {
      setProblem(why);
      return;
    }
    done.current = true;
    if (!why && name.trim() !== portfolio.name) onRename(name);
    backToIdle();
  };
  const onRowKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape' && state !== 'idle') {
      event.preventDefault();
      event.stopPropagation();
      done.current = true;
      backToIdle();
    }
  };

  if (state === 'rename') {
    return (
      <div className="portfolio-row" data-editing="true" onKeyDown={onRowKeyDown}>
        <CheckIcon size={13} className="check" />
        <div className="menu-search portfolio-rename">
          <input
            ref={input}
            type="text"
            aria-label="Portfolio name"
            aria-invalid={problem ? true : undefined}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setProblem(undefined);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commit(true);
              }
            }}
            onBlur={() => commit(false)}
          />
        </div>
        {problem && (
          <div className="menu-problem portfolio-problem" role="alert">
            {problem}
          </div>
        )}
      </div>
    );
  }

  if (state === 'confirm') {
    return (
      <div className="portfolio-row" data-confirm="true" onKeyDown={onRowKeyDown}>
        <span className="portfolio-confirm">Delete “{portfolio.name}”?</span>
        <button ref={cancel} type="button" className="button" onClick={backToIdle}>
          Cancel
        </button>
        <button type="button" className="button destructive" onClick={onDelete}>
          Delete
        </button>
      </div>
    );
  }

  return (
    <div className="portfolio-row" data-default={isDefault ? 'true' : undefined}>
      <button
        ref={item}
        type="button"
        role="menuitemradio"
        aria-checked={checked}
        aria-keyshortcuts="F2"
        className="menu-item"
        onClick={onApply}
        onKeyDown={(event) => {
          if (event.key === 'F2') {
            event.preventDefault();
            startRename();
          }
        }}
      >
        <CheckIcon size={13} className="check" />
        <span className="menu-item-label">{portfolio.name}</span>
      </button>
      <span className="portfolio-row-actions">
        <button
          type="button"
          className="portfolio-action"
          data-action="default"
          aria-pressed={isDefault}
          aria-label={isDefault ? `Stop using “${portfolio.name}” as default` : `Use “${portfolio.name}” as default`}
          title={isDefault ? 'Default portfolio: opens with Nornir' : 'Use as default'}
          onClick={onToggleDefault}
        >
          <StarIcon size={14} filled={isDefault} />
        </button>
        <button type="button" className="portfolio-action" aria-label={`Rename “${portfolio.name}”`} title="Rename" onClick={startRename}>
          <PencilIcon size={14} />
        </button>
        <button
          type="button"
          className="portfolio-action"
          aria-label={`Delete “${portfolio.name}”`}
          title="Delete"
          onClick={() => setState('confirm')}
        >
          <TrashIcon size={14} />
        </button>
      </span>
    </div>
  );
};
