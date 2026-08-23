import { useCallback, useEffect, useState } from "react";
import { LiveRegion } from "./a11y/LiveRegion";
import { TopologyTree } from "./a11y/TopologyTree";
import { ApiError, api } from "./api/client";
import { TopologyCanvas } from "./canvas/TopologyCanvas";
import { AlignmentToolbar } from "./panels/AlignmentToolbar";
import { ConnectModeBar } from "./panels/ConnectModeBar";
import { Inspector } from "./panels/Inspector";
import { Palette, suggestName } from "./panels/Palette";
import { ALIGNMENT_LABELS, type AlignmentAction, computeAlignment } from "./store/alignment";
import { useTopologyStore } from "./store/topology";
import { type DeviceKind, type PendingEnd, newNode, suggestCollisionDomain } from "./types";

/** Lay new devices out on a loose grid rather than stacking them at the origin. */
function placeNew(count: number) {
  const COLUMNS = 4;
  return { x: (count % COLUMNS) * 180, y: Math.floor(count / COLUMNS) * 140 };
}

/** True when the keystroke belongs to whatever the user is typing into. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName);
}

/**
 * True when focus is inside the tree, which owns Delete per the ARIA pattern.
 *
 * Scoped to Delete alone: an earlier version skipped *all* global shortcuts
 * here, which silently swallowed Escape and undo whenever focus was in the
 * tree — that is, for keyboard users specifically.
 */
function isTreeItem(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.getAttribute("role") === "treeitem";
}

