import React, { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { GanttTask } from '../types/gantt';
import { DependencyIndex, dependencySubgraph } from '../utils/dependencies';
import { ViewMode } from '../utils/timeline';
import { GanttChart } from './GanttChart';
import { SegmentedControl } from './SegmentedControl';
import { VIEW_MODES } from './Toolbar';

interface Props {
  node: GanttTask;
  index: DependencyIndex;
  viewMode: ViewMode;
  onClose: () => void;
}

/** The dependencies of a row and its descendants, in a modal sheet: a flat chart of the items
 * involved, with an arrow from each blocker to what it blocks. Items linked from elsewhere in
 * the group, or from outside it, are grayed and say where they sit. */
export const DependencyDialog: React.FC<Props> = ({ node, index, viewMode: initialViewMode, onClose }) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [viewMode, setViewMode] = useState(initialViewMode);
  const graph = useMemo(() => dependencySubgraph(index, node), [index, node]);
  const data = useMemo(() => graph.rows.map((row) => row.node), [graph]);
  // The chart scrolls inside the sheet: never unbounded (see GanttChart).
  const height = Math.max(240, Math.floor(window.innerHeight * 0.7));

  // The chart is laid out once the dialog is open: closed, it has no size, and the chart
  // couldn't center on today.
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    setOpen(true);
    return () => element?.close();
  }, []);

  // A click on the backdrop targets the dialog itself, like one in its own empty areas (the
  // chart's side margins): tell them apart by the dialog's box. Both the press and the release
  // must be outside, so a selection dragged out of the sheet doesn't close it.
  const pressedOutside = useRef(false);
  const outside = (event: React.MouseEvent) => {
    const box = event.currentTarget.getBoundingClientRect();
    return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
  };

  const links = graph.links.length;
  return (
    // Escape closes the dialog natively, which fires `close`; so do Close and a click outside.
    <dialog
      ref={dialog}
      className="dependency-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      onMouseDown={(event) => {
        pressedOutside.current = outside(event);
      }}
      onClick={(event) => {
        if (pressedOutside.current && outside(event)) dialog.current?.close();
      }}
    >
      <header className="dependency-dialog-header">
        <div className="dependency-dialog-title">
          <h2 id={titleId}>Dependencies of {node.name}</h2>
          <p>
            {links} {links === 1 ? 'link' : 'links'} · {graph.rows.length} items
            {graph.critical > 0 && ` · critical path of ${graph.critical}`}
          </p>
        </div>
        <SegmentedControl label="Time scale" options={VIEW_MODES} value={viewMode} onChange={setViewMode} />
        <button type="button" className="button" onClick={() => dialog.current?.close()}>
          Close
        </button>
      </header>
      {open && <GanttChart data={data} viewMode={viewMode} range={null} dependencies={graph} height={height} />}
      <div className="legend" aria-label="Dependencies legend">
        {graph.critical > 0 && (
          <span className="legend-item">
            <span className="legend-arrow critical" />
            Critical path
          </span>
        )}
        <span className="legend-item">
          <span className="legend-arrow" />
          Blocks
        </span>
        <span className="legend-item">
          <span className="legend-arrow conflict" />
          Starts before its blocker ends
        </span>
        <span className="legend-item">
          <span className="legend-swatch linked" />
          Elsewhere or outside the group
        </span>
      </div>
    </dialog>
  );
};
