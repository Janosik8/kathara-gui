/**
 * Deploying the lab, and reporting what is running and what works.
 *
 * Every state here is carried by a glyph **and** a word, never by colour
 * alone. The specification is explicit about this (Capability 6, Scenario A):
 * a user with a red-green deficiency must be able to read a diagnostic result
 * unambiguously, and "the link is green" is not a result they can read.
 *
 * Environment problems are shown before deployment is offered, with the remedy
 * rather than the error, because the usual cause is Docker not running rather
 * than anything wrong with the topology.
 */

import { useState } from "react";
import type {
  Conflicts,
  DeviceStatus,
  DiagnosticsResponse,
  EnvironmentCheck,
  EverythingResponse,
  LinkCheck,
  StatusResponse,
} from "../api/client";
import { DismissButton } from "./DismissButton";

/** "5 devices in 2 labs", in words. */
function describeEverything({ devices, labs }: EverythingResponse): string {
  const what = devices === 1 ? "1 device" : `${devices} devices`;
  const where = labs === 1 ? "1 lab" : `${labs} labs`;
  return `${what} in ${where}`;
}

interface Props {
  status: StatusResponse | null;
  diagnostics: DiagnosticsResponse | null;
  environment: EnvironmentCheck[];
  canDeploy: boolean;
  canVerify: boolean;
  busy: string | null;
  deviceCount: number;
  onDeploy: () => void;
  /** Stop the lab, discarding anything changed inside the containers. */
  onUndeploy: () => void;
  /** Capture what the containers are running, then stop the lab. */
  onCaptureAndStop: () => void;
  /** Ask the containers whether anything has changed inside them. */
  onCheck: () => void;
  onVerify: () => void;
  /** Deploy anyway, stopping whatever is already running. */
  onConfirmDeploy: () => void;
  onCancelDeploy: () => void;
  /** Set when the server refused to deploy without being asked. */
  conflicts: Conflicts | null;
  /** Routed to the app's live region, so a copy is confirmed audibly too. */
  onAnnounce?: (message: string) => void;
  /** Every Kathará lab of this user, not only this one. Null until known. */
  everything?: EverythingResponse | null;
  /** Stop every lab, capturing nothing: `kathara wipe`. */
  onWipe?: () => void;
}

const DEVICE_STATE: Record<string, { glyph: string; label: string }> = {
  running: { glyph: "●", label: "Running" },
  stopped: { glyph: "○", label: "Stopped" },
  // A container that exists but has died. Worth its own row state: it looks
  // deployed in `kathara list` yet refuses every connection.
  exited: { glyph: "◼", label: "Exited" },
  orphaned: { glyph: "◍", label: "Orphaned" },
};

const OUTCOME: Record<string, { glyph: string; label: string }> = {
  pass: { glyph: "✓", label: "Pass" },
  fail: { glyph: "✕", label: "Fail" },
  skipped: { glyph: "–", label: "Skipped" },
};

/**
 * The command that opens a shell on a device, in any terminal on any OS.
 *
 * `docker exec`, not `kathara connect`, because Docker is already a hard
 * prerequisite while the Kathará CLI is not: on Windows it is a separate
 * installer, and the first manual Windows run found the panel's command
 * failing with "'kathara' is not recognized". The earlier form,
 * `cd DIR && kathara connect r1`, also failed on its own terms there: Windows
 * PowerShell 5.1 has no `&&`, and `cmd`'s `cd` does not change drive.
 */
function dockerCommand(device: DeviceStatus): string {
  return `docker exec -it ${device.container} ${device.shell || "bash"}`;
}

/**
 * The Kathará CLI's own form, for anyone who has it.
 *
 * `-d` names the lab directory, so there is no `cd` and no `&&` — Kathará
 * identifies a lab by its directory, and `kathara connect r1` from anywhere
 * else fails with MachineNotRunningError. Quoted, because paths on Windows
 * routinely contain spaces.
 */
function kataraCommand(labDir: string, device: string): string {
  return `kathara connect -d "${labDir}" ${device}`;
}

function describeLink(check: LinkCheck): string {
  return (
    `${check.source} eth${check.source_interface} → ` +
    `${check.target} eth${check.target_interface} on ${check.collision_domain}`
  );
}

