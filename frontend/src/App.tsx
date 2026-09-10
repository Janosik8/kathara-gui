import { useCallback, useEffect, useState } from "react";
import { LiveRegion } from "./a11y/LiveRegion";
import { TopologyTree } from "./a11y/TopologyTree";
import {
  type AddressingIssue,
  ApiError,
  type CaptureResponse,
  type DiagnosticsResponse,
  type Conflicts,
  type EnvironmentCheck,
  type Features,
  type PackageSummary,
  type StatusResponse,
  api,
} from "./api/client";
import { TopologyCanvas } from "./canvas/TopologyCanvas";
import { AddressingPanel } from "./panels/AddressingPanel";
import { CollisionDomainsPanel } from "./panels/CollisionDomainsPanel";
import { AlignmentToolbar } from "./panels/AlignmentToolbar";
import { ConnectModeBar } from "./panels/ConnectModeBar";
import { Inspector } from "./panels/Inspector";
import { LabPanel } from "./panels/LabPanel";
import { ScenarioPanel } from "./panels/ScenarioPanel";
import { Palette, suggestName } from "./panels/Palette";
import { ALIGNMENT_LABELS, type AlignmentAction, computeAlignment } from "./store/alignment";
import { useTopologyStore } from "./store/topology";
import {
  type DeviceKind,
  type PendingEnd,
  type Topology,
  newNode,
  suggestCollisionDomain,
} from "./types";

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
    markSaved,
  } = useTopologyStore();

  const [selected, setSelected] = useState<string[]>([]);
  const [selectedLink, setSelectedLink] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  // Connect mode: click one device, then another, and a link appears — the
  // interaction people expect from a topology editor.
  const [connectMode, setConnectMode] = useState(false);
  const [pending, setPending] = useState<PendingEnd | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Addressing. Feature flags start permissive and are switched off when the
  // server refuses, so a withdrawn feature disappears rather than erroring
  // repeatedly.
  const [issues, setIssues] = useState<AddressingIssue[]>([]);
  const [counts, setCounts] = useState({ errors: 0, warnings: 0 });
  const [canAllocate, setCanAllocate] = useState(true);
  const [canValidate, setCanValidate] = useState(true);
  const [checking, setChecking] = useState(false);
  const [allocating, setAllocating] = useState(false);

  // Lab state. `labBusy` names the action in flight so buttons can say what
  // they are doing rather than just greying out.
  const [labStatus, setLabStatus] = useState<StatusResponse | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsResponse | null>(null);
  const [environment, setEnvironment] = useState<EnvironmentCheck[]>([]);
  const [canDeploy, setCanDeploy] = useState(false);
  const [canVerify, setCanVerify] = useState(true);
  const [labBusy, setLabBusy] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Conflicts | null>(null);

  // The scenario as a file. `projectFile` is null until it has been written
  // somewhere; `scenarioBusy` names the action in flight, like labBusy.
  const [projectFile, setProjectFile] = useState<string | null>(null);
  const [packages, setPackages] = useState<PackageSummary[]>([]);
  const [capture, setCapture] = useState<CaptureResponse | null>(null);
  const [scenarioBusy, setScenarioBusy] = useState<string | null>(null);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);

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
    setSelectedLink((current) =>
      current &&
      !topology.nodes.some((n) => n.interfaces.some((i) => i.collision_domain === current))
        ? null
        : current,
    );
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
    setSelectedLink(null);
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

  // Validate as the design changes, debounced so a drag does not produce a
  // request per frame. The rules live on the server, so the editor and the
  // exported lab can never disagree about what is wrong.
  useEffect(() => {
    if (!canValidate) return;
    if (topology.nodes.length === 0) {
      setIssues([]);
      setCounts({ errors: 0, warnings: 0 });
      return;
    }

    let cancelled = false;
    setChecking(true);
    const timer = window.setTimeout(() => {
      api
        .checkAddressing(topology)
        .then((result) => {
          if (cancelled) return;
          setIssues(result.issues);
          setCounts({ errors: result.errors, warnings: result.warnings });
        })
        .catch((err) => {
          if (cancelled) return;
          // 403 means the instructor withdrew it for this scenario.
          if (err instanceof ApiError && err.status === 403) setCanValidate(false);
        })
        .finally(() => {
          if (!cancelled) setChecking(false);
        });
    }, 400);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [topology, canValidate]);

  const allocateAddressing = useCallback(
    async (overwrite: boolean, pool: string, prefix: number) => {
      setAllocating(true);
      try {
        // Send the document we hold: the saved session may be far behind.
        const result = await api.allocateAddressing({ topology, overwrite, pool, prefix });
        // One operation, so the whole allocation undoes in one step.
        dispatch({ type: "replaceTopology", topology: result.topology });
        setNotice(
          result.changed
            ? `Assigned ${Object.keys(result.assigned_addresses).length} addresses across ` +
              `${Object.keys(result.assigned_subnets).length} collision domains.`
            : "Everything already has an address.",
        );
        if (result.skipped.length > 0) {
          setNotice(`Could not address: ${result.skipped.join(", ")}. The subnet is too small.`);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) {
          setCanAllocate(false);
          setNotice("The subnet calculator is disabled for this scenario.");
        } else {
          setNotice(err instanceof ApiError ? err.message : String(err));
        }
      } finally {
        setAllocating(false);
      }
    },
    [dispatch, topology],
  );

  // Check the environment once at startup, and learn which features the
  // scenario permits, so nothing is offered that cannot work.
  useEffect(() => {
    api
      .probe()
      .then((report) => {
        setEnvironment(report.checks);
        setCanDeploy(report.can_deploy);
      })
      .catch(() => setCanDeploy(false));

    api
      .features()
      .then((f) => setCanVerify(f.infrastructure_verification))
      .catch(() => undefined);
  }, []);

  const runLabAction = useCallback(
    async (action: "deploy" | "undeploy" | "verify", confirm = false) => {
      setLabBusy(action);
      try {
        if (action === "verify") {
          setDiagnostics(await api.verify(topology));
        } else {
          const result =
            action === "deploy"
              ? await api.deploy(topology, confirm)
              : await api.undeploy(topology);

          if (result.needs_confirmation) {
            // Nothing was changed, so the last known status still holds.
            setConflicts(result.conflicts);
            setNotice("Something is already running under this lab name.");
            return;
          }

          setConflicts(null);
          setLabStatus(result);
          // A previous run's results describe a lab that is no longer there.
          setDiagnostics(null);
          setNotice(
            action === "deploy"
              ? `Deployed ${result.running.length} of ${result.devices.length} devices.`
              : "Lab stopped.",
          );
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) {
          setCanVerify(false);
          setNotice("Link verification is disabled for this scenario.");
        } else {
          setNotice(err instanceof ApiError ? err.message : String(err));
        }
      } finally {
        setLabBusy(null);
      }
    },
    [topology],
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
    // Selecting a link clears any device selection and vice versa, so at most
    // one of these branches can apply.
    if (selectedLink) {
      dispatch({ type: "removeLink", collisionDomain: selectedLink });
      setSelectedLink(null);
      return;
    }
    for (const name of selected) dispatch({ type: "removeNode", name });
    setSelected([]);
  }, [dispatch, selected, selectedLink]);

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

  // -- the scenario as a file -------------------------------------------

  /**
   * Save the scenario into the workspace as a `.kgui` package.
   *
   * This button used to call `PUT /api/topology`, which only pushed the
   * document into the server's memory — nothing reached disk, and the work was
   * lost when the process stopped. A button saying "Save" has to write a file.
   */
  const save = useCallback(
    async (filename?: string) => {
      setScenarioBusy("save");
      try {
        const result = await api.saveProject(topology, filename);
        setProjectFile(result.path);
        markSaved();
        setStatus(`Saved as ${result.filename}`);
      } catch (err) {
        setStatus(err instanceof ApiError ? err.message : String(err));
      } finally {
        setScenarioBusy(null);
      }
    },
    [topology, markSaved],
  );

  const download = useCallback(async () => {
    setScenarioBusy("download");
    try {
      const blob = await api.downloadProject(topology);
      // An object URL and a synthetic click: the only way to hand a blob to
      // the browser's own download, and it must be revoked or the whole
      // package stays in memory for the life of the tab.
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${topology.name || "scenario"}.kgui`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setStatus("Scenario downloaded.");
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : String(err));
    } finally {
      setScenarioBusy(null);
    }
  }, [topology]);

  const refreshPackages = useCallback(() => {
    api
      .packages()
      .then(setPackages)
      .catch((err) => setStatus(err instanceof ApiError ? err.message : String(err)));
  }, []);

  /** Adopt an opened package: its topology, its file, and its exam toggles. */
  const adopt = useCallback(
    (result: { topology: Topology; project_file: string; features: Features }) => {
      load(result.topology);
      setProjectFile(result.project_file);
      setCapture(null);
      setImportWarnings([]);
      setLabStatus(null);
      setDiagnostics(null);
      setSelected([]);
      setSelectedLink(null);
      // Feature toggles belong to the scenario, so opening one adopts its
      // restrictions rather than keeping the previous scenario's.
      setCanAllocate(result.features.subnet_calculator);
      setCanValidate(result.features.addressing_validation);
      setCanVerify(result.features.infrastructure_verification);
      setStatus(`Opened ${result.topology.name}.`);
    },
    [load],
  );

  const openPackage = useCallback(
    async (filename: string) => {
      setScenarioBusy("open");
      try {
        adopt(await api.openProject(filename));
      } catch (err) {
        setStatus(err instanceof ApiError ? err.message : String(err));
      } finally {
        setScenarioBusy(null);
      }
    },
    [adopt],
  );

  const uploadPackage = useCallback(
    async (file: File) => {
      setScenarioBusy("open");
      try {
        adopt(await api.uploadProject(file));
      } catch (err) {
        setStatus(err instanceof ApiError ? err.message : String(err));
      } finally {
        setScenarioBusy(null);
      }
    },
    [adopt],
  );

  const importLabConf = useCallback(
    async (text: string, filename: string) => {
      setScenarioBusy("import");
      try {
        const result = await api.importLabConf(text);
        load(result.topology);
        setImportWarnings(result.warnings);
        setProjectFile(null); // an imported lab.conf is not a saved scenario
        setSelected([]);
        setSelectedLink(null);
        setStatus(`Imported ${filename}.`);
      } catch (err) {
        setStatus(err instanceof ApiError ? err.message : String(err));
      } finally {
        setScenarioBusy(null);
      }
    },
    [load],
  );

  const exportLabConf = useCallback(async () => {
    setScenarioBusy("export");
    try {
      // The export endpoint serialises the *stored* topology, and the browser
      // holds the newer one, so the canvas is pushed first.
      await api.save(topology);
      const { text } = await api.exportLabConf();
      const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "lab.conf";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setStatus("lab.conf downloaded.");
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : String(err));
    } finally {
      setScenarioBusy(null);
    }
  }, [topology]);

  const captureState = useCallback(async () => {
    setScenarioBusy("capture");
    try {
      const report = await api.captureState(topology);
      setCapture(report);
      setStatus(
        report.captured.length > 0
          ? `Captured configuration from ${report.captured.length} device(s).`
          : (report.message ?? "Nothing was captured."),
      );
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : String(err));
    } finally {
      setScenarioBusy(null);
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
        // A selected link counts too; requiring a selected *device* meant
        // Delete silently did nothing when only a link was chosen.
        (selected.length > 0 || selectedLink !== null) &&
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
    selectedLink,
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
          <button
            type="button"
            onClick={removeSelected}
            disabled={selected.length === 0 && !selectedLink}
          >
            {selectedLink ? "Delete link" : "Delete"}
          </button>
          <button
            type="button"
            onClick={() => save()}
            disabled={scenarioBusy !== null || topology.nodes.length === 0}
          >
            {scenarioBusy === "save" ? "Saving…" : "Save"}
          </button>
        </div>
      </header>

      <div className="app__body">
        <aside className="panel" aria-label="Devices">
          <Palette topology={topology} onAdd={addDevice} />

          <CollisionDomainsPanel topology={topology} onDispatch={dispatch} />

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
            onDisconnect={(node, number) => dispatch({ type: "disconnect", node, number })}
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
            onSelectLink={(domain) => {
              // Exactly one thing is selected at a time, so Delete is never
              // ambiguous about what it will remove.
              setSelectedLink(domain);
              if (domain !== null) setSelected([]);
            }}
            selectedLink={selectedLink}
            connectMode={connectMode}
          />
        </main>

        <aside className="panel panel--right" aria-label="Device details">
          <Inspector topology={topology} selected={selected} onDispatch={dispatch} />
          <AddressingPanel
            issues={issues}
            errors={counts.errors}
            warnings={counts.warnings}
            busy={allocating}
            checking={checking}
            canAllocate={canAllocate}
            canValidate={canValidate}
            onAllocate={allocateAddressing}
          />
          <AlignmentToolbar selectionCount={selected.length} onAlign={align} />
          <ScenarioPanel
            projectFile={projectFile}
            dirty={dirty}
            busy={scenarioBusy}
            deviceCount={topology.nodes.length}
            anyRunning={(labStatus?.running.length ?? 0) > 0}
            packages={packages}
            capture={capture}
            onSave={() => save()}
            onSaveAs={(name) => save(name)}
            onDownload={download}
            onOpen={openPackage}
            onUpload={uploadPackage}
            onCapture={captureState}
            onRefreshPackages={refreshPackages}
            onImportLabConf={importLabConf}
            onExportLabConf={exportLabConf}
            importWarnings={importWarnings}
            name={topology.name}
            onRename={(name) => dispatch({ type: "setLabMetadata", changes: { name } })}
          />

          <LabPanel
            status={labStatus}
            diagnostics={diagnostics}
            environment={environment}
            canDeploy={canDeploy}
            canVerify={canVerify}
            busy={labBusy}
            deviceCount={topology.nodes.length}
            onDeploy={() => runLabAction("deploy")}
            onUndeploy={() => runLabAction("undeploy")}
            onVerify={() => runLabAction("verify")}
            conflicts={conflicts}
            onConfirmDeploy={() => runLabAction("deploy", true)}
            onCancelDeploy={() => {
              setConflicts(null);
              setNotice("Deployment cancelled. Nothing was changed.");
            }}
            onAnnounce={setNotice}
          />
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
