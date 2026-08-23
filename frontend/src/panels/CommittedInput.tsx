/**
 * A text field that reports its value only once the user has finished with it.
 *
 * Committing on every keystroke would fill the operation log and make undo
 * useless — twelve presses of Ctrl+Z to retract one rename. Enter commits,
 * Escape abandons, blur commits.
 *
 * With `validate`, an invalid draft is shown as an error and *not* committed.
 * The draft is kept rather than reverted: silently discarding what someone
 * typed is worse than holding it while telling them what is wrong. It also
 * keeps malformed values out of the shared topology, which would otherwise be
 * rejected by the server on every subsequent request.
 */

import { useEffect, useState } from "react";

interface Props {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  /** Shown beneath the field, and linked for assistive technology. */
  hint?: string;
  /** Returns a message for an unacceptable draft, or null when it is fine. */
  validate?: (value: string) => string | null;
  onCommit: (value: string) => void;
}

export function CommittedInput({
  id,
  label,
  value,
  placeholder,
  hint,
  validate,
  onCommit,
}: Props) {
  const [draft, setDraft] = useState(value);

  // Adopt external changes (a different selection, or an undo) without
  // discarding an edit in progress.
  useEffect(() => setDraft(value), [value]);

  const error = validate ? validate(draft) : null;

  const commit = () => {
    if (error !== null) return;
    if (draft !== value) onCommit(draft);
  };

  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={draft}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            setDraft(value);
          }
        }}
      />
      {hint && (
        <p className="field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        // role=alert so the reason is announced as it appears, rather than
        // only being discoverable by navigating back to the field.
        <p className="field__error" id={`${id}-error`} role="alert">
          {/* The word carries the meaning; colour only reinforces it. */}
          <strong>Invalid:</strong> {error}
        </p>
      )}
    </div>
  );
}
