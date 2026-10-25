/**
 * The visual topology editor.
 *
 * A Kathara collision domain is a shared medium, not a cable. Drawing every
 * one as a line between two boxes would be a lie as soon as three devices
 * share it, so:
 *
 *  - exactly two members  -> a direct edge, which is what a user means by "a link"
 *  - three or more        -> an explicit collision-domain node they all attach to
 *
 * The canvas is one focus stop and is marked `aria-hidden`: it is a visual
 * rendering of state that `TopologyTree` presents accessibly. Duplicating it
 * into the accessibility tree would force a screen-reader user through a
 * second, worse copy of the same information.
 */

import {
  Background,
  Controls,
  type Edge,
  MiniMap,
  type Node as FlowNode,
  type NodeChange,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useUpdateNodeInternals,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PendingEnd, Topology } from "../types";
import { DeviceNode } from "./DeviceNode";
import { SegmentEdge } from "./SegmentEdge";
import { type Placement, computePlacements, domainPosition, segmentPosition } from "./layout";

// Registered outside the component: a new object each render would remount
// every node and lose their measurements.
const NODE_TYPES = { device: DeviceNode };
const EDGE_TYPES = { segment: SegmentEdge };

/**
 * How far, in pixels, the pointer may move between press and release and the
 * press still count as a click. d3-drag's own convention is a few pixels;
 * React Flow's default of 0 swallowed clicks with ordinary hand movement.
 */
export const NODE_CLICK_DISTANCE = 5;

interface Props {
  topology: Topology;
  selected: string[];
  onSelect: (name: string | null, additive: boolean) => void;
  onMove: (name: string, position: { x: number; y: number }) => void;
  /** A shared segment's node was dragged to a new place. */
  onMoveDomain?: (name: string, position: { x: number; y: number }) => void;
  /** The first end of a link being drawn in connect mode, if any. */
  pending?: PendingEnd | null;
  /**
   * A collision domain was chosen. Fired by clicking its node, or the link
   * itself when only two devices share it and there is no node to click.
   */
  onSelectCollisionDomain?: (name: string) => void;
  /** A link was clicked outside connect mode, so it becomes the selection. */
  onSelectLink?: (collisionDomain: string | null) => void;
  /** The link currently selected, if any. */
  selectedLink?: string | null;
  /** True while connect mode is on, when a click means "pick an end" instead. */
  connectMode?: boolean;
  /**
   * True while the lab is deployed. Devices can still be selected, so their
   * details can be read, but not dragged: a move would be an edit, and the
   * design is read-only until the lab is stopped.
   */
  locked?: boolean;
  /** A device was dragged while locked: say why it does not move (test step 3A.3). */
  onLockedEdit?: () => void;
}

/**
 * Re-derive nodes from the topology while carrying measurements across.
 *
 * React Flow measures each rendered node and reports the size back through a
 * `dimensions` change. The minimap sizes its rectangles from `node.measured`,
 * so dropping those measurements on a re-render leaves it blank and gives the
 * viewport box no content bounds to sit against.
 *
 * Exported for testing: jsdom cannot lay anything out, so the merge is where
 * the behaviour can actually be verified.
 */
export function mergeMeasurements(
  derived: FlowNode[],
  previous: readonly FlowNode[],
): FlowNode[] {
  const measured = new Map(previous.map((n) => [n.id, n.measured]));
  return derived.map((node) => ({
    ...node,
    measured: measured.get(node.id) ?? node.measured,
  }));
}

/**
 * A fingerprint of where every handle currently sits.
 *
 * React Flow caches the measured bounds of each handle. Those bounds go stale
 * whenever a handle appears, disappears **or moves** — and handles move here
 * whenever the geometry changes, since an interface sits on the face pointing
 * at its peer. A stale bound leaves the edge drawn to the old spot, which is
 * why a freshly made link looked misaligned until the node was dragged.
 *
 * Position counts, but only when the node is not being dragged. An earlier
 * version excluded position outright, reasoning that re-measuring on every
 * drag frame would be waste — true, but it conflated *moving* with
 * *dragging*. Tidy layout, align and distribute all move a node without a
 * drag, and left the interfaces and links attached where the device used to
 * be until the user nudged it by hand. Collapsing a dragged node's position to
 * a constant keeps the frame-by-frame saving and re-measures once when the
 * drag ends.
 *
 * Computed from the *rendered* nodes rather than the topology, so it changes
 * only once the DOM actually carries the new placements. Measuring earlier
 * would measure the previous layout.
 */
