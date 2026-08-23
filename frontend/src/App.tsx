import { useCallback, useEffect, useState } from "react";
import { LiveRegion } from "./a11y/LiveRegion";
import { TopologyTree } from "./a11y/TopologyTree";
import { ApiError, api } from "./api/client";
import { TopologyCanvas } from "./canvas/TopologyCanvas";
import { AlignmentToolbar } from "./panels/AlignmentToolbar";
import { ConnectForm, suggestCollisionDomain } from "./panels/ConnectForm";
import { Inspector } from "./panels/Inspector";
import { Palette, suggestName } from "./panels/Palette";
import { type AlignmentAction, ALIGNMENT_LABELS, computeAlignment } from "./store/alignment";
import { useTopologyStore } from "./store/topology";
import { type DeviceKind, newNode } from "./types";

/** Lay new devices out on a loose grid rather than stacking them at the origin. */
function placeNew(count: number) {
  const COLUMNS = 4;
  return { x: (count % COLUMNS) * 180, y: Math.floor(count / COLUMNS) * 140 };
}

/** True when the keystroke belongs to whatever the user is typing into. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) ||
    // The tree handles Delete itself, per the ARIA pattern.
    target.getAttribute("role") === "treeitem"
  );
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

  // Adopt whatever the server already holds, so reloading the page does not
  // discard work.
  useEffect(() => {
    api
      .read()
      .then((state) => load(state.topology))
      .catch((err) => setStatus(err instanceof ApiError ? err.message : String(err)));
  }, [load]);

  // Drop devices that an edit or an undo removed, so an alignment can never
  // act on something that is no longer there.
  useEffect(() => {
    setSelected((current) => {
      const present = current.filter((name) => topology.nodes.some((n) => n.name === name));
      return present.length === current.length ? current : present;
    });
  }, [topology]);

  const select = useCallback((name: string | null, additive: boolean) => {
    setSelected((current) => {
      if (name === null) return [];
      if (!additive) return [name];
      return current.includes(name)
        ? current.filter((n) => n !== name)
        : [...current, name];
    });
  }, []);

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
      if (isTextEntry(event.target)) return;

      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selected.length > 0) {
        event.preventDefault();
        removeSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, removeSelected, selected]);

  return (
    <div className="app">
      {/* Lets a keyboard user reach the editor without traversing the toolbar. */}
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

          <h2 className="panel__heading" id="topology">
            Topology
          </h2>
          <TopologyTree
            topology={topology}
            selected={selected}
            onSelect={select}
            onRemove={(name) => dispatch({ type: "removeNode", name })}
          />

          <ConnectForm topology={topology} onConnect={dispatch} />
        </aside>

        <main className="app__canvas">
          <TopologyCanvas
            topology={topology}
            selected={selected}
            onSelect={select}
            onMove={(name, position) => dispatch({ type: "moveNode", name, position })}
            onLink={(a, b) =>
              dispatch({ type: "link", a, b, collisionDomain: suggestCollisionDomain(topology) })
            }
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

      <LiveRegion message={status ?? lastAnnouncement} error={error} />
    </div>
  );
}