export default function App() {
  const {
    topology,
    dispatch,
    load,
    undo,
    redo,
    canUndo,
    canRedo,
    lastAnnouncement,
    error,
    clearError,
    dirty,
  } = useTopologyStore();

  const [selected, setSelected] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  // Connect mode: click one device, then another, and a link appears — the
  // interaction people expect from a topology editor.
  const [connectMode, setConnectMode] = useState(false);
  const [pending, setPending] = useState<PendingEnd | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canConnect = topology.nodes.length >= 2;

  useEffect(() => {
    api
      .read()
      .then((state) => load(state.topology))
      .catch((err) => setStatus(err instanceof ApiError ? err.message : String(err)));
  }, [load]);

  // Drop devices that an edit or an undo removed, so neither an alignment nor a
  // half-finished link can refer to something that is gone.
  useEffect(() => {
    setSelected((current) => {
      const present = current.filter((name) => topology.nodes.some((n) => n.name === name));
      return present.length === current.length ? current : present;
    });
    setPending((current) => {
      if (current === null) return null;
      const stillThere =
        current.kind === "device"
          ? topology.nodes.some((n) => n.name === current.name)
          : topology.nodes.some((n) =>
              n.interfaces.some((i) => i.collision_domain === current.name),
            );
      return stillThere ? current : null;
    });
  }, [topology]);

  // Leaving connect mode must never strand a half-made link.
  const leaveConnectMode = useCallback((announce = true) => {
    setConnectMode(false);
    setPending(null);
    if (announce) setNotice("Left connect mode");
  }, []);

  const toggleConnectMode = useCallback(() => {
    if (connectMode) {
      leaveConnectMode();
    } else {
      setConnectMode(true);
      setPending(null);
      setNotice("Connect mode on. Choose the first device.");
    }
  }, [connectMode, leaveConnectMode]);

  const select = useCallback((name: string | null, additive: boolean) => {
    setSelected((current) => {
      if (name === null) return [];
      if (!additive) return [name];
      return current.includes(name)
        ? current.filter((n) => n !== name)
        : [...current, name];
    });
  }, []);

  /**
   * Resolve a pair of chosen ends into an edit.
   *
   * device + device -> a new collision domain joining them
   * device + domain -> that device joins the existing shared segment
   * domain + domain -> meaningless; refused rather than guessed at
   */
  const completeLink = useCallback(
    (first: PendingEnd, second: PendingEnd) => {
      if (first.kind === "domain" && second.kind === "domain") {
        setNotice("Two collision domains cannot be joined. Choose a device.");
        return;
      }
      // Clearing the notice lets the store's own description be announced.
      setNotice(null);

      if (first.kind === "device" && second.kind === "device") {
        dispatch({
          type: "link",
          a: first.name,
          b: second.name,
          collisionDomain: suggestCollisionDomain(topology),
        });
      } else {
        const device = first.kind === "device" ? first : second;
        const domain = first.kind === "domain" ? first : second;
        dispatch({ type: "connect", node: device.name, collisionDomain: domain.name });
      }
      // Stay in mode so several links can be drawn in a row.
      setPending(null);
    },
    [dispatch, topology],
  );

  const choose = useCallback(
    (end: PendingEnd) => {
      if (pending === null) {
        setPending(end);
        setNotice(
          end.kind === "device"
            ? `${end.name} selected. Now choose a device or a collision domain to link it to.`
            : `Collision domain ${end.name} selected. Now choose a device to add to it.`,
        );
        return;
      }
      if (pending.kind === end.kind && pending.name === end.name) {
        setPending(null);
        setNotice(`${end.name} deselected. Choose the first end.`);
        return;
      }
      completeLink(pending, end);
    },
    [completeLink, pending],
  );

  /**
   * What a click on a device means, which depends on the mode. Both the canvas
   * and the tree route through here, so the two cannot drift apart.
   */
  const activate = useCallback(
    (name: string | null, additive: boolean) => {
      if (!connectMode) {
        select(name, additive);
        return;
      }
      if (name === null) {
        // Clicking empty space abandons the half-made link but stays in mode.
        setPending(null);
        setNotice("Cancelled. Choose the first end.");
        return;
      }
      choose({ kind: "device", name });
    },
    [choose, connectMode, select],
  );

  const activateDomain = useCallback(
    (name: string) => {
      if (!connectMode) return;
      choose({ kind: "domain", name });
    },
    [choose, connectMode],
  );

  const addDevice = useCallback(
    (kind: DeviceKind) => {
      const name = suggestName(topology, kind);
      dispatch({
        type: "addNode",
        node: newNode(name, kind, placeNew(topology.nodes.length)),
      });
      setSelected([name]);
    },
    [dispatch, topology],
  );

  const removeSelected = useCallback(() => {
    for (const name of selected) dispatch({ type: "removeNode", name });
    setSelected([]);
  }, [dispatch, selected]);

  const align = useCallback(
    (action: AlignmentAction) => {
      const nodes = topology.nodes.filter((n) => selected.includes(n.name));
      const positions = computeAlignment(nodes, action);
      // An alignment that changes nothing should not create an undo step.
      if (Object.keys(positions).length === 0) return;
      dispatch({ type: "moveNodes", positions, label: `${ALIGNMENT_LABELS[action]} applied` });
    },
    [dispatch, selected, topology],
  );

  const save = useCallback(async () => {
    try {
      await api.save(topology);
      setStatus("Saved");
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : String(err));
    }
  }, [topology]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = isTextEntry(event.target);

      // Escape works everywhere except mid-edit, where the field uses it to
      // abandon the edit.
      if (event.key === "Escape" && connectMode && !typing) {
        event.preventDefault();
        leaveConnectMode();
        return;
      }

      if (typing) return;

      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (!meta && event.key.toLowerCase() === "c" && canConnect) {
        event.preventDefault();
        toggleConnectMode();
        return;
      }
      // The tree implements Delete itself, so do not act twice.
      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        selected.length > 0 &&
        !isTreeItem(event.target)
      ) {
        event.preventDefault();
        removeSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    undo,
    redo,
    removeSelected,
    selected,
    connectMode,
    leaveConnectMode,
    toggleConnectMode,
    canConnect,
  ]);

  return (
    <div className="app" data-connect-mode={connectMode || undefined}>
      <a className="skip-link" href="#topology">
        Skip to topology
      </a>

      <header className="app__header">
        <h1 className="app__title">
          Kathara GUI
          <span className="app__lab-name">{topology.name}</span>
          {dirty && (
            <span className="app__dirty" title="Unsaved changes">
              {/* Text, not just a dot: a colour or shape alone is not a status. */}
              Unsaved changes
            </span>
          )}
        </h1>

        <div className="app__actions" role="group" aria-label="Topology actions">
          <button type="button" onClick={undo} disabled={!canUndo()}>
            Undo
          </button>
          <button type="button" onClick={redo} disabled={!canRedo()}>
            Redo
          </button>
          <button type="button" onClick={removeSelected} disabled={selected.length === 0}>
            Delete
          </button>
          <button type="button" onClick={save}>
            Save
          </button>
        </div>
      </header>

      <div className="app__body">
        <aside className="panel" aria-label="Devices">
          <Palette topology={topology} onAdd={addDevice} />

          <ConnectModeBar
            active={connectMode}
            pending={pending}
            enabled={canConnect}
            onToggle={toggleConnectMode}
          />

          <h2 className="panel__heading" id="topology">
            Topology
          </h2>
          <TopologyTree
            topology={topology}
            selected={selected}
            pending={pending}
            connectMode={connectMode}
            onSelectCollisionDomain={activateDomain}
            onSelect={activate}
            onRemove={(name) => dispatch({ type: "removeNode", name })}
          />
        </aside>

        <main className="app__canvas">
          <TopologyCanvas
            topology={topology}
            selected={selected}
            pending={pending}
            onSelect={activate}
            onSelectCollisionDomain={activateDomain}
            onMove={(name, position) => dispatch({ type: "moveNode", name, position })}
          />
        </main>

        <aside className="panel panel--right" aria-label="Device details">
          <Inspector topology={topology} selected={selected} onDispatch={dispatch} />
          <AlignmentToolbar selectionCount={selected.length} onAlign={align} />
        </aside>
      </div>

      {error && (
        <div className="app__error">
          {error}
          <button type="button" onClick={clearError}>
            Dismiss
          </button>
        </div>
      )}

      <LiveRegion message={notice ?? status ?? lastAnnouncement} error={error} />
    </div>
  );
}
