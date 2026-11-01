/**
 * Explanations of what a control does, shown only on request (the tester's
 * note 4).
 *
 * The ⓘ button in the top bar turns them on. Off, the panels show button
 * labels, statuses and reasons, and nothing else, so they keep their space.
 *
 * **Only explanations go behind ⓘ.** A sentence that says what the
 * application is doing *now* — "Add a device before deploying", what the next
 * click in connect mode will do — is a status, and hiding it would hide the
 * reason a button is disabled. Such sentences stay plain paragraphs.
 */

import { type ReactNode, createContext, useContext } from "react";

export const ExplainContext = createContext(false);

/** Whether explanations are showing, for a control that points at one. */
export function useExplain(): boolean {
  return useContext(ExplainContext);
}

interface Props {
  id?: string;
  className?: string;
  children: ReactNode;
}

/** A paragraph explaining a control, rendered only while ⓘ is on. */
export function Explanation({ id, className = "field__hint", children }: Props) {
  if (!useExplain()) return null;
  return (
    <p id={id} className={className}>
      {children}
    </p>
  );
}
