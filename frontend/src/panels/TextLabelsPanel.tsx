/**
 * Text labels: words placed anywhere on the canvas, at a size of their own
 * (FR-51), such as a zone's title outside the zone or a note beside a link.
 *
 * **Add text label** can be dragged onto the canvas, and the label lands where
 * it is dropped. Pressed, it puts one above the selected devices, or above
 * the lab, which is the keyboard way to place one. Its words and size are
 * changed here; on the canvas it is dragged wherever it is wanted.
 */

import { useEffect, useState } from "react";
import { newText, sizeProblem } from "../canvas/texts";
import type { Operation } from "../store/operations";
import { TEXT_SIZE_MAX, TEXT_SIZE_MIN, type Topology } from "../types";
import { CommittedInput } from "./CommittedInput";
import { Explanation } from "./Explain";

/** What the Add button carries when dragged, read by the canvas on drop. */
export const TEXT_DRAG_TYPE = "application/x-kgui-text";

interface Props {
  topology: Topology;
  /** Selected devices, by name. */
  selected: string[];
  selectedText: string | null;
  onSelectText: (id: string | null) => void;
  onDispatch: (op: Operation) => void;
  /** A label just added, whose words should be ready to type over. */
  focusText?: string | null;
  onFocused?: () => void;
}

export function TextLabelsPanel({
  topology,
  selected,
  selectedText,
  onSelectText,
  onDispatch,
  focusText = null,
  onFocused,
}: Props) {
  const texts = topology.texts ?? [];
  // Added by the button here; `focusText` is one dropped on the canvas.
  const [added, setAdded] = useState<string | null>(null);
  const toFocus = added ?? focusText;

  // Its words selected, so typing replaces them. Once its field exists.
  useEffect(() => {
    if (toFocus === null) return;
    const field = document.getElementById(`text-words-${toFocus}`);
    if (!(field instanceof HTMLInputElement)) return;
    field.focus();
    field.select();
    setAdded(null);
    onFocused?.();
  }, [toFocus, texts, onFocused]);

  return (
    <>
      <Explanation>
        A text label is for the reader only: Kathará never sees it. Drag <strong>Add text
        label</strong> onto the canvas to put one where you drop it, then drag it anywhere,
        inside a zone or outside.
      </Explanation>
      <div className="lab__actions">
        <button
          type="button"
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData(TEXT_DRAG_TYPE, "text");
            event.dataTransfer.effectAllowed = "copy";
          }}
          onClick={() => {
            const text = newText(topology, selected);
            onDispatch({ type: "addText", text });
            onSelectText(text.id);
            setAdded(text.id);
          }}
        >
          Add text label
        </button>
      </div>

      {texts.length > 0 && (
        <ul className="domain-list">
          {texts.map((label) => (
            <li
              key={label.id}
              className={`domain-list__item${label.id === selectedText ? " zone-list__item--selected" : ""}`}
            >
              <CommittedInput
                id={`text-words-${label.id}`}
                label="Text"
                value={label.text}
                validate={(draft) => (draft.trim() ? null : "a label needs some text.")}
                onCommit={(text) =>
                  onDispatch({
                    type: "updateText",
                    id: label.id,
                    changes: { text: text.trim() },
                    label: `Changed a text label to ${text.trim()}`,
                  })
                }
              />
              <CommittedInput
                id={`text-size-${label.id}`}
                label={`Font size (${TEXT_SIZE_MIN}–${TEXT_SIZE_MAX} px)`}
                value={String(label.size)}
                validate={sizeProblem}
                onCommit={(size) =>
                  onDispatch({
                    type: "updateText",
                    id: label.id,
                    changes: { size: Number(size.trim()) },
                    label: `Set ${label.text} to ${size.trim()} px`,
                  })
                }
              />
              <div className="lab__actions">
                <button
                  type="button"
                  disabled={selected.length === 0}
                  onClick={() =>
                    onDispatch({
                      type: "updateText",
                      id: label.id,
                      changes: { position: newText(topology, selected).position },
                      label: `Moved ${label.text} above the selected devices`,
                    })
                  }
                >
                  Move above selected devices
                </button>
                <button
                  type="button"
                  aria-label={`Delete text label ${label.text}`}
                  onClick={() => {
                    onDispatch({ type: "removeText", id: label.id });
                    if (label.id === selectedText) onSelectText(null);
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
