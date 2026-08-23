/**
 * Announcements for assistive technology.
 *
 * Edits on a canvas are silent to a screen reader: a node appearing 300px to
 * the right produces no output at all. Every operation therefore also emits a
 * sentence here, which is why `describe()` sits beside the operations rather
 * than in the UI layer.
 *
 * Two regions, because urgency differs: `polite` waits for a pause, `assertive`
 * interrupts. Errors interrupt; ordinary edits do not.
 */

import { useEffect, useState } from "react";

/** Visually hidden, but present in the accessibility tree. */
const visuallyHidden: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

interface Props {
  message: string | null;
  error: string | null;
}

export function LiveRegion({ message, error }: Props) {
  // Re-announce an identical consecutive message by briefly clearing the node;
  // screen readers ignore a write that does not change the text, so moving two
  // nodes in a row would otherwise announce only once.
  const [polite, setPolite] = useState("");

  useEffect(() => {
    if (!message) return;
    setPolite("");
    const id = window.setTimeout(() => setPolite(message), 50);
    return () => window.clearTimeout(id);
  }, [message]);

  return (
    <>
      <div role="status" aria-live="polite" aria-atomic="true" style={visuallyHidden}>
        {polite}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true" style={visuallyHidden}>
        {error ?? ""}
      </div>
    </>
  );
}
