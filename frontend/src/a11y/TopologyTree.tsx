/**
 * A keyboard- and screen-reader-navigable view of the same topology the
 * canvas draws.
 *
 * A drag-and-drop graph is effectively invisible to assistive technology, so
 * this is not a convenience — it is the accessible interface, and it is built
 * alongside the canvas rather than retrofitted (which is much harder).
 *
 * Equivalence, not just enumeration: a sighted user perceives an edge as a
 * line between two boxes. Listing "eth0 on collision domain A" does not convey
 * that. Each interface therefore also announces its neighbours, so the graph
 * structure is genuinely available without sight.
 *
 * Implements the ARIA tree pattern: roving tabindex, arrows to move, left/right
 * to collapse/expand, Home/End, Enter to select, Delete to remove.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Node, PendingEnd, Topology } from "../types";

interface Props {
  topology: Topology;
  selected: string[];
  /** The first end of a link being drawn in connect mode, if any. */
  pending?: PendingEnd | null;
  /**
   * In connect mode an interface row stands for its collision domain, which
   * is how a keyboard user joins a segment that two devices already share.
   */
  connectMode?: boolean;
  onSelectCollisionDomain?: (name: string) => void;
  /** `additive` extends the selection rather than replacing it. */
  onSelect: (name: string, additive: boolean) => void;
  onRemove?: (name: string) => void;
  /** Delete on an interface row: the keyboard route to removing a link. */
  onDisconnect?: (device: string, number: number) => void;
}

type Row =
  | { kind: "device"; id: string; node: Node; level: 1 }
  | { kind: "interface"; id: string; node: Node; index: number; level: 2 };

/** Who else sits on this collision domain, as "r2 eth0". */
function neighbours(topology: Topology, device: string, collisionDomain: string): string[] {
  const found: string[] = [];
  for (const node of topology.nodes) {
    for (const iface of node.interfaces) {
      if (iface.collision_domain === collisionDomain && node.name !== device) {
        found.push(`${node.name} eth${iface.number}`);
      }
    }
  }
  return found;
}

function describeInterface(topology: Topology, node: Node, index: number): string {
  const iface = node.interfaces[index]!;
  const parts = [`eth${iface.number}`, `collision domain ${iface.collision_domain}`];
  parts.push(iface.ip ? `address ${iface.ip}` : "no address");

  const others = neighbours(topology, node.name, iface.collision_domain);
  parts.push(
    others.length === 0
      ? "not connected to any other device"
      : `connected to ${others.join(", ")}`,
  );
  return parts.join(", ");
}

function describeDevice(node: Node): string {
  const count = node.interfaces.length;
  const interfaces = count === 1 ? "1 interface" : `${count} interfaces`;
  const daemons = node.daemons.length > 0 ? `, running ${node.daemons.join(", ")}` : "";
  return `${node.name}, ${node.kind}, ${interfaces}${daemons}`;
}

