/**
 * One section of a side panel, collapsible and movable (the tester's
 * note 3).
 *
 * The heading is a button, the disclosure pattern: one press collapses the
 * section to its heading and the next opens it again, and `aria-expanded`
 * says which state it is in. The ▲ and ▼ buttons move the section within its
 * panel, and the header can also be dragged. **Not drag-only**, for the
 * reason PanelResizer gives: the buttons do everything the drag does, with
 * the keyboard.
 *
 * **The header sits outside the edit lock.** While a lab runs the design is
 * read-only (D9), and a disabled fieldset disables every control inside it —
 * a collapse button inside one could not be pressed. So only the body is
 * locked, and arranging the panels stays possible, since it changes nothing
 * in the design.
 */

import { type DragEvent, type PointerEvent, type ReactNode, useEffect, useRef, useState } from "react";

export type PanelSide = "left" | "right";

interface Props {
  side: PanelSide;
  /** The section's id in the stored layout, e.g. "lab". */
  id: string;
  title: string;
  /** The heading's DOM id; content inside may be labelled by it. */
  headingId: string;
  index: number;
  count: number;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** Move this section one place up (-1) or down (1) among those shown. */
  onMove: (direction: -1 | 1) => void;
  /** Move the dragged section `dragged` next to this one. */
  onDropSection: (dragged: string, after: boolean) => void;
  /** Wrap the body in the edit lock, which then disables its controls. */
  lock?: { locked: boolean; onPointerDown: (event: PointerEvent) => void };
  /**
   * Something inside wants an answer — a confirmation, a result. A collapsed
   * section opens rather than leaving the question unseen behind a heading.
   */
  attention?: boolean;
  className?: string;
  children: ReactNode;
}

/** The drag's data type names the panel, so a section cannot cross panels. */
const dragType = (side: PanelSide) => `application/x-kgui-section-${side}`;

export function PanelSection({
  side,
  id,
  title,
  headingId,
  index,
  count,
  collapsed,
  onCollapsedChange,
  onMove,
  onDropSection,
  lock,
  attention = false,
  className,
  children,
}: Props) {
  const bodyId = `${headingId}-body`;
  const [dropAt, setDropAt] = useState<"before" | "after" | null>(null);

  useEffect(() => {
    if (attention && collapsed) onCollapsedChange(false);
  }, [attention, collapsed, onCollapsedChange]);

  // A moved section's buttons keep focus, so ▲ can be pressed repeatedly. The
  // one that moved it may now be disabled at the end of the panel; then focus
  // goes to the other, never to the page.
  const up = useRef<HTMLButtonElement>(null);
  const down = useRef<HTMLButtonElement>(null);
  const refocus = useRef<"up" | "down" | null>(null);
  useEffect(() => {
    const which = refocus.current;
    if (which === null) return;
    refocus.current = null;
    const preferred = which === "up" ? up.current : down.current;
    const other = which === "up" ? down.current : up.current;
    (preferred && !preferred.disabled ? preferred : other)?.focus();
  }, [index]);

  const move = (direction: "up" | "down") => {
    refocus.current = direction;
    onMove(direction === "up" ? -1 : 1);
  };

  const accepts = (event: DragEvent) => event.dataTransfer.types.includes(dragType(side));
  const half = (event: DragEvent): "before" | "after" => {
    const box = event.currentTarget.getBoundingClientRect();
    return event.clientY > box.top + box.height / 2 ? "after" : "before";
  };

  const body = (
    <div id={bodyId} className="panel-section__body" hidden={collapsed}>
      {children}
    </div>
  );

  return (
    <section
      className={[
        "panel-section",
        className,
        collapsed && "panel-section--collapsed",
        dropAt && `panel-section--drop-${dropAt}`,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-labelledby={headingId}
      data-section={id}
      onDragOver={(event) => {
        if (!accepts(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropAt(half(event));
      }}
      onDragLeave={(event) => {
        // Leaving for a child is not leaving the section.
        if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) {
          setDropAt(null);
        }
      }}
      onDrop={(event) => {
        if (!accepts(event)) return;
        event.preventDefault();
        setDropAt(null);
        const dragged = event.dataTransfer.getData(dragType(side));
        if (dragged && dragged !== id) onDropSection(dragged, half(event) === "after");
      }}
    >
      <div
        className="panel-section__header"
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData(dragType(side), id);
          event.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={() => setDropAt(null)}
      >
        <span className="panel-section__grip" aria-hidden="true" title="Drag to move">
          ⠿
        </span>
        <h2 className="panel__heading panel-section__heading" id={headingId}>
          <button
            type="button"
            className="panel-section__toggle"
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            onClick={() => onCollapsedChange(!collapsed)}
          >
            <span className="panel-section__chevron" aria-hidden="true">
              {collapsed ? "▸" : "▾"}
            </span>
            {title}
          </button>
        </h2>
        <button
          ref={up}
          type="button"
          className="panel-section__move"
          aria-label={`Move ${title} up`}
          title={`Move ${title} up`}
          disabled={index === 0}
          onClick={() => move("up")}
        >
          ▲
        </button>
        <button
          ref={down}
          type="button"
          className="panel-section__move"
          aria-label={`Move ${title} down`}
          title={`Move ${title} down`}
          disabled={index === count - 1}
          onClick={() => move("down")}
        >
          ▼
        </button>
      </div>

      {lock ? (
        <fieldset className="edit-lock" disabled={lock.locked} onPointerDown={lock.onPointerDown}>
          {body}
        </fieldset>
      ) : (
        body
      )}
    </section>
  );
}

/** A panel's arrangement: the sections top to bottom, and which are closed. */
export interface PanelLayout {
  order: string[];
  collapsed: string[];
  /** The whole panel hidden, leaving the canvas its room (note 6). */
  hidden?: boolean;
}

/**
 * `layout` with `section` moved one place among `shown`, the sections on
 * screen. A section hidden for now (no collision domains yet) keeps its place
 * rather than costing a press to step over.
 */
export function moveSection(
  layout: PanelLayout,
  shown: string[],
  section: string,
  direction: -1 | 1,
): PanelLayout {
  const neighbour = shown[shown.indexOf(section) + direction];
  if (neighbour === undefined) return layout;
  return dropSection(layout, section, neighbour, direction === 1);
}

/** `layout` with `dragged` placed just before or after `target`. */
export function dropSection(
  layout: PanelLayout,
  dragged: string,
  target: string,
  after: boolean,
): PanelLayout {
  const order = layout.order.filter((s) => s !== dragged);
  const at = order.indexOf(target);
  if (at < 0) return layout;
  order.splice(after ? at + 1 : at, 0, dragged);
  return { ...layout, order };
}

export function setCollapsed(layout: PanelLayout, section: string, collapsed: boolean): PanelLayout {
  const rest = layout.collapsed.filter((s) => s !== section);
  return { ...layout, collapsed: collapsed ? [...rest, section] : rest };
}
