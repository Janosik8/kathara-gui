/**
 * The feature switches (FR-28), in the section of that name; an exam is their main use.
 *
 * An instructor switches off the subnet calculator, the addressing checks or
 * the link verification. The server refuses what is off, so hiding a button
 * is not the whole of it.
 *
 * What it cannot do is hold against the owner of the machine: the switches
 * live in the scenario's `kgui.json`, in a folder the student owns. An
 * author's password on them was built and removed (F48, F51), because a copy
 * of the original put back before handing in left nothing for it to find. The
 * panel says so rather than promise it.
 */

import type { Features } from "../api/client";
import { Explanation } from "./Explain";

const SWITCHES: [keyof Features, string][] = [
  ["subnet_calculator", "Subnet calculator"],
  ["addressing_validation", "Addressing checks"],
  ["infrastructure_verification", "Link verification"],
];

interface Props {
  features: Features;
  busy: boolean;
  onSetFeatures: (features: Features) => void;
}

export function ExamPanel({ features, busy, onSetFeatures }: Props) {
  return (
    <div className="exam">
      <Explanation>
        Switched off, a feature is refused by the application, not only hidden, and the
        switches travel with the scenario when it is exported. They are kept in the
        scenario&apos;s kgui.json, so whoever has the scenario on their own computer can edit
        them: they guide an exam, they do not police it.
      </Explanation>

      <fieldset className="exam__switches" disabled={busy}>
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
    </div>
  );
}
