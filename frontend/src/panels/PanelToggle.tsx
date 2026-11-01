/**
 * Hiding a side panel completely, and showing it again (the tester's
 * note 6), so the canvas can have the whole window.
 *
 * A hidden panel leaves a strip the height of the window at its edge, saying
 * what it brings back: one press, from the pointer or the keyboard. Focus moves
 * with the press, to the strip or back to the panel's own Hide button, so a
 * keyboard user is never left on a control that has just gone.
 */

import type { PanelSide } from "./PanelSection";

/** The ids the two controls carry, so App can move focus between them. */
export const hideButtonId = (side: PanelSide) => `hide-panel-${side}`;
export const showStripId = (side: PanelSide) => `show-panel-${side}`;

interface Props {
  side: PanelSide;
  /** "devices" or "details": what the panel is called in the controls. */
  name: string;
  onToggle: () => void;
}

export function HidePanelButton({ side, name, onToggle }: Props) {
  return (
    <div className={`panel__bar panel__bar--${side}`}>
      <button
        type="button"
        id={hideButtonId(side)}
        className="panel__hide"
        aria-label={`Hide the ${name} panel`}
        onClick={onToggle}
      >
        {side === "left" ? (
          <>
            <span aria-hidden="true">«</span> Hide
          </>
        ) : (
          <>
            Hide <span aria-hidden="true">»</span>
          </>
        )}
      </button>
    </div>
  );
}

export function ShowPanelStrip({ side, name, onToggle }: Props) {
  // A landmark of its own, as the panel was: a control outside every
  // landmark is one a landmark-by-landmark reader never meets.
  return (
    <aside className={`panel-strip panel-strip--${side}`} aria-label={`The ${name} panel, hidden`}>
      <button type="button" id={showStripId(side)} className="panel-strip__button" onClick={onToggle}>
        <span aria-hidden="true">{side === "left" ? "»" : "«"}</span> Show {name} panel
      </button>
    </aside>
  );
}