export { domainPosition };

export function placementSignature(nodes: readonly FlowNode[]): string {
  return nodes
    .map((node) => {
      // Rounded: sub-pixel jitter is not a move worth re-measuring for.
      const where = node.dragging
        ? "dragging"
        : `${Math.round(node.position.x)},${Math.round(node.position.y)}`;
      const placements = (node.data as { placements?: Map<number, Placement> })?.placements;
      if (!placements) return `${node.id}@${where}`;
      const handles = [...placements.entries()]
        .sort(([a], [b]) => a - b)
        .map(([number, p]) => `${number}${p.position}${p.offset}`)
        .join(",");
      return `${node.id}@${where}[${handles}]`;
    })
    .join("|");
}

function CanvasInner({
  topology,
  selected,
  pending,
  onSelect,
  onMove,
  onMoveDomain,
  onSelectCollisionDomain,
  onSelectLink,
  selectedLink,
  connectMode,
  locked = false,
  onLockedEdit,
}: Props) {
  const pendingDevice = pending?.kind === "device" ? pending.name : null;
  const pendingDomain = pending?.kind === "domain" ? pending.name : null;

  const { nodes: derivedNodes, edges } = useMemo(() => {
    // Interfaces sit on the face pointing at whatever they connect to, so a
    // link leaves in the direction it actually travels.
    const placements = computePlacements(topology);

    const flowNodes: FlowNode[] = topology.nodes.map((node) => ({
      id: node.name,
      type: "device",
      position: node.position,
      selected: selected.includes(node.name),
      data: {
        label: node.name,
        kind: node.kind,
        interfaces: [...node.interfaces].sort((a, b) => a.number - b.number),
        loopbacks: node.loopbacks ?? [],
        placements: placements.get(node.name) ?? new Map(),
        pending: node.name === pendingDevice,
      },
    }));

    const flowEdges: Edge[] = [];

    for (const cd of topology.collision_domains) {
      const members = topology.nodes.flatMap((node) =>
        node.interfaces
          .filter((iface) => iface.collision_domain === cd.name)
          .map((iface) => ({ node, iface })),
      );
      if (members.length === 0) continue;

      if (members.length === 2) {
        const [a, b] = members as [(typeof members)[0], (typeof members)[0]];
        flowEdges.push({
          id: `cd:${cd.name}`,
          source: a.node.name,
          target: b.node.name,
          // Terminate at the interface actually in use, so the diagram shows
          // which port a link enters.
          sourceHandle: `eth${a.iface.number}`,
          targetHandle: `eth${b.iface.number}`,
          label: cd.subnet ? `${cd.name} · ${cd.subnet}` : cd.name,
          // Carried in data so a click can resolve the domain without
          // having to parse it back out of the id.
          data: { collisionDomain: cd.name },
          className: `link${cd.name === pendingDomain ? " link--pending" : ""}${
            cd.name === selectedLink ? " link--selected" : ""
          }`,
        });
        continue;
      }

      // Shared medium: give it a node of its own so the topology is honest.
      const hubId = `cd:${cd.name}`;
      flowNodes.push({
        id: hubId,
        position: segmentPosition(topology, cd.name),
        // Selected as the link it stands for, so Delete removes the whole
        // segment (test step 1D.2: clicking it used to do nothing).
        selected: cd.name === selectedLink,
        data: {
          label: `${cd.name}${cd.subnet ? `\n${cd.subnet}` : ""}`,
          collisionDomain: cd.name,
        },
        className: `collision-domain${cd.name === pendingDomain ? " collision-domain--pending" : ""}${
          cd.name === selectedLink ? " collision-domain--selected" : ""
        }`,
      });
      for (const member of members) {
        flowEdges.push({
          id: `${hubId}->${member.node.name}:${member.iface.number}`,
          source: member.node.name,
          target: hubId,
          sourceHandle: `eth${member.iface.number}`,
          // Ends on the node's outline, on the side it comes from.
          type: "segment",
          data: { collisionDomain: cd.name },
          className: `link${cd.name === pendingDomain ? " link--pending" : ""}${
            cd.name === selectedLink ? " link--selected" : ""
          }`,
        });
      }
    }

    return { nodes: flowNodes, edges: flowEdges };
  }, [topology, selected, pendingDevice, pendingDomain, selectedLink]);

  /**
   * React Flow's own view of the nodes.
   *
   * The topology stays the source of truth for *what* exists and where it
   * sits, but React Flow measures each rendered node and reports the size
   * back through a `dimensions` change. Those measurements have to be kept:
   * the minimap sizes its rectangles from `node.measured`, so discarding them
   * leaves it with nothing to draw and no content bounds for the viewport box.
   */
  const [nodes, setNodes] = useState<FlowNode[]>(derivedNodes);

  useEffect(() => {
    setNodes((current) => mergeMeasurements(derivedNodes, current));
  }, [derivedNodes]);

  // Re-measure whenever a handle appears, disappears or moves. Keyed off the
  // rendered nodes so the DOM already carries the new placements.
  const updateNodeInternals = useUpdateNodeInternals();
  const signature = useMemo(() => placementSignature(nodes), [nodes]);

  useEffect(() => {
    for (const node of nodes) updateNodeInternals(node.id);
    // `signature` is the real dependency; `nodes` changes on every drag frame
    // and re-measuring then would be pure waste.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, updateNodeInternals]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // Locked, a drag is still let start, so it can be answered with a
      // reason, but none of its moves is applied.
      if (locked) changes = changes.filter((change) => change.type !== "position");
      setNodes((current) => applyNodeChanges(changes, current));

      for (const change of changes) {
        // Commit only when the drag ends: recording every intermediate frame
        // would flood the operation log and make undo useless.
        if (change.type === "position" && change.dragging === false && change.position) {
          if (change.id.startsWith("cd:")) onMoveDomain?.(change.id.slice(3), change.position);
          else onMove(change.id, change.position);
        }
      }
    },
    [onMove, onMoveDomain, locked],
  );

  return (
    <div className="canvas" aria-hidden="true">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodesChange={onNodesChange}
        onNodeClick={(event, node) => {
          const domain = node.data?.collisionDomain;
          if (typeof domain !== "string") onSelect(node.id, event.ctrlKey || event.metaKey);
          // The same rule as a link: in connect mode it is an end to join,
          // otherwise it is selected so it can be deleted.
          else if (connectMode) onSelectCollisionDomain?.(domain);
          else onSelectLink?.(domain);
        }}
        onEdgeClick={(_, edge) => {
          const domain = edge.data?.collisionDomain;
          if (typeof domain !== "string") return;
          // In connect mode a link stands in for its collision domain, since a
          // two-device domain has no node of its own to click. Otherwise
          // clicking a link selects it, so it can be deleted.
          if (connectMode) onSelectCollisionDomain?.(domain);
          else onSelectLink?.(domain);
        }}
        onPaneClick={() => {
          onSelect(null, false);
          onSelectLink?.(null);
        }}
        // Two defaults made clicking on a device unreliable (test step 1A.5,
        // "I often have to click a router 2 or 3 times"). React Flow hands
        // nodeClickDistance to d3-drag, where it defaults to 0: a single pixel
        // of hand movement between press and release turns the click into a
        // drag and swallows it. A few pixels is what any pointer needs. And in
        // connect mode a press can only mean "this end", so nothing drags.
        // Draggable even when locked: refusing the drag outright made it
        // silent, so it starts, moves nothing, and says why.
        nodesDraggable={!connectMode}
        onNodeDragStart={locked ? () => onLockedEdit?.() : undefined}
        nodeClickDistance={NODE_CLICK_DISTANCE}
        snapToGrid
        snapGrid={[16, 16]}
        fitView
        proOptions={{ hideAttribution: false }}
      >
        <Background gap={16} />
        <Controls />
        <MiniMap
          pannable
          zoomable
          ariaLabel={null}
          // Outline as well as fill, so a device is still discernible in the
          // minimap when the fill is close to the background.
          nodeStrokeWidth={2}
          nodeBorderRadius={3}
        />
      </ReactFlow>
    </div>
  );
}

/**
 * `useUpdateNodeInternals` reads React Flow's store, so it may only be called
 * from a component *inside* `ReactFlow` or a provider — not from the one that
 * renders it. Hence the wrapper.
 */
export function TopologyCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
