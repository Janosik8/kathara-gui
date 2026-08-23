/**
 * The addressing assistant: allocate a plan, and report what is wrong with it.
 *
 * Severity is carried by an icon, a word and the ordering — never by colour
 * alone. Diagnostic feedback that only differs in hue is unusable to a reader
 * with a colour vision deficiency, which the specification calls out directly
 * (Capability 6, Scenario A).
 *
 * Both halves disappear when the instructor has withdrawn them for a scenario.
 * That is a courtesy, not the enforcement: the server refuses the request
 * regardless, because hiding a button stops nobody with developer tools open.
 */

import type { AddressingIssue } from "../api/client";

interface Props {
  issues: AddressingIssue[];
  errors: number;
  warnings: number;
  /** True while an allocation is in flight; disables the buttons. */
  busy: boolean;
  /**
   * True while a background validation is in flight. Deliberately separate
   * from `busy`: validation runs after every edit, and letting it disable the
   * buttons would leave them dead for most of a working session.
   */
  checking: boolean;
  /** False when the instructor has withdrawn the calculator. */
  canAllocate: boolean;
  canValidate: boolean;
  onAllocate: (overwrite: boolean) => void;
}

const SEVERITY: Record<string, { glyph: string; label: string }> = {
  error: { glyph: "✕", label: "Error" },
  warning: { glyph: "!", label: "Warning" },
};

function summarise(errors: number, warnings: number): string {
  if (errors === 0 && warnings === 0) return "No addressing problems found.";
  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} ${errors === 1 ? "error" : "errors"}`);
  if (warnings > 0) parts.push(`${warnings} ${warnings === 1 ? "warning" : "warnings"}`);
  return parts.join(", ");
}

export function AddressingPanel({
  issues,
  errors,
  warnings,
  busy,
  checking,
  canAllocate,
  canValidate,
  onAllocate,
}: Props) {
  if (!canAllocate && !canValidate) return null;

  return (
    <section className="addressing" aria-labelledby="addressing-heading">
      <h2 className="panel__heading" id="addressing-heading">
        Addressing
      </h2>

      {canAllocate ? (
        <div className="addressing__actions">
          <button type="button" onClick={() => onAllocate(false)} disabled={busy}>
            Assign addresses
          </button>
          <button type="button" onClick={() => onAllocate(true)} disabled={busy}>
            Renumber all
          </button>
          <p className="addressing__hint">
            Assign fills in what is missing and leaves your own addresses alone.
            Renumber replaces every address.
          </p>
        </div>
      ) : (
        <p className="addressing__hint">
          The subnet calculator is disabled for this scenario. Plan the addressing yourself.
        </p>
      )}

      {canValidate && (
        <>
          {/* Announced politely so a check that finds nothing is still
              confirmed, rather than leaving silence to be interpreted. */}
          <p className="addressing__summary" data-severity={errors > 0 ? "error" : undefined}>
            {checking ? "Checking…" : summarise(errors, warnings)}
          </p>

          {issues.length > 0 && (
            <ul className="issue-list">
              {issues.map((issue, index) => {
                const severity = SEVERITY[issue.severity] ?? SEVERITY.warning!;
                return (
                  <li
                    key={`${issue.code}-${issue.collision_domain ?? ""}-${index}`}
                    className="issue"
                    data-severity={issue.severity}
                  >
                    <span className="issue__badge" aria-hidden="true">
                      {severity.glyph}
                    </span>
                    <span className="issue__text">
                      {/* The word, not just the glyph or the colour. */}
                      <strong className="issue__severity">{severity.label}:</strong>{" "}
                      {issue.message}
                    </span>
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
