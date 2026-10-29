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

import type { PendingEnd } from "../types";
import { Explanation } from "./Explain";

interface Props {
  active: boolean;
  pending: PendingEnd | null;
  /** Fewer than two devices means there is nothing to connect. */
  enabled: boolean;
  onToggle: () => void;
}

function instructionFor(active: boolean, enabled: boolean, pending: PendingEnd | null): string {
  if (!active) {
    return enabled
      ? "Draw links between devices by clicking one, then another."
      : "Add at least two devices before connecting them.";
  }
  if (pending === null) {
    return "Choose the first device. Press Escape to leave connect mode.";
  }
  return pending.kind === "device"
    ? `${pending.name} selected. Now choose another device, or a collision domain to join. Press Escape to cancel.`
    : `Collision domain ${pending.name} selected. Now choose a device to add to it. Press Escape to cancel.`;
}

export function ConnectModeBar({ active, pending, enabled, onToggle }: Props) {
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
      <p className="connect-mode__instruction">{instructionFor(active, enabled, pending)}</p>

      {active && (
        <Explanation className="connect-mode__instruction">
          To add a device to an existing network, click the device and then the link or
          collision domain it should join.
        </Explanation>
      )}
    </div>
  );
}