export function TopologyTree({
  topology,
  selected,
  pending,
  connectMode,
  onSelectCollisionDomain,
  onSelect,
  onRemove,
  onDisconnect,
}: Props) {
  const pendingDevice = pending?.kind === "device" ? pending.name : null;
  const pendingDomain = pending?.kind === "domain" ? pending.name : null;

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<string | null>(null);
  const containerRef = useRef<HTMLUListElement>(null);

  // Only visible rows participate in arrow navigation: a collapsed device's
  // interfaces must not be reachable, or focus appears to jump nowhere.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const node of topology.nodes) {
      out.push({ kind: "device", id: node.name, node, level: 1 });
      if (expanded.has(node.name)) {
        node.interfaces.forEach((iface, index) => {
          out.push({
            kind: "interface",
            id: `${node.name}:${iface.number}`,
            node,
            index,
            level: 2,
          });
        });
      }
    }
    return out;
  }, [topology, expanded]);

  // Keep the roving tabindex on a row that still exists after an edit.
  useEffect(() => {
    if (rows.length === 0) {
      setActive(null);
    } else if (active === null || !rows.some((r) => r.id === active)) {
      setActive(rows[0]!.id);
    }
  }, [rows, active]);

  const focusRow = useCallback((id: string) => {
    setActive(id);
    // The DOM id is escaped because device names may contain dots.
    const element = containerRef.current?.querySelector<HTMLElement>(
      `[data-row-id="${CSS.escape(id)}"]`,
    );
    element?.focus();
  }, []);

  const toggle = useCallback((name: string, open: boolean) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (open) next.add(name);
      else next.delete(name);
      return next;
    });
  }, []);

  const activate = (row: Row, additive: boolean) => {
    if (connectMode && row.kind === "interface") {
      const iface = row.node.interfaces[row.index];
      if (iface) onSelectCollisionDomain?.(iface.collision_domain);
      return;
    }
    // Ctrl/Cmd extends the selection, matching the canvas and the platform
    // convention for multi-select lists.
    onSelect(row.node.name, additive);
  };

  const onKeyDown = (event: React.KeyboardEvent, row: Row) => {
    const index = rows.findIndex((r) => r.id === row.id);
    const move = (to: number) => {
      const target = rows[to];
      if (target) {
        event.preventDefault();
        focusRow(target.id);
      }
    };

    switch (event.key) {
      case "ArrowDown":
        return move(index + 1);
      case "ArrowUp":
        return move(index - 1);
      case "Home":
        return move(0);
      case "End":
        return move(rows.length - 1);

      case "ArrowRight":
        event.preventDefault();
        if (row.kind === "device" && row.node.interfaces.length > 0) {
          if (!expanded.has(row.node.name)) toggle(row.node.name, true);
          else move(index + 1);
        }
        return;

      case "ArrowLeft":
        event.preventDefault();
        if (row.kind === "interface") focusRow(row.node.name);
        else if (expanded.has(row.node.name)) toggle(row.node.name, false);
        return;

      case "Enter":
      case " ":
        event.preventDefault();
        activate(row, event.ctrlKey || event.metaKey);
        return;

      case "Delete":
      case "Backspace":
        event.preventDefault();
        if (row.kind === "device") {
          onRemove?.(row.node.name);
        } else {
          // Removing a link without a pointer: the canvas route needs a click.
          const iface = row.node.interfaces[row.index];
          if (iface) onDisconnect?.(row.node.name, iface.number);
        }
        return;
    }
  };

  if (topology.nodes.length === 0) {
    return (
      <p className="tree-empty">
        No devices yet. Add one from the palette to begin building a topology.
      </p>
    );
  }

  return (
    <ul
      ref={containerRef}
      role="tree"
      aria-label="Network topology"
      aria-multiselectable="true"
      className="topology-tree"
    >
      {rows.map((row) => {
        const isDevice = row.kind === "device";
        const domain = isDevice ? null : row.node.interfaces[row.index]?.collision_domain ?? null;
        const isPending = isDevice
          ? row.node.name === pendingDevice
          : domain !== null && domain === pendingDomain;

        // Spoken, not merely highlighted: a screen-reader user needs to know
        // which end is waiting, and what activating a row will now do.
        const label =
          (isDevice ? describeDevice(row.node) : describeInterface(topology, row.node, row.index)) +
          (isPending ? ", first end of the new link" : "") +
          (connectMode && !isDevice && domain
            ? `, press Enter to use collision domain ${domain}`
            : "");

        return (
          <li key={row.id} role="none">
            <div
              role="treeitem"
              data-row-id={row.id}
              aria-level={row.level}
              aria-selected={selected.includes(row.node.name)}
              aria-expanded={
                isDevice && row.node.interfaces.length > 0
                  ? expanded.has(row.node.name)
                  : undefined
              }
              // Roving tabindex: one stop for the whole tree, then arrows.
              tabIndex={active === row.id ? 0 : -1}
              className={`tree-row tree-row--${row.kind}`}
              data-selected={selected.includes(row.node.name) || undefined}
              data-pending={isPending || undefined}
              onKeyDown={(event) => onKeyDown(event, row)}
              onFocus={() => setActive(row.id)}
              onClick={(event) => activate(row, event.ctrlKey || event.metaKey)}
            >
              {/* Shape and text carry the meaning; colour never does alone. */}
              <span aria-hidden="true" className="tree-row__marker">
                {isDevice ? kindGlyph(row.node.kind) : "└"}
              </span>
              <span className="tree-row__label">{label}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function kindGlyph(kind: Node["kind"]): string {
  switch (kind) {
    case "router":
      return "◆";
    case "switch":
      return "▬";
    case "pc":
      return "▢";
    case "server":
      return "▤";
  }
}
