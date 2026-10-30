/**
 * New, Save as, Open, Export and Import, opened from the header; and the
 * question an Import asks when its scenario is already in the workspace.
 *
 * Export and Import say what they do before they do it (bug 37). The
 * explanation used to sit in the middle of the Scenario panel, where it was
 * read once if at all; here it is read at the moment it applies, and the
 * second press does the work.
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
import { MIN_PASSWORD } from "./ExamPanel";

export type ScenarioDialog = "new" | "saveAs" | "open" | "export" | "import";

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
  /** Why the import waits: the scenario it would replace (test 5C.1). */
  importConflict?: string | null;
  /** Import the held file, replacing the scenario of the same name. */
  onReplace?: () => void;
  /**
   * The held file is sealed, and this says why it waits: no password yet, or
   * a wrong one (note 1).
   */
  importPassword?: string | null;
  /** Open the held sealed file with this password. */
  onImportPassword?: (password: string) => void;
  /** Download the scenario as a zip, or sealed with a password. */
  onExport?: (password?: string) => void;
  /** Open the browser's file chooser for an import. */
  onChooseFile?: () => void;
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
  importConflict = null,
  onReplace,
  importPassword = null,
  onImportPassword,
  onExport,
  onChooseFile,
  onClose,
}: Props) {
  const [newName, setNewName] = useState("");
  // Sealing the export, and the password a sealed import is opened with.
  const [seal, setSeal] = useState(false);
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);
  const openHeading = useRef<HTMLHeadingElement>(null);
  const newHeading = useRef<HTMLHeadingElement>(null);
  const importHeading = useRef<HTMLHeadingElement>(null);
  const exportHeading = useRef<HTMLHeadingElement>(null);

  // Focus follows the button that opened it, so a keyboard or screen-reader
  // user lands in the form rather than having to find it.
  useEffect(() => {
    if (dialog === "saveAs") {
      setNewName("");
      nameInput.current?.focus();
    } else if (dialog === "new") {
      newHeading.current?.focus();
    } else if (dialog === "import") {
      setPassword("");
      importHeading.current?.focus();
    } else if (dialog === "export") {
      setSeal(false);
      setPassword("");
      setRepeat("");
      exportHeading.current?.focus();
    } else {
      openHeading.current?.focus();
    }
  }, [dialog, importConflict, importPassword]);

  const short = seal && password.length > 0 && password.length < MIN_PASSWORD;
  const mismatch = seal && repeat.length > 0 && repeat !== password;
  const canExport = !seal || (password.length >= MIN_PASSWORD && repeat === password);

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
      {dialog === "export" ? (
        <div className="scenario-drawer__body">
          <h2 className="confirm__heading" ref={exportHeading} tabIndex={-1}>
            Export the scenario
          </h2>
          <p className="field__hint">
            Downloads the scenario folder as a <code>.zip</code>: the topology, the startup
            scripts and any captured configuration. Anyone can unzip and read it, and anyone
            with Kathará can run it. The scenario is saved first.
          </p>
          <label className="checkbox" htmlFor="export-seal">
            <input
              id="export-seal"
              type="checkbox"
              checked={seal}
              onChange={(e) => setSeal(e.target.checked)}
            />
            Seal it with a password
          </label>
          {seal && (
            <>
              <p className="field__hint">
                A sealed <code>.kgx</code> file opens only in this application, and only with
                the password: for an exam handed out before it starts.
              </p>
              <label className="field" htmlFor="export-password">
                <span className="field__label">Password</span>
                <input
                  id="export-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  aria-invalid={short ? true : undefined}
                  aria-describedby={short ? "export-password-error" : undefined}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              {short && (
                <p className="field__error" id="export-password-error">
                  <strong>Invalid:</strong> at least {MIN_PASSWORD} characters.
                </p>
              )}
              <label className="field" htmlFor="export-password-repeat">
                <span className="field__label">The password again</span>
                <input
                  id="export-password-repeat"
                  type="password"
                  autoComplete="new-password"
                  value={repeat}
                  aria-invalid={mismatch ? true : undefined}
                  aria-describedby={mismatch ? "export-password-repeat-error" : undefined}
                  onChange={(e) => setRepeat(e.target.value)}
                />
              </label>
              {mismatch && (
                <p className="field__error" id="export-password-repeat-error">
                  <strong>Invalid:</strong> the two passwords differ.
                </p>
              )}
            </>
          )}
          <div className="lab__actions">
            <button
              type="button"
              onClick={() => {
                onExport?.(seal ? password : undefined);
                onClose();
              }}
              disabled={busy !== null || !canExport}
            >
              {/* Not "Export": the header already has one (see Save scenario). */}
              {seal ? "Download sealed .kgx" : "Download .zip"}
            </button>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      ) : dialog === "import" && importPassword ? (
        <div className="scenario-drawer__body">
          <h2 className="confirm__heading" ref={importHeading} tabIndex={-1}>
            Open a sealed scenario
          </h2>
          <p className="field__hint" id="import-password-why">
            {importPassword}
          </p>
          <label className="field" htmlFor="import-password">
            <span className="field__label">Password</span>
            <input
              id="import-password"
              type="password"
              autoComplete="off"
              value={password}
              aria-describedby="import-password-why"
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && password) onImportPassword?.(password);
              }}
            />
          </label>
          <div className="lab__actions">
            <button
              type="button"
              onClick={() => onImportPassword?.(password)}
              disabled={busy !== null || !password}
            >
              Open it
            </button>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      ) : dialog === "import" && !importConflict ? (
        <div className="scenario-drawer__body">
          <h2 className="confirm__heading" ref={importHeading} tabIndex={-1}>
            Import a scenario
          </h2>
          <p className="field__hint">
            Opens a <code>.zip</code> exported from here, a folder zipped by hand, a sealed{" "}
            <code>.kgx</code>, or a plain <code>lab.conf</code>, including labs made without
            this application. The lab
            takes the zip&apos;s name, so <code>student.zip</code> opens as{" "}
            <code>student</code>.
          </p>
          {dirty && (
            <p className="confirm__warning">
              <strong>Warning:</strong> the current scenario has unsaved changes, and importing
              replaces it on the canvas.
            </p>
          )}
          <div className="lab__actions">
            <button type="button" onClick={() => onChooseFile?.()} disabled={busy !== null}>
              Choose a file…
            </button>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      ) : dialog === "import" ? (
        <div className="scenario-drawer__body">
          <h2 className="confirm__heading" ref={importHeading} tabIndex={-1}>
            Replace a scenario?
          </h2>
          <p className="confirm__warning">
            <strong>Warning:</strong> {importConflict}
          </p>
          {dirty && (
            <p className="confirm__warning">
              <strong>Warning:</strong> the current scenario has unsaved changes, and importing
              replaces it on the canvas.
            </p>
          )}
          <div className="lab__actions">
            <button
              type="button"
              onClick={() => {
                onReplace?.();
                onClose();
              }}
              disabled={busy !== null}
            >
              Replace it
            </button>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      ) : dialog === "new" ? (
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
              No scenarios in the workspace yet. Use <strong>Import…</strong> in the top bar to
              open one from elsewhere.
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
