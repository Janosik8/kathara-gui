/**
 * New, Save as and Open, opened from the header.
 *
 * They used to live in the Scenario panel on the right, while Save sat in the
 * header: three actions on one document, in two places. Asked for in the
 * tester's notes — "save, save as and open buttons should be at the top bar".
 *
 * Shown as a strip directly under the header rather than a floating popover,
 * so it takes part in the page's flow: at 200% zoom it reflows like
 * everything else instead of covering the canvas (ACC-05).
 */

import { useEffect, useRef, useState } from "react";
import type { ScenarioSummary } from "../api/client";

export type ScenarioDialog = "new" | "saveAs" | "open";

interface Props {
  dialog: ScenarioDialog;
  dirty: boolean;
  busy: string | null;
  scenarios: ScenarioSummary[];
  /** The lab name of the scenario open now, if its lab is running. */
  runningLab?: string | null;
  onSaveAs: (name: string) => void;
  /** Why a name cannot be used for the copy, or null (test 3E.2). */
  validateName?: (name: string) => string | null;
  onOpen: (folder: string) => void;
  /** Start an empty scenario with no folder (bug 27). */
  onNew: () => void;
  onClose: () => void;
}

export function ScenarioDrawer({
  dialog,
  dirty,
  busy,
  scenarios,
  runningLab = null,
  onSaveAs,
  validateName,
  onOpen,
  onNew,
  onClose,
}: Props) {
  const [newName, setNewName] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);
  const openHeading = useRef<HTMLHeadingElement>(null);
  const newHeading = useRef<HTMLHeadingElement>(null);

  // Focus follows the button that opened it, so a keyboard or screen-reader
  // user lands in the form rather than having to find it.
  useEffect(() => {
    if (dialog === "saveAs") {
      setNewName("");
      nameInput.current?.focus();
    } else if (dialog === "new") {
      newHeading.current?.focus();
    } else {
      openHeading.current?.focus();
    }
  }, [dialog]);

  // Shown once something is typed: an empty field is not yet a mistake.
  const problem = newName.trim() ? (validateName?.(newName.trim()) ?? null) : null;

  const submit = () => {
    const name = newName.trim();
    if (!name || problem) return;
    onSaveAs(name);
    onClose();
  };

  return (
    <div
      className="scenario-drawer"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      {dialog === "new" ? (
        <div className="scenario-drawer__body">
          <h2 className="confirm__heading" ref={newHeading} tabIndex={-1}>
            Start a new scenario
          </h2>
          <p className="field__hint">
            An empty canvas, not yet saved anywhere. The scenario open now stays in its
            folder; <strong>Open…</strong> brings it back.
          </p>
          {dirty && (
            <p className="confirm__warning">
              <strong>Warning:</strong> the current scenario has unsaved changes, and they will
              be lost.
            </p>
          )}
          <div className="lab__actions">
            <button
              type="button"
              onClick={() => {
                onNew();
                onClose();
              }}
              disabled={busy !== null}
            >
              Start new scenario
            </button>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      ) : dialog === "saveAs" ? (
        <div className="scenario-drawer__body">
          <label className="field" htmlFor="scenario-save-as">
            <span className="field__label">Save as</span>
            <input
              id="scenario-save-as"
              ref={nameInput}
              value={newName}
              aria-invalid={problem ? true : undefined}
              aria-describedby={
                problem ? "scenario-save-as-hint scenario-save-as-error" : "scenario-save-as-hint"
              }
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
          </label>
          <p className="field__hint" id="scenario-save-as-hint">
            The copy&apos;s name, and its folder&apos;s, exactly.
          </p>
          {problem && (
            <p className="field__error" id="scenario-save-as-error" role="alert">
              <strong>Invalid:</strong> {problem}
            </p>
          )}
          <div className="lab__actions">
            <button type="button" onClick={submit} disabled={!newName.trim() || problem !== null}>
              {/* Not "Save": the header already offers one, and two
                  identically named controls read alike in a list. */}
              Save scenario
            </button>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="scenario-drawer__body">
          <h2 className="confirm__heading" ref={openHeading} tabIndex={-1}>
            Open a scenario
          </h2>
          {scenarios.length === 0 ? (
            <p className="field__hint">
              No scenarios in the workspace yet. Use <strong>Import</strong> in the Scenario
              panel to open one from elsewhere.
            </p>
          ) : (
            <ul className="state-list" aria-label="Scenarios in the workspace">
              {scenarios.map((entry) => (
                <li key={entry.folder} className="state">
                  <button
                    type="button"
                    className="scenario__open"
                    onClick={() => {
                      onOpen(entry.folder);
                      onClose();
                    }}
                    disabled={busy !== null}
                  >
                    <span className="state__name">{entry.name}</span>
                    {entry.running && (
                      <>
                        {" "}
                        <span className="scenario__running">running</span>
                      </>
                    )}
                    {/* Inline spans, so without this the name ran straight
                        into the count: "base exam2 devices". */}
                    {" · "}
                    <span className="state__detail">
                      {/* The folder is the lab's name (F34), so it is said
                          once. Only a folder from before that rule, or one
                          made by hand, still differs, and then it is named. */}
                      {entry.folder !== entry.name && `in ${entry.folder} · `}
                      {entry.devices} device
                      {entry.devices === 1 ? "" : "s"}
                      {entry.foreign && " · imported"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {runningLab && (
            <p className="field__hint">
              The lab {runningLab} keeps running. Open its scenario again to stop it or
              capture it.
            </p>
          )}
          {dirty && (
            <p className="confirm__warning">
              <strong>Warning:</strong> the current scenario has unsaved changes, and opening
              another replaces it.
            </p>
          )}
          <div className="lab__actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
