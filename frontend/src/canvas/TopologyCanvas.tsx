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
  applyNodeChanges,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PendingEnd, Topology } from "../types";

interface Props {
  topology: Topology;
  selected: string[];
  onSelect: (name: string | null, additive: boolean) => void;
  onMove: (name: string, position: { x: number; y: number }) => void;
  /** The first end of a link being drawn in connect mode, if any. */
  pending?: PendingEnd | null;
  /**
   * A collision domain was chosen. Fired by clicking its node, or the link
   * itself when only two devices share it and there is no node to click.
   */
  onSelectCollisionDomain?: (name: string) => void;
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

/** Where to place a collision-domain node: the centroid of its members. */
function centroid(points: { x: number; y: number }[]): { x: number; y: number } {
  if (points.length === 0) return { x: 0, y: 0 };
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

export function TopologyCanvas({
  topology,
  selected,
  pending,
  onSelect,
  onMove,
  onSelectCollisionDomain,
}: Props) {
  const pendingDevice = pending?.kind === "device" ? pending.name : null;
  const pendingDomain = pending?.kind === "domain" ? pending.name : null;

  const { nodes: derivedNodes, edges } = useMemo(() => {
    const flowNodes: FlowNode[] = topology.nodes.map((node) => ({
      id: node.name,
      position: node.position,
      selected: selected.includes(node.name),
      data: { label: `${node.name}\n${node.kind}` },
      className: `device device--${node.kind}${node.name === pendingDevice ? " device--pending" : ""}`,
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
          label: cd.subnet ? `${cd.name} · ${cd.subnet}` : cd.name,
          // Carried in data so a click can resolve the domain without
          // having to parse it back out of the id.
          data: { collisionDomain: cd.name },
          className: `link${cd.name === pendingDomain ? " link--pending" : ""}`,
        });
        continue;
      }

      // Shared medium: give it a node of its own so the topology is honest.
      const hubId = `cd:${cd.name}`;
      flowNodes.push({
        id: hubId,
        position: centroid(members.map((m) => m.node.position)),
        data: {
          label: `${cd.name}${cd.subnet ? `\n${cd.subnet}` : ""}`,
          collisionDomain: cd.name,
        },
        className: `collision-domain${cd.name === pendingDomain ? " collision-domain--pending" : ""}`,
      });
      for (const member of members) {
        flowEdges.push({
          id: `${hubId}->${member.node.name}:${member.iface.number}`,
          source: member.node.name,
          target: hubId,
          data: { collisionDomain: cd.name },
          className: `link${cd.name === pendingDomain ? " link--pending" : ""}`,
        });
      }
    }

    return { nodes: flowNodes, edges: flowEdges };
  }, [topology, selected, pendingDevice, pendingDomain]);

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

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((current) => applyNodeChanges(changes, current));

      for (const change of changes) {
        // Commit only when the drag ends: recording every intermediate frame
        // would flood the operation log and make undo useless.
        if (change.type === "position" && change.dragging === false && change.position) {
          if (!change.id.startsWith("cd:")) onMove(change.id, change.position);
        }
      }
    },
    [onMove],
  );

  return (
    <div className="canvas" aria-hidden="true">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onNodeClick={(event, node) => {
          const domain = node.data?.collisionDomain;
          if (typeof domain === "string") onSelectCollisionDomain?.(domain);
          else onSelect(node.id, event.ctrlKey || event.metaKey);
        }}
        onEdgeClick={(_, edge) => {
          // A two-device domain has no node of its own, so the link stands in
          // for it. Clicking a link therefore means "this collision domain".
          const domain = edge.data?.collisionDomain;
          if (typeof domain === "string") onSelectCollisionDomain?.(domain);
        }}
        onPaneClick={() => onSelect(null, false)}
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
