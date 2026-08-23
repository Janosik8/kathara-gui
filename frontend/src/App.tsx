import { useCallback, useEffect, useState } from "react";
import { LiveRegion } from "./a11y/LiveRegion";
import { TopologyTree } from "./a11y/TopologyTree";
import { ApiError, api } from "./api/client";
import { TopologyCanvas } from "./canvas/TopologyCanvas";
import { Palette, suggestName } from "./panels/Palette";
import { useTopologyStore } from "./store/topology";
import { type DeviceKind, newNode } from "./types";

/** Lay new devices out on a loose grid rather than stacking them at the origin. */
function placeNew(count: number) {
  const COLUMNS = 4;
  return { x: (count % COLUMNS) * 180, y: Math.floor(count / COLUMNS) * 140 };
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

  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  // Adopt whatever the server already holds, so reloading the page does not
  // discard work.
  useEffect(() => {
    api
      .read()
      .then((state) => load(state.topology))
      .catch((err) => setStatus(err instanceof ApiError ? err.message : String(err)));
  }, [load]);

  const addDevice = useCallback(
    (kind: DeviceKind) => {
      const name = suggestName(topology, kind);
      dispatch({
        type: "addNode",
        node: newNode(name, kind, placeNew(topology.nodes.length)),
      });
      setSelected(name);
    },
    [dispatch, topology],
  );

  const save = useCallback(async () => {
    try {
      await api.save(topology);
      setStatus("Saved");
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : String(err));
    }
  }, [topology]);

  // Undo/redo need to work from anywhere, not only a focused control.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

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
            onSelect={setSelected}
            onRemove={(name) => {
              dispatch({ type: "removeNode", name });
              if (selected === name) setSelected(null);
            }}
          />
        </aside>

        <main className="app__canvas">
          <TopologyCanvas
            topology={topology}
            selected={selected}
            onSelect={setSelected}
            onMove={(name, position) => dispatch({ type: "moveNode", name, position })}
          />
        </main>
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
