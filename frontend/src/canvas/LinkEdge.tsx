/**
 * A link between two devices, with a label that slides along it (FR-50).
 *
 * The same bezier React Flow draws by default. The label is HTML above the
 * canvas, at its place along the curve, and stays centred on the line: a drag
 * moves it to the point of the link nearest the pointer, never off it. A press
 * that does not move is a click on the link, as on the line itself.
 */

import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
  useReactFlow,
} from "@xyflow/react";
import { createContext, useContext, useRef, useState } from "react";
import { cubicPoint, nearestT, parseCubic } from "./linkLabel";

export interface LinkLabelActions {
  /** A label released at a new place along its link; told, when locked, to say why not. */
  onSlide?: (collisionDomain: string, at: number) => void;
  /** A label clicked: the same as clicking its link. */
  onClick?: (collisionDomain: string) => void;
  /** While a lab runs nothing on the canvas moves (D9). */
  locked: boolean;
}

export const LinkLabelContext = createContext<LinkLabelActions>({ locked: false });

/** The pointer may move this far, in screen pixels, and still click (as nodes). */
const CLICK_DISTANCE = 5;

export function LinkEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  label,
  data,
  style,
  markerEnd,
  interactionWidth,
}: EdgeProps) {
  const { onSlide, onClick, locked } = useContext(LinkLabelContext);
  const { screenToFlowPosition } = useReactFlow();
  const [path, midX, midY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const domain = typeof data?.collisionDomain === "string" ? data.collisionDomain : "";
  const stored = typeof data?.labelAt === "number" ? data.labelAt : null;

  // Where the label is while it is being dragged; null when it is not.
  const [dragging, setDragging] = useState<number | null>(null);
  const press = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const curve = parseCubic(path);
  const at = dragging ?? stored;
  const point = curve && at !== null ? cubicPoint(curve, at) : { x: midX, y: midY };

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={style}
        markerEnd={markerEnd}
        interactionWidth={interactionWidth}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            className={`link-label nodrag nopan${dragging !== null ? " link-label--dragging" : ""}${
              locked ? "" : " link-label--movable"
            }`}
            data-collision-domain={domain}
            style={{ transform: `translate(-50%, -50%) translate(${point.x}px, ${point.y}px)` }}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.stopPropagation();
              press.current = { x: event.clientX, y: event.clientY, moved: false };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const start = press.current;
              if (!start || !curve) return;
              if (
                !start.moved &&
                Math.hypot(event.clientX - start.x, event.clientY - start.y) <= CLICK_DISTANCE
              ) {
                return;
              }
              start.moved = true;
              // Locked, it stays put; the release says why.
              if (locked) return;
              const p = screenToFlowPosition({ x: event.clientX, y: event.clientY });
              setDragging(nearestT(curve, p));
            }}
            onPointerUp={(event) => {
              const start = press.current;
              press.current = null;
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
              if (!start) return;
              if (start.moved) onSlide?.(domain, dragging ?? stored ?? 0.5);
              else onClick?.(domain);
              setDragging(null);
            }}
            onPointerCancel={() => {
              press.current = null;
              setDragging(null);
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
