/**
 * The feature switches, in the section of that name, and the exam author's
 * lock on them (FR-28, the tester's note 1).
 *
 * An instructor switches off the subnet calculator, the addressing checks or
 * the link verification. The server refuses what is off, so hiding a button
 * is not the whole of it. Locking the switches with a password then makes them
 * the author's: nobody can change them in the application without it.
 *
 * **Tamper-evident, not tamper-proof**, and the panel says so. The scenario
 * is a folder on the student's machine, so a student can edit `kgui.json` by
 * hand. What the lock guarantees is that the author sees it: unlocking reports
 * switches changed outside the application, and a lock removed or replaced
 * does not open with the author's password. A copy of the original `kgui.json`
 * put back before handing in shows nothing (F51); the lock was removed for
 * that and restored by the user's decision (D13), and the panel says so.
 */

import { useState } from "react";
import type { ExamState, Features } from "../api/client";
import { Explanation } from "./Explain";

/** The shortest password the server accepts. */
export const MIN_PASSWORD = 4;

const SWITCHES: [keyof Features, string][] = [
  ["subnet_calculator", "Subnet calculator"],
  ["addressing_validation", "Addressing checks"],
  ["infrastructure_verification", "Link verification"],
  ["interface_addresses", "Addresses on the canvas"],
];

interface Props {
  features: Features;
  exam: ExamState;
  /** The last unlock's verdict: false if the switches were changed outside. */
  intact: boolean | null;
  busy: boolean;
  onSetFeatures: (features: Features) => void;
  onLock: (password: string) => void;
  onUnlock: (password: string) => void;
  onRelock: () => void;
  onRemoveLock: () => void;
}

export function ExamPanel({
  features,
  exam,
  intact,
  busy,
  onSetFeatures,
  onLock,
  onUnlock,
  onRelock,
  onRemoveLock,
}: Props) {
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const frozen = exam.locked && !exam.unlocked;

  const short = password.length > 0 && password.length < MIN_PASSWORD;
  const mismatch = repeat.length > 0 && repeat !== password;
  const canLock = password.length >= MIN_PASSWORD && repeat === password;

  const submit = (action: (password: string) => void) => {
    action(password);
    setPassword("");
    setRepeat("");
  };

  return (
    <div className="exam">
      <Explanation>
        Switched off, the calculator, the checks and link verification are refused by the
        application, not only hidden. Addresses on the canvas shows the end of each
        interface&apos;s address beside its name, such as .1; it only changes the view. Locking
        keeps the switches as they are until the author&apos;s password is given.
      </Explanation>

      <fieldset className="exam__switches" disabled={frozen || busy}>
        <legend className="field__label">Features allowed</legend>
        {SWITCHES.map(([key, label]) => (
          <label key={key} className="checkbox">
            <input
              type="checkbox"
              checked={features[key]}
              onChange={(e) => onSetFeatures({ ...features, [key]: e.target.checked })}
            />
            {label}
          </label>
        ))}
      </fieldset>

      {intact === false && (
        <p className="confirm__warning" role="alert">
          <strong>Warning:</strong> these switches were changed outside this application after
          the author locked them.
        </p>
      )}

      {!exam.locked ? (
        <>
          <p className="field__hint">Not locked: anyone can change the switches.</p>
          <label className="field" htmlFor="exam-password">
            <span className="field__label">Author&apos;s password</span>
            <input
              id="exam-password"
              type="password"
              autoComplete="new-password"
              value={password}
              aria-invalid={short ? true : undefined}
              aria-describedby={short ? "exam-password-error" : undefined}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {short && (
            <p className="field__error" id="exam-password-error">
              <strong>Invalid:</strong> at least {MIN_PASSWORD} characters.
            </p>
          )}
          <label className="field" htmlFor="exam-password-repeat">
            <span className="field__label">The password again</span>
            <input
              id="exam-password-repeat"
              type="password"
              autoComplete="new-password"
              value={repeat}
              aria-invalid={mismatch ? true : undefined}
              aria-describedby={mismatch ? "exam-password-repeat-error" : undefined}
              onChange={(e) => setRepeat(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canLock) submit(onLock);
              }}
            />
          </label>
          {mismatch && (
            <p className="field__error" id="exam-password-repeat-error">
              <strong>Invalid:</strong> the two passwords differ.
            </p>
          )}
          <Explanation>
            The password is not stored and cannot be recovered. A student can still edit the
            scenario&apos;s files by hand; the lock makes that visible to you when you unlock
            the submission, it does not prevent it. A copy of the original file put back
            before handing in shows nothing at all.
          </Explanation>
          <div className="lab__actions">
            <button type="button" onClick={() => submit(onLock)} disabled={!canLock || busy}>
              Lock the switches
            </button>
          </div>
        </>
      ) : frozen ? (
        <>
          <p className="field__hint">
            <strong>Locked</strong> by the exam&apos;s author. The switches change only with the
            author&apos;s password.
          </p>
          <label className="field" htmlFor="exam-unlock">
            <span className="field__label">Author&apos;s password</span>
            <input
              id="exam-unlock"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && password) submit(onUnlock);
              }}
            />
          </label>
          <div className="lab__actions">
            <button type="button" onClick={() => submit(onUnlock)} disabled={!password || busy}>
              Unlock
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="field__hint">
            <strong>Unlocked</strong> for this session. The lock stays on the scenario and is
            signed again over any switch you change.
          </p>
          <div className="lab__actions">
            <button type="button" onClick={onRelock} disabled={busy}>
              Lock again
            </button>
            <button type="button" onClick={onRemoveLock} disabled={busy}>
              Remove the lock
            </button>
          </div>
        </>
      )}
    </div>
  );
}
