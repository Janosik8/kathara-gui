/**
 * The connect mode control and its running commentary.
 *
 * Modes are risky in an interface: a click can suddenly mean something other
 * than it did a moment ago. Three things keep this one honest —
 *
 *  - the toggle is a real `aria-pressed` button, so its state is perceivable
 *    rather than implied by a cursor change;
 *  - a persistent bar states what the next click will do, in words;
 *  - Escape always leaves, and the bar says so.
 *
 * The same mode drives clicks on the canvas and Enter in the tree, so pointer
 * and keyboard users share one mental model instead of getting separate
 * mechanisms that behave differently.
 */

interface Props {
  active: boolean;
  pending: string | null;
  /** Fewer than two devices means there is nothing to connect. */
  enabled: boolean;
  onToggle: () => void;
}

export function ConnectModeBar({ active, pending, enabled, onToggle }: Props) {
  const instruction = !active
    ? enabled
      ? "Draw links between devices by clicking one, then another."
      : "Add at least two devices before connecting them."
    : pending
      ? `${pending} selected. Now choose the device to link it to. Press Escape to cancel.`
      : "Choose the first device. Press Escape to leave connect mode.";

  return (
    <div className="connect-mode">
      <button
        type="button"
        onClick={onToggle}
        disabled={!enabled}
        aria-pressed={active}
        className="connect-mode__toggle"
      >
        {/* Shape and label carry the state; the highlight is only a reinforcement. */}
        <span aria-hidden="true">{active ? "◉" : "○"}</span> Connect mode
        <kbd className="connect-mode__key">C</kbd>
      </button>

      {/* Not a live region: the same sentence is announced through the app's
          existing polite region, and two announcements would double up. */}
      <p className="connect-mode__instruction">{instruction}</p>
    </div>
  );
}
