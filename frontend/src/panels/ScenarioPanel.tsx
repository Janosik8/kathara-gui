/**
 * The scenario as a folder: saving it, opening one, sharing it, capturing state.
 *
 * One Save, one Open, one Export, one Import. An earlier version offered
 * `.kgui` and `lab.conf` as separate pairs, which asked the user to understand
 * a distinction that should never have existed: a scenario *is* a Kathará lab
 * folder, and the export is a plain zip of it.
 *
 * **Save keeps it here; Export sends it out.** Users conflate the two, so the
 * wording says where the file goes rather than naming the mechanism.
 */

import { useEffect, useRef, useState } from "react";
import type { CaptureResponse, ScenarioSummary } from "../api/client";

interface Props {
  /** Null until the scenario has a folder on disk. */
  folder: string | null;
  dirty: boolean;
  busy: string | null;
  deviceCount: number;
  /** Whether anything is running to capture configuration from. */
  anyRunning: boolean;
  /**
   * True while the lab is deployed. Opening or importing would swap the design
   * out from under a running lab, leaving containers the canvas no longer
   * describes, so both wait until it is stopped.
   */
  locked?: boolean;
  scenarios: ScenarioSummary[];
  capture: CaptureResponse | null;
  /** Lines of an imported lab.conf that could not be understood. */
  importWarnings: string[];
  onSave: () => void;
  onSaveAs: (name: string) => void;
  onExport: () => void;
  onOpen: (folder: string) => void;
  onImport: (file: File) => void;
  onCapture: () => void;
  onRefreshScenarios: () => void;
}

function lastSegment(path: string): string {
  // Both separators: the path comes from the server, which may be on Windows.
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
}

