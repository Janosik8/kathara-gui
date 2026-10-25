/**
 * The scenario's name, edited in place in the header.
 *
 * The name is not decoration. It names the lab folder, names the exported
 * file, and — because Kathará derives a lab's identity from a hash of its
 * name — decides which running containers belong to this scenario.
 *
 * That last point is why renaming is refused while the lab is up rather than
 * merely warned about. Renaming a deployed lab does not rename its containers;
 * it orphans them under the old name, leaving the user with a lab they can
 * neither see nor stop from the interface. Blocking is the honest behaviour,
 * and the message says what to do instead.
 */

import { useEffect, useRef, useState } from "react";

const REFUSAL =
  "Stop the lab before renaming it — Kathará identifies a lab by its name, so the " +
  "running containers would be left behind under the old one.";

interface Props {
  name: string;
  /** True while any container of this lab exists — running or exited. */
  deployed: boolean;
  onRename: (name: string) => void;
  /**
   * Why a name cannot be used, or null. The name is also the folder's, and
   * must not be another scenario's (test 3E.2), so a refused draft stays in
   * the field with the reason rather than being committed or thrown away.
   */
  validate?: (name: string) => string | null;
  /** Routed to the app's single live region, so the refusal is heard too. */
  onAnnounce?: (message: string) => void;
}

export function LabTitle({ name, deployed, onRename, validate, onAnnounce }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [refused, setRefused] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // Adopt a rename that came from elsewhere — opening a scenario, or an undo.
  useEffect(() => setDraft(name), [name]);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  // The refusal is transient: it answers a click, and should not linger as if
  // it were a standing fault with the scenario.
  useEffect(() => {
    if (!refused) return;
    const timer = window.setTimeout(() => setRefused(false), 6000);
    return () => window.clearTimeout(timer);
  }, [refused]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== name) {
      const reason = validate?.(trimmed) ?? null;
      if (reason) {
        setProblem(reason);
        return;
      }
      onRename(trimmed);
    } else {
      setDraft(name); // an empty name is a slip, not an instruction
    }
    setProblem(null);
    setEditing(false);
  };

  const abandon = () => {
    setDraft(name);
    setProblem(null);
    setEditing(false);
  };

  if (editing) {
    return (
      <>
        <input
          ref={input}
          className="app__lab-name app__lab-name--editing"
          aria-label="Scenario name"
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? "lab-name-problem" : undefined}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setProblem(null);
          }}
          // Leaving a refused name abandons it: the reason has been given, and
          // a header field that will not let go would trap the focus.
          onBlur={() => (problem ? abandon() : commit())}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") abandon();
            // The header owns no other shortcuts, but the window does: an
            // unstopped keystroke here would reach the global handler and, for
            // instance, delete the selected device while the user types.
            e.stopPropagation();
          }}
        />
        {problem && (
          <span className="app__rename-refused" id="lab-name-problem" role="alert">
            <strong>Invalid:</strong> {problem}
          </span>
        )}
      </>
    );
  }

  const refuse = () => {
    setRefused(true);
    onAnnounce?.(REFUSAL);
  };

  return (
    <>
      <button
        type="button"
        className="app__lab-name app__lab-name--button"
        // Says what the control does, not merely what it shows, since the
        // visible text is the name itself.
        aria-label={`Scenario name: ${name}. Rename`}
        // Deliberately not its own live region: the application already has
        // one, and a second would either be missed or would talk over it.
        // Describing the button carries the reason to anyone who lands on it
        // afterwards; the announcement above covers the moment of the click.
        aria-describedby={refused ? "lab-rename-refused" : undefined}
        onClick={() => (deployed ? refuse() : setEditing(true))}
      >
        {name}
      </button>
      {refused && (
        <span className="app__rename-refused" id="lab-rename-refused">
          {REFUSAL}
        </span>
      )}
    </>
  );
}
