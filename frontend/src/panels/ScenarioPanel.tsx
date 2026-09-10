/**
 * The scenario as a file: saving it, opening one, sharing it, capturing state.
 *
 * This panel is what makes Capability 5 reachable. The package format and the
 * configuration capture existed and worked well before any of this, and were
 * usable only from the API — which satisfies none of the requirements that
 * asked for them.
 *
 * Two destinations, deliberately distinct and labelled as such. **Save** keeps
 * the scenario on this machine, in the workspace, and is the working loop.
 * **Download** hands it to the browser so it can leave — the exam submission.
 * Users routinely conflate the two, so the wording says where the file goes
 * rather than naming the mechanism.
 */

import { useEffect, useRef, useState } from "react";
import type { CaptureResponse, PackageSummary } from "../api/client";
import { CommittedInput } from "./CommittedInput";

interface Props {
  /** Null until the scenario has been written to disk at least once. */
  projectFile: string | null;
  dirty: boolean;
  busy: string | null;
  deviceCount: number;
  /** Whether anything is running to capture configuration from. */
  anyRunning: boolean;
  packages: PackageSummary[];
  capture: CaptureResponse | null;
  onSave: () => void;
  onSaveAs: (name: string) => void;
  onDownload: () => void;
  onOpen: (filename: string) => void;
  onUpload: (file: File) => void;
  onCapture: () => void;
  onRefreshPackages: () => void;
  onImportLabConf: (text: string, name: string) => void;
  onExportLabConf: () => void;
  /** Lines the importer could not understand, from the last import. */
  importWarnings: string[];
  /** The scenario's name, which is also Kathará's identity for the lab. */
  name: string;
  onRename: (name: string) => void;
}

function fileName(path: string): string {
  // Both separators: the path comes from the server, which may be on Windows.
  return path.split(/[/\\]/).pop() ?? path;
}

function describeSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} kB`;
}

export function ScenarioPanel({
  projectFile,
  dirty,
  busy,
  deviceCount,
  anyRunning,
  packages,
  capture,
  onSave,
  onSaveAs,
  onDownload,
  onOpen,
  onUpload,
  onCapture,
  onRefreshPackages,
  onImportLabConf,
  onExportLabConf,
  importWarnings,
  name,
  onRename,
}: Props) {
  const [opening, setOpening] = useState(false);
  const [namingAs, setNamingAs] = useState(false);
  const [newName, setNewName] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const labConfInput = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);

  // The list is only correct at the moment it is fetched, so it is refreshed
  // when the chooser opens rather than left to go stale in the background.
  useEffect(() => {
    if (opening) onRefreshPackages();
  }, [opening, onRefreshPackages]);

  useEffect(() => {
    if (namingAs) nameInput.current?.focus();
  }, [namingAs]);

  const empty = deviceCount === 0;

  return (
    <section className="scenario" aria-labelledby="scenario-heading">
      <h2 className="panel__heading" id="scenario-heading">
        Scenario
      </h2>

      <CommittedInput
        id="scenario-name"
        // Not just "Name": the device inspector has a Name field too, and two
        // controls with the same label are indistinguishable read aloud.
        label="Scenario name"
        value={name}
        hint="Names the lab folder and the saved file. Kathará identifies a lab by this name."
        validate={(value) => (value.trim() ? null : "The scenario needs a name.")}
        onCommit={(value) => {
          const trimmed = value.trim();
          if (trimmed && trimmed !== name) onRename(trimmed);
        }}
      />

      {anyRunning && (
        // Renaming is the advice given when two labs collide, so it has to be
        // possible while one is running — but Kathará keys a lab by its name,
        // so the containers already up keep the old one and stop being this
        // scenario's as far as the tool is concerned.
        // Deliberately not a live region. This is standing advice about a
        // state the user just created by deploying, not an event; announcing
        // it would compete with the deploy result in the app's live region.
        // Contrast the exited-devices warning in LabPanel, which reports
        // something the user did not do.
        <p className="lab__warning">
          This lab is running. Renaming it leaves those containers under the old name — stop
          the lab first, or clean them up with <code>kathara wipe</code> afterwards.
        </p>
      )}

      <p className="field__hint">
        {projectFile ? (
          <>
            Saved as <code>{fileName(projectFile)}</code>
            {dirty && " — with changes since."}
          </>
        ) : (
          "Not saved to a file yet."
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
        <button type="button" onClick={() => setOpening((o) => !o)} disabled={busy !== null}>
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
            Saved into the workspace folder as <code>{(newName.trim() || "name") + ".kgui"}</code>.
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
              {/* Not "Save": the header and the panel already offer a button
                  by that name, and three identically named controls on one
                  screen are indistinguishable when read out in a list. */}
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
          {packages.length === 0 ? (
            <p className="field__hint">
              No saved scenarios in the workspace yet. Use <strong>Upload</strong> below to
              open one from elsewhere.
            </p>
          ) : (
            <ul className="state-list" aria-label="Saved scenarios">
              {packages.map((entry) => (
                <li key={entry.filename} className="state">
                  <button
                    type="button"
                    className="scenario__open"
                    onClick={() => {
                      onOpen(entry.filename);
                      setOpening(false);
                    }}
                    disabled={busy !== null}
                  >
                    <span className="state__name">{entry.name}</span>
                    <span className="state__detail">
                      {entry.filename} · {describeSize(entry.size)}
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
        A <code>.kgui</code> file holds the topology, the generated lab and any captured
        configuration — everything needed to reopen or hand in the scenario.
      </p>

      <div className="lab__actions">
        <button type="button" onClick={onDownload} disabled={busy !== null || empty}>
          {busy === "download" ? "Preparing…" : "Download"}
        </button>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={busy !== null}
        >
          Upload…
        </button>
        {/* display:none rather than visually hidden. A hidden-but-focusable
            input would put an invisible stop in the tab order; the button
            above is the real control, and it opens the native file dialog,
            which is accessible in its own right.

            Named anyway. In a browser `display: none` keeps it out of the
            accessibility tree entirely, but an unnamed form control is a
            defect wherever it does surface — and it is one that only shows up
            when the stylesheet is absent, which is precisely the case a test
            environment reproduces. */}
        <input
          ref={fileInput}
          type="file"
          accept=".kgui,application/zip"
          className="file-input"
          aria-label="Scenario file to open"
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
            // Cleared so choosing the same file twice fires again.
            e.target.value = "";
          }}
        />
      </div>

      <h3 className="panel__heading">Kathará lab files</h3>
      <p className="field__hint">
        For working with labs that already exist. Importing reads a{" "}
        <code>lab.conf</code> written by hand or by another tool; anything this model does
        not represent is preserved rather than dropped.
      </p>

      <div className="lab__actions">
        <button
          type="button"
          onClick={() => labConfInput.current?.click()}
          disabled={busy !== null}
        >
          Import lab.conf…
        </button>
        <button type="button" onClick={onExportLabConf} disabled={busy !== null || empty}>
          Export lab.conf
        </button>
        <input
          ref={labConfInput}
          type="file"
          accept=".conf,text/plain"
          className="file-input"
          aria-label="lab.conf file to import"
          tabIndex={-1}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) onImportLabConf(await file.text(), file.name);
            e.target.value = "";
          }}
        />
      </div>

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
        Copies what each router is <em>actually</em> running into the lab folder, so saving
        afterwards keeps configuration made inside the containers.
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