export function ScenarioPanel({
  folder,
  dirty,
  busy,
  deviceCount,
  anyRunning,
  locked = false,
  scenarios,
  capture,
  importWarnings,
  onSave,
  onSaveAs,
  onExport,
  onOpen,
  onImport,
  onCapture,
  onRefreshScenarios,
}: Props) {
  const [opening, setOpening] = useState(false);
  const [namingAs, setNamingAs] = useState(false);
  const [newName, setNewName] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);

  // The list is only correct at the moment it is fetched, so it is refreshed
  // when the chooser opens rather than left to go stale in the background.
  useEffect(() => {
    if (opening) onRefreshScenarios();
  }, [opening, onRefreshScenarios]);

  useEffect(() => {
    if (namingAs) nameInput.current?.focus();
  }, [namingAs]);

  const empty = deviceCount === 0;

  return (
    <section className="scenario" aria-labelledby="scenario-heading">
      <h2 className="panel__heading" id="scenario-heading">
        Scenario
      </h2>

      <p className="field__hint">
        {folder ? (
          <>
            Saved in <code>{lastSegment(folder)}</code>
            {dirty && " — with changes since."}
          </>
        ) : (
          "Not saved yet."
        )}
      </p>

      <div className="lab__actions">
        <button type="button" onClick={onSave} disabled={busy !== null || empty}>
          {busy === "save" ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => {
            setNewName("");
            setNamingAs(true);
          }}
          disabled={busy !== null || empty}
        >
          Save as…
        </button>
        <button type="button" onClick={() => setOpening((o) => !o)}
          disabled={busy !== null || locked}
        >
          {opening ? "Cancel" : "Open…"}
        </button>
      </div>

      {namingAs && (
        <div className="confirm">
          <label className="field" htmlFor="scenario-save-as">
            <span className="field__label">Save as</span>
            <input
              id="scenario-save-as"
              ref={nameInput}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newName.trim()) {
                  onSaveAs(newName.trim());
                  setNamingAs(false);
                }
                if (e.key === "Escape") setNamingAs(false);
              }}
            />
          </label>
          <p className="field__hint">
            A folder of that name in the workspace.
          </p>
          <div className="lab__actions">
            <button
              type="button"
              onClick={() => {
                onSaveAs(newName.trim());
                setNamingAs(false);
              }}
              disabled={!newName.trim()}
            >
              {/* Not "Save": the header and the panel already offer one, and
                  three identically named controls read alike in a list. */}
              Save scenario
            </button>
            <button type="button" onClick={() => setNamingAs(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {opening && (
        <div className="confirm">
          <h3 className="confirm__heading">Open a scenario</h3>
          {scenarios.length === 0 ? (
            <p className="field__hint">
              No scenarios in the workspace yet. Use <strong>Import</strong> below to open
              one from elsewhere.
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
                      setOpening(false);
                    }}
                    disabled={busy !== null}
                  >
                    <span className="state__name">{entry.name}</span>
                    <span className="state__detail">
                      {entry.folder} · {entry.devices} device
                      {entry.devices === 1 ? "" : "s"}
                      {entry.foreign && " · imported"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {dirty && (
            <p className="confirm__warning">
              <strong>Warning:</strong> the current scenario has unsaved changes, and opening
              another replaces it.
            </p>
          )}
        </div>
      )}

      <h3 className="panel__heading">Share</h3>
      <p className="field__hint">
        Export downloads the scenario folder as a <code>.zip</code>: the topology, the
        startup scripts and any captured configuration. Anyone can unzip and read it, and
        anyone with Kathará can run it. Import opens such a zip, a folder zipped by hand, or
        a plain <code>lab.conf</code> — including labs made without this application.
      </p>

      <div className="lab__actions">
        <button type="button" onClick={onExport} disabled={busy !== null || empty}>
          {busy === "export" ? "Preparing…" : "Export"}
        </button>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={busy !== null || locked}
        >
          {busy === "import" ? "Importing…" : "Import…"}
        </button>
        {/* display:none rather than visually hidden. A hidden-but-focusable
            input would put an invisible stop in the tab order; the button
            above is the real control, and it opens the native file dialog,
            which is accessible in its own right. Named anyway, because an
            unnamed form control is a defect wherever it does surface. */}
        <input
          ref={fileInput}
          type="file"
          accept=".zip,.conf,application/zip,text/plain"
          className="file-input"
          aria-label="Scenario file to import"
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onImport(file);
            // Cleared so choosing the same file twice fires again.
            e.target.value = "";
          }}
        />
      </div>

      {locked && (
        <p className="field__hint">Stop the lab before opening or importing another scenario.</p>
      )}

      {importWarnings.length > 0 && (
        // Import is deliberately forgiving, which makes saying what was not
        // understood the only way the user learns something was left behind.
        <div className="lab__warning" role="status">
          <p>
            <strong>Imported, with {importWarnings.length} line(s) not understood:</strong>
          </p>
          <ul>
            {importWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      <h3 className="panel__heading">Running configuration</h3>
      <p className="field__hint">
        Copies what the devices are <em>actually</em> running into the scenario folder —
        routing configuration into each router's <code>frr.conf</code>, and interface
        addresses back onto the canvas.
      </p>

      <div className="lab__actions">
        <button type="button" onClick={onCapture} disabled={busy !== null || !anyRunning}>
          {busy === "capture" ? "Capturing…" : "Capture running state"}
        </button>
      </div>

      {!anyRunning && (
        <p className="field__hint">Deploy the lab first — there is nothing to capture from.</p>
      )}

      {capture && (
        <>
          {capture.message && <p className="lab__message">{capture.message}</p>}
          {capture.captured.length > 0 && (
            <ul className="state-list" aria-label="Captured configuration">
              {capture.captured.map((file) => (
                <li key={file.device} className="state" data-state="running">
                  <span className="state__glyph" aria-hidden="true">
                    ✓
                  </span>
                  <span className="state__name">{file.device}</span>
                  <span className="state__label">{file.lines} lines</span>
                </li>
              ))}
            </ul>
          )}
          {capture.skipped.length > 0 && (
            // Reported rather than hidden: silence would look like success.
            <ul className="state-list" aria-label="Devices skipped">
              {capture.skipped.map(([device, reason]) => (
                <li key={device} className="state" data-state="stopped">
                  <span className="state__glyph" aria-hidden="true">
                    –
                  </span>
                  <span className="state__name">{device}</span>
                  <span className="state__detail">{reason}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
