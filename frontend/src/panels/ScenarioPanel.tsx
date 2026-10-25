/**
 * The scenario as a folder: where it is saved, sharing it, capturing state.
 *
 * Save, Save as and Open are in the header (see `ScenarioDrawer`); this panel
 * says where the scenario lives and holds what moves it off the machine.
 *
 * One Save, one Open, one Export, one Import. An earlier version offered
 * `.kgui` and `lab.conf` as separate pairs, which asked the user to understand
 * a distinction that should never have existed: a scenario *is* a Kathará lab
 * folder, and the export is a plain zip of it.
 *
 * **Save keeps it here; Export sends it out.** Users conflate the two, so the
 * wording says where the file goes rather than naming the mechanism.
 */

import { useRef } from "react";
import type { CaptureResponse } from "../api/client";
import { DismissButton } from "./DismissButton";

interface Props {
  /** Null until the scenario has a folder on disk. */
  folder: string | null;
  dirty: boolean;
  busy: string | null;
  deviceCount: number;
  /** Whether anything is running to capture configuration from. */
  anyRunning: boolean;
  capture: CaptureResponse | null;
  /** Close the capture result. */
  onDismissCapture?: () => void;
  /** Lines of an imported lab.conf that could not be understood. */
  importWarnings: string[];
  onExport: () => void;
  onImport: (file: File) => void;
  onCapture: () => void;
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
  capture,
  onDismissCapture,
  importWarnings,
  onExport,
  onImport,
  onCapture,
}: Props) {
  const fileInput = useRef<HTMLInputElement>(null);

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
          // Allowed while a lab runs, like Open: the lab keeps running (3E.2).
          disabled={busy !== null}
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
        <div className="dismissible">
          {onDismissCapture && (
            <DismissButton label="Close the capture result" onDismiss={onDismissCapture} />
          )}
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
        </div>
      )}
    </section>
  );
}
