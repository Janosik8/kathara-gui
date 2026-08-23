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

import type {
  DeviceStatus,
  DiagnosticsResponse,
  EnvironmentCheck,
  LinkCheck,
  StatusResponse,
} from "../api/client";

interface Props {
  status: StatusResponse | null;
  diagnostics: DiagnosticsResponse | null;
  environment: EnvironmentCheck[];
  canDeploy: boolean;
  canVerify: boolean;
  busy: string | null;
  deviceCount: number;
  onDeploy: () => void;
  onUndeploy: () => void;
  onVerify: () => void;
}

const DEVICE_STATE: Record<string, { glyph: string; label: string }> = {
  running: { glyph: "●", label: "Running" },
  stopped: { glyph: "○", label: "Stopped" },
  orphaned: { glyph: "◍", label: "Orphaned" },
};

const OUTCOME: Record<string, { glyph: string; label: string }> = {
  pass: { glyph: "✓", label: "Pass" },
  fail: { glyph: "✕", label: "Fail" },
  skipped: { glyph: "–", label: "Skipped" },
};

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
  onVerify,
}: Props) {
  const blockers = environment.filter((c) => c.status === "blocked");
  const deployed = status?.deployed ?? false;

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

      <div className="lab__actions">
        <button
          type="button"
          onClick={onDeploy}
          disabled={!canDeploy || busy !== null || deviceCount === 0}
        >
          {busy === "deploy" ? "Deploying…" : "Deploy"}
        </button>
        <button type="button" onClick={onUndeploy} disabled={busy !== null || !deployed}>
          {busy === "undeploy" ? "Stopping…" : "Stop"}
        </button>
        {canVerify && (
          <button type="button" onClick={onVerify} disabled={busy !== null || !deployed}>
            {busy === "verify" ? "Verifying…" : "Verify links"}
          </button>
        )}
      </div>

      {deviceCount === 0 && (
        <p className="field__hint">Add a device before deploying.</p>
      )}

      {status?.message && <p className="lab__message">{status.message}</p>}

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
    </section>
  );
}
