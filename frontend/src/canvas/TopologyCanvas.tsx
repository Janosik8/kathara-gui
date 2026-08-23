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
import { useCallback, useMemo } from "react";
import type { Topology } from "../types";

interface Props {
  topology: Topology;
  selected: string[];
  onSelect: (name: string | null, additive: boolean) => void;
  onMove: (name: string, position: { x: number; y: number }) => void;
  /** The first end of a link being drawn in connect mode, if any. */
  pending?: string | null;
}

/** Where to place a collision-domain node: the centroid of its members. */
function centroid(points: { x: number; y: number }[]): { x: number; y: number } {
  if (points.length === 0) return { x: 0, y: 0 };
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

export function TopologyCanvas({ topology, selected, pending, onSelect, onMove }: Props) {
  const { nodes, edges } = useMemo(() => {
    const flowNodes: FlowNode[] = topology.nodes.map((node) => ({
      id: node.name,
      position: node.position,
      selected: selected.includes(node.name),
      data: { label: `${node.name}\n${node.kind}` },
      className: `device device--${node.kind}${node.name === pending ? " device--pending" : ""}`,
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
          label: cd.subnet ?? cd.name,
          className: "link",
        });
        continue;
      }

      // Shared medium: give it a node of its own so the topology is honest.
      const hubId = `cd:${cd.name}`;
      flowNodes.push({
        id: hubId,
        position: centroid(members.map((m) => m.node.position)),
        data: { label: `${cd.name}${cd.subnet ? `\n${cd.subnet}` : ""}` },
        className: "collision-domain",
        selectable: false,
      });
      for (const member of members) {
        flowEdges.push({
          id: `${hubId}->${member.node.name}:${member.iface.number}`,
          source: member.node.name,
          target: hubId,
          className: "link",
        });
      }
    }

    return { nodes: flowNodes, edges: flowEdges };
  }, [topology, selected, pending]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const change of changes) {
        // Commit only when the drag ends: recording every intermediate frame
        // would flood the operation log and make undo useless.
        if (change.type === "position" && change.dragging === false && change.position) {
          if (!change.id.startsWith("cd:")) onMove(change.id, change.position);
        }
      }
      // React Flow needs the call for its internal bookkeeping; the topology
      // itself remains driven by the store.
      applyNodeChanges(changes, nodes);
    },
    [nodes, onMove],
  );

  return (
    <div className="canvas" aria-hidden="true">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onNodeClick={(event, node) => onSelect(node.id, event.ctrlKey || event.metaKey)}
        onPaneClick={() => onSelect(null, false)}
        snapToGrid
        snapGrid={[16, 16]}
        fitView
        proOptions={{ hideAttribution: false }}
      >
        <Background gap={16} />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}