export function LabPanel({
  status,
  diagnostics,
  environment,
  canDeploy,
  canVerify,
  busy,
  deviceCount,
  onDeploy,
  onUndeploy,
  onCaptureAndStop,
  onCheck,
  onVerify,
  onConfirmDeploy,
  onCancelDeploy,
  conflicts,
  onAnnounce,
  everything,
  onWipe,
}: Props) {
  const [confirmingStop, setConfirmingStop] = useState(false);
  const [confirmingWipe, setConfirmingWipe] = useState(false);
  const [shellDevice, setShellDevice] = useState<string | null>(null);
  // The message closed by hand; a different one shows again.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const blockers = environment.filter((c) => c.status === "blocked");
  const deployed = status?.deployed ?? false;
  const exited = status?.exited ?? [];
  const drift = status?.drift ?? [];
  // Verification runs commands inside the containers, so it needs live ones —
  // `deployed` is true for a lab whose devices have all exited.
  const anyRunning = (status?.running.length ?? 0) > 0;

  return (
    <section className="lab" aria-labelledby="lab-heading">
      <h2 className="panel__heading" id="lab-heading">
        Laboratory
      </h2>

      {blockers.length > 0 && (
        <ul className="issue-list" aria-label="Environment problems">
          {blockers.map((check) => (
            <li key={check.name} className="issue" data-severity="error">
              <span className="issue__badge" aria-hidden="true">
                ✕
              </span>
              <span className="issue__text">
                <strong>{check.name}:</strong> {check.detail}
                {check.remedy && <em className="issue__remedy"> {check.remedy}</em>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {conflicts && (
        // Deliberately blocking: Kathará keys a lab by a hash of its *name*,
        // so "replace" may be a routine redeploy or may destroy a different
        // lab that happens to share the name. Only the user can tell.
        <div className="confirm" role="alertdialog" aria-labelledby="confirm-heading">
          <h3 className="confirm__heading" id="confirm-heading">
            Something is already running
          </h3>

          <p>
            {conflicts.expected.length + conflicts.unexpected.length} device(s) are running
            under the lab name <strong>{conflicts.lab_name}</strong>. Deploying will stop
            them first.
          </p>

          {conflicts.expected.length > 0 && (
            <p className="field__hint">
              From this topology: {conflicts.expected.join(", ")}.
            </p>
          )}

          {conflicts.unexpected.length > 0 && (
            <p className="confirm__warning">
              <strong>Warning:</strong> {conflicts.unexpected.join(", ")}{" "}
              {conflicts.unexpected.length === 1 ? "is" : "are"} running under this name but
              not in your topology, so another lab is probably using it. Kathará identifies a
              lab by its name, so continuing will stop that lab too. Renaming this lab avoids
              the clash.
            </p>
          )}

          <div className="lab__actions">
            <button type="button" onClick={onConfirmDeploy} disabled={busy !== null}>
              {busy === "deploy" ? "Deploying…" : "Stop them and deploy"}
            </button>
            <button type="button" onClick={onCancelDeploy} disabled={busy !== null}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {confirmingStop && (
        // The one moment the two states can be reconciled, so the user is
        // asked which one wins. The design is read-only while the lab runs, so
        // the only thing that can have moved on is the containers.
        <div className="confirm" role="alertdialog" aria-labelledby="stop-heading">
          <h3 className="confirm__heading" id="stop-heading">
            Keep what was changed inside the containers?
          </h3>
          <p>
            Stopping removes the containers. Anything configured inside them since the last
            deploy or capture is lost unless it is captured first.
          </p>
          {drift.length > 0 && (
            <>
              <p className="field__hint">Changes found so far:</p>
              <ul>
                {drift.map((change) => (
                  <li key={change}>{change}</li>
                ))}
              </ul>
            </>
          )}
          <div className="lab__actions">
            <button
              type="button"
              onClick={() => {
                setConfirmingStop(false);
                onCaptureAndStop();
              }}
              disabled={busy !== null}
            >
              Capture, then stop
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmingStop(false);
                onUndeploy();
              }}
              disabled={busy !== null}
            >
              Stop and discard container changes
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmingStop(false);
                onAnnounce?.("The lab is still running. Nothing was changed.");
              }}
            >
              Keep running
            </button>
          </div>
        </div>
      )}

      <div className="lab__actions">
        <button
          type="button"
          onClick={onDeploy}
          disabled={!canDeploy || busy !== null || deviceCount === 0}
        >
          {/* Named for what it will do. Deploying over a running lab replaces
              it, and a button that still said "Deploy" would hide that. */}
          {busy === "deploy" ? "Deploying…" : deployed ? "Redeploy" : "Deploy"}
        </button>
        <button
          type="button"
          onClick={() => {
            // With nothing running there is nothing to capture, so there is
            // no choice to put to the user: the exited containers just go.
            if (anyRunning) setConfirmingStop(true);
            else onUndeploy();
          }}
          disabled={busy !== null || !deployed || confirmingStop}
        >
          {busy === "undeploy" ? "Stopping…" : "Stop"}
        </button>
        {anyRunning && (
          <button type="button" onClick={onCheck} disabled={busy !== null}>
            {busy === "check" ? "Checking…" : "Check for changes"}
          </button>
        )}
        {canVerify && (
          <button
            type="button"
            onClick={onVerify}
            disabled={busy !== null || !anyRunning}
            title={
              drift.length > 0
                ? "Tests the running lab, which no longer matches the canvas"
                : undefined
            }
          >
            {busy === "verify" ? "Verifying…" : "Verify links"}
          </button>
        )}
      </div>

      {deviceCount === 0 && (
        <p className="field__hint">Add a device before deploying.</p>
      )}

      {deployed && deviceCount > 0 && (
        <p className="field__hint">
          The design is read-only while the lab runs. Capture running state to bring
          changes made inside the containers onto the canvas; stop the lab to edit.
          Redeploying replaces the running lab, so anything changed inside a container is
          lost.
        </p>
      )}

      {drift.length > 0 && (
        // The reported confusion: an address changed, Verify pressed, and the
        // results described something else. Diagnostics ping real containers,
        // so they can only report what is running — saying nothing about the
        // two having parted company made a correct answer look like a fault.
        //
        // With the design locked while deployed, the canvas cannot move on;
        // what differs was changed inside a container.
        <div className="lab__warning" role="status">
          <p>
            <strong>The running lab no longer matches the canvas.</strong> Capture running
            state to keep these changes, or stop the lab and discard them. Until then,
            diagnostics describe what is running.
          </p>
          <ul>
            {drift.map((change) => (
              <li key={change}>{change}</li>
            ))}
          </ul>
        </div>
      )}

      {status?.message && status.message !== dismissed && (
        <div className="dismissible">
          <DismissButton
            label="Close this message"
            onDismiss={() => setDismissed(status.message ?? null)}
          />
          <p className="lab__message">{status.message}</p>
        </div>
      )}

      {exited.length > 0 && (
        // The symptom this explains is baffling on its own: `kathara list`
        // still shows the devices, so the lab looks deployed, but every
        // `kathara connect` fails with a 409 saying the container is not
        // running.
        <p className="lab__warning" role="status">
          <strong>
            {exited.length === 1 ? "1 device has" : `${exited.length} devices have`} stopped:
          </strong>{" "}
          {exited.join(", ")}. The containers still exist but nothing is running inside
          them, so you cannot open a shell on them. Docker does not restart Kathará
          containers, so this usually follows a Docker restart or the machine sleeping.
          Deploy again to bring the lab back.
        </p>
      )}

      {status?.lab_dir && (
        <div className="lab__location">
          <h3 className="panel__heading">Lab directory</h3>
          <p className="lab__path">
            <code>{status.lab_dir}</code>
          </p>
          {(() => {
            const reachable = status.devices.filter(
              (d) => d.state === "running" && d.container,
            );
            const device =
              reachable.find((d) => d.name === shellDevice) ?? reachable[0];
            if (!device) return null;
            const command = dockerCommand(device);
            return (
              <>
                <div className="field">
                  <label htmlFor="shell-device">Open a shell on</label>
                  <select
                    id="shell-device"
                    value={device.name}
                    onChange={(e) => setShellDevice(e.target.value)}
                  >
                    {reachable.map((d) => (
                      <option key={d.name} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="field__hint">
                  In any terminal — PowerShell, Command Prompt or a Unix shell:
                </p>
                <p className="lab__path">
                  <code>{command}</code>
                </p>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(command);
                      onAnnounce?.("Command copied to the clipboard.");
                    } catch {
                      // Clipboard access can be refused; the text is on
                      // screen anyway, so say so rather than failing silently.
                      onAnnounce?.("Could not copy. Select the command above instead.");
                    }
                  }}
                >
                  Copy command
                </button>
                <p className="field__hint">
                  With the Kathará command-line tool installed, this works too:{" "}
                  <code>{kataraCommand(status.lab_dir!, device.name)}</code>
                </p>
              </>
            );
          })()}
        </div>
      )}

      {status && status.devices.length > 0 && (
        <>
          <h3 className="panel__heading">Devices</h3>
          <ul className="state-list">
            {status.devices.map((device: DeviceStatus) => {
              const state = DEVICE_STATE[device.state] ?? DEVICE_STATE.stopped!;
              return (
                <li key={device.name} className="state" data-state={device.state}>
                  <span className="state__glyph" aria-hidden="true">
                    {state.glyph}
                  </span>
                  {/* The word is the status; the glyph and colour repeat it. */}
                  <span className="state__name">{device.name}</span>
                  <span className="state__label">{state.label}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {canVerify && diagnostics && (
        <>
          <h3 className="panel__heading">Link checks</h3>
          {drift.length > 0 && (
            // Said beside the results, not only at the top of the panel: this
            // is where the user is looking when the numbers surprise them.
            <p className="field__hint">
              These describe the <strong>running</strong> lab, which no longer matches the
              canvas.
            </p>
          )}
          {diagnostics.message ? (
            <p className="field__hint">{diagnostics.message}</p>
          ) : (
            <p className="addressing__summary" data-severity={diagnostics.failed > 0 ? "error" : undefined}>
              {diagnostics.failed > 0
                ? `${diagnostics.failed} of ${diagnostics.checks.length} links failed`
                : `All ${diagnostics.passed} links passed`}
              {diagnostics.skipped > 0 && `, ${diagnostics.skipped} skipped`}
            </p>
          )}

          {diagnostics.checks.length > 0 && (
            <ul className="state-list">
              {diagnostics.checks.map((check) => {
                const outcome = OUTCOME[check.outcome] ?? OUTCOME.skipped!;
                return (
                  <li
                    key={`${check.collision_domain}-${check.source}-${check.target}`}
                    className="state"
                    data-outcome={check.outcome}
                  >
                    <span className="state__glyph" aria-hidden="true">
                      {outcome.glyph}
                    </span>
                    <span className="state__name">{describeLink(check)}</span>
                    <span className="state__label">{outcome.label}</span>
                    {check.detail && <span className="state__detail">{check.detail}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {onWipe && (
        // Deliberately apart from this lab's own buttons: it reaches beyond
        // the lab being edited, to labs this application never opened, and
        // must not be mistaken for Stop. Available while the design is locked,
        // because it is a lab action, not an edit.
        <div className="lab__everything">
          <h3 className="panel__heading">All labs</h3>
          <p className="field__hint">
            {everything && everything.devices > 0
              ? `${describeEverything(everything)} deployed on this computer, ` +
                "counting labs not opened here. They keep running after this " +
                "application stops."
              : "No Kathará labs are deployed on this computer."}
          </p>

          {confirmingWipe && everything && (
            <div className="confirm" role="alertdialog" aria-labelledby="wipe-heading">
              <h3 className="confirm__heading" id="wipe-heading">
                Stop every Kathará lab?
              </h3>
              <p>
                This stops {describeEverything(everything)}, including labs not opened
                here. Nothing is captured: anything configured inside them is lost.
              </p>
              <div className="lab__actions">
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingWipe(false);
                    onWipe();
                  }}
                  disabled={busy !== null}
                >
                  Stop everything
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingWipe(false);
                    onAnnounce?.("Nothing was stopped.");
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="lab__actions">
            <button
              type="button"
              onClick={() => setConfirmingWipe(true)}
              disabled={
                busy !== null || confirmingWipe || !everything || everything.devices === 0
              }
            >
              {busy === "wipe" ? "Stopping every lab…" : "Stop every lab"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
