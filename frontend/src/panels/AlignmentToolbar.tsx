/**
 * Tidying a selection.
 *
 * Buttons rather than drag-guides: alignment must be reachable without a
 * pointer, and this is the "Untangling a Messy Workspace" case from the
 * specification (Capability 9, Scenario C) at small scale.
 *
 * Each control is disabled — with the reason stated — until the selection is
 * large enough, so the user is never left wondering why nothing happened.
 */

import {
  ALIGNMENT_LABELS,
  type AlignmentAction,
  minimumSelection,
} from "../store/alignment";

const GROUPS: { legend: string; actions: AlignmentAction[] }[] = [
  { legend: "Align", actions: ["left", "centerX", "right", "top", "centerY", "bottom"] },
  { legend: "Distribute", actions: ["distributeX", "distributeY"] },
];

interface Props {
  selectionCount: number;
  /** Devices in the topology, whether selected or not. */
  deviceCount: number;
  busy?: boolean;
  onAlign: (action: AlignmentAction) => void;
  onAutoArrange: () => void;
}

export function AlignmentToolbar({
  selectionCount,
  deviceCount,
  busy,
  onAlign,
  onAutoArrange,
}: Props) {
  return (
    <>
      <h2 className="panel__heading" id="align-heading">
        Arrange
      </h2>

      <p className="alignment__hint">
        {selectionCount < 2
          ? "Select two or more devices to align them. Hold Ctrl or Cmd to add to the selection."
          : `${selectionCount} devices selected.`}
      </p>

      <fieldset className="field field--group">
        <legend>Whole topology</legend>
        <div className="alignment__buttons">
          <button
            type="button"
            onClick={onAutoArrange}
            disabled={busy || deviceCount < 2}
            title={deviceCount < 2 ? "Needs at least two devices" : undefined}
          >
            {busy ? "Arranging…" : "Tidy layout"}
          </button>
        </div>
        <p className="alignment__hint">
          Lays every device out in layers with as few link crossings as it can. Applied
          automatically to a lab imported without a saved layout.
        </p>
      </fieldset>

      {GROUPS.map((group) => (
        <fieldset key={group.legend} className="field field--group">
          <legend>{group.legend}</legend>
          <div className="alignment__buttons">
            {group.actions.map((action) => {
              const required = minimumSelection(action);
              const enabled = selectionCount >= required;
              return (
                <button
                  key={action}
                  type="button"
                  onClick={() => onAlign(action)}
                  disabled={!enabled}
                  // Explain the disabled state rather than leaving it inert
                  // and unexplained to a screen-reader user.
                  title={
                    enabled ? undefined : `Needs at least ${required} devices selected`
                  }
                >
                  {ALIGNMENT_LABELS[action]}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
    </>
  );
}
