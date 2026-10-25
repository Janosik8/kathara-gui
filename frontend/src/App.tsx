import { type PointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { LiveRegion } from "./a11y/LiveRegion";
import { TopologyTree } from "./a11y/TopologyTree";
import {
  type AddressingIssue,
  ApiError,
  type CaptureResponse,
  type OpenResponse,
  type DiagnosticsResponse,
  type Conflicts,
  type EnvironmentCheck,
  type EverythingResponse,
  type ScenarioSummary,
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
import { LabTitle } from "./panels/LabTitle";
import { PanelResizer } from "./panels/PanelResizer";
import { type ScenarioDialog, ScenarioDrawer } from "./panels/ScenarioDrawer";
import { ScenarioPanel } from "./panels/ScenarioPanel";
import { Palette, suggestName } from "./panels/Palette";
import { ALIGNMENT_LABELS, type AlignmentAction, computeAlignment } from "./store/alignment";
import { labNameProblem, type Operation } from "./store/operations";
import { useTopologyStore } from "./store/topology";
import {
  type DeviceKind,
  type PendingEnd,
  type Topology,
  newNode,
  suggestCollisionDomain,
} from "./types";

/**
 * Where a new device goes: the first slot of a loose grid that nothing occupies.
 *
 * It used to be slot number *device count*. After a deletion that slot is
 * usually taken — add r1–r4, delete one, add another, and it landed on top of
 * an existing device (test step 1A.2). A slot counts as taken when any device
 * sits within half a cell of it, so devices the user has dragged elsewhere
 * free their old slot, and one dragged near a slot claims it.
 */
export function placeNew(nodes: readonly { position: { x: number; y: number } }[]) {
  const COLUMNS = 4;
  const WIDTH = 180;
  const HEIGHT = 140;
  for (let slot = 0; ; slot++) {
    const x = (slot % COLUMNS) * WIDTH;
    const y = Math.floor(slot / COLUMNS) * HEIGHT;
    const taken = nodes.some(
      (n) => Math.abs(n.position.x - x) < WIDTH / 2 && Math.abs(n.position.y - y) < HEIGHT / 2,
    );
    if (!taken) return { x, y };
  }
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

/**
 * Report a failed request on screen, and assertively to a screen reader.
 *
 * Failures used to go to the notice channel, which is rendered only in the
 * visually hidden live region: a sighted user whose Save failed saw nothing at
 * all ("Not saved yet" simply stayed), as found in the Windows test run, step
 * 0.8. The store's error is the visible, dismissable banner, and the live
 * region already announces it as an alert.
 */
function fail(err: unknown): void {
  useTopologyStore.setState({ error: describeFailure(err) });
}

/**
 * A failure in words, naming the device and interface when the server points
 * at one: "r1 eth1: 'abc' is not a valid address in CIDR form".
 *
 * The server's validation message cannot name them — the model checks one
 * address at a time and does not know whose it is — but its location does,
 * and the topology that was sent is the one in the editor.
 */
export function describeFailure(err: unknown): string {
  if (!(err instanceof ApiError)) return String(err);
  const where = whereInTopology(err.location, useTopologyStore.getState().topology);
  return where ? `${where}: ${err.message}` : err.message;
}

/** "r1 eth1" for a location such as [..., "nodes", 0, "interfaces", 1, "ip"]. */
export function whereInTopology(
  location: readonly (string | number)[],
  topology: Topology,
): string | null {
  const n = location.indexOf("nodes");
  if (n < 0) return null;
  const node = topology.nodes[Number(location[n + 1])];
  if (!node) return null;
  const i = location.indexOf("interfaces", n);
  const iface = i < 0 ? undefined : node.interfaces[Number(location[i + 1])];
  return iface ? `${node.name} eth${iface.number}` : node.name;
}

/** Said whenever an edit is refused because the lab is deployed. */
const LOCKED_NOTICE = "The lab is running, so the design is read-only. Stop the lab to edit it.";
const CHECKING_NOTICE =
  "Checking whether this lab is running. The design can be edited once that is known.";

/**
 * What Check for changes found, in one sentence or two.
 *
 * It used to report address changes only, so a container removed in Docker
 * Desktop came back as "No changes found" (bug 35). The device list did
 * change, one glyph in it, but nothing said so.
 */
function describeCheck(result: StatusResponse, wasDeployed: boolean): string {
  const parts: string[] = [];
  if (wasDeployed && !result.deployed) {
    parts.push("The lab is no longer running: its containers are gone.");
  }
  const gone = result.deployed
    ? result.devices.filter((d) => d.state === "stopped").map((d) => d.name)
    : [];
  if (gone.length > 0) {
    parts.push(
      `${gone.join(", ")} ${gone.length === 1 ? "is" : "are"} no longer running: ` +
        `the container${gone.length === 1 ? " is" : "s are"} gone.`,
    );
  }
  if (result.exited.length > 0) {
    parts.push(`${result.exited.join(", ")} ${result.exited.length === 1 ? "has" : "have"} exited.`);
  }
  const changes = result.drift.length;
  if (changes > 0) {
    parts.push(`Found ${changes} change${changes === 1 ? "" : "s"} inside the containers.`);
  } else if (parts.length === 0) {
    parts.push("No changes found inside the containers.");
  }
  return parts.join(" ");
}

/** Narrower than this and the panel's own controls stop fitting. */
const PANEL_MIN = 208;
/** Wider than this and the canvas is the thing being squeezed out. */
const PANEL_MAX = 560;

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

  // Connect mode: click one device, then another, and a link appears — the
  // interaction people expect from a topology editor.
  const [connectMode, setConnectMode] = useState(false);
  const [pending, setPending] = useState<PendingEnd | null>(null);

  /**
   * The latest thing worth saying that is not an edit's own description.
   *
   * One channel, not two. There used to be a `status` beside this, announced
   * as `notice ?? status`, so once any notice had been set — every deploy and
   * stop sets one — a failed save or capture was never heard at all. A
   * standing notice likewise masked every edit's description after it; a
   * successful edit now clears it (see `edit`).
   */
  const [notice, setNotice] = useState<string | null>(null);
  const setStatus = setNotice;

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
  /** Every Kathará lab of this user, for "Stop every lab". Null until known. */
  const [everything, setEverything] = useState<EverythingResponse | null>(null);

  /**
   * Re-count every deployed lab. Called on load and after each lab action,
   * never on a timer (NFR-11). A failure leaves the last answer in place.
   */
  const refreshEverything = useCallback(() => {
    api
      .labEverything()
      .then(setEverything)
      .catch(() => undefined);
  }, []);

  // The scenario as a file. `projectFile` is null until it has been written
  // somewhere; `scenarioBusy` names the action in flight, like labBusy.
  const [folder, setFolder] = useState<string | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [capture, setCapture] = useState<CaptureResponse | null>(null);
  const [scenarioBusy, setScenarioBusy] = useState<string | null>(null);
  const [scenarioDialog, setScenarioDialog] = useState<ScenarioDialog | null>(null);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);

  // Panel widths, in pixels. Kept here rather than in CSS because the user
  // drags them; the stylesheet supplies only the starting point and the floor.
  const [panelWidths, setPanelWidths] = useState({ left: 336, right: 304 });

  const canConnect = topology.nodes.length >= 2;
  /** How far the running lab has moved on from the canvas. */
  const driftCount = labStatus?.drift.length ?? 0;

  /**
   * The design is read-only while its lab is deployed (D9).
   *
   * Two sources of truth that can both change — the canvas and the containers
   * — can drift in both directions at once, and no amount of warning makes
   * that easy to reason about. Locking the canvas leaves one direction: the
   * containers. Capture brings their state onto the canvas; stopping asks
   * whether to keep it. `deployed`, not `running`, so exited containers,
   * which still hold their names, keep the design locked too.
   */
  const running = labStatus?.deployed ?? false;
  /**
   * True from page load until the server has said whether the lab is
   * running. The design shows before that answer, which takes about a
   * second, and was editable meanwhile (test step 3A.6): an edit then would
   * have changed a running lab's design.
   */
  const [checkingLab, setCheckingLab] = useState(true);
  const locked = running || checkingLab;
  const lockNotice = running ? LOCKED_NOTICE : CHECKING_NOTICE;

  /**
   * Every edit goes through here, so no control — button, shortcut, drag or
   * tree key — can change a deployed design, including ones added later.
   */
  const edit = useCallback(
    (op: Operation): boolean => {
      if (locked) {
        setNotice(lockNotice);
        return false;
      }
      const applied = dispatch(op);
      // Let the edit's own description be heard over whatever was said last.
      if (applied) setNotice(null);
      return applied;
    },
    [dispatch, locked, lockNotice],
  );

  /**
   * A press on a control the lock has disabled. Disabled controls fire no
   * click, so without this a press did nothing and said nothing (test step
   * 3A.3); the note above the panel was easy to miss.
   */
  const refuseLocked = useCallback(
    (event: PointerEvent) => {
      if (locked && event.target instanceof Element && event.target.closest(":disabled")) {
        setNotice(lockNotice);
      }
    },
    [locked, lockNotice],
  );

  const undoEdit = useCallback(() => {
    if (locked) return setNotice(lockNotice);
    setNotice(null);
    undo();
  }, [locked, lockNotice, undo]);

  const redoEdit = useCallback(() => {
    if (locked) return setNotice(lockNotice);
    setNotice(null);
    redo();
  }, [locked, lockNotice, redo]);

  /**
   * Ask Docker whether this lab is running, with the design locked until it
   * answers. The containers outlive both the tab and the scenario being open:
   * a page reloaded while its lab runs, and a scenario reopened while its lab
   * runs (test 3E.2), must both come back locked, with Stop and Capture.
   *
   * Only the latest check counts. Another scenario can be opened while one is
   * still being asked about, and a late answer for the first must not lock
   * the second.
   */
  const statusCheck = useRef(0);
  const checkRunning = useCallback(async (subject: Topology) => {
    const ticket = ++statusCheck.current;
    if (subject.nodes.length === 0) {
      setCheckingLab(false);
      return;
    }
    setCheckingLab(true);
    try {
      const result = await api.labStatus(subject);
      if (ticket === statusCheck.current && result.deployed) setLabStatus(result);
    } catch {
      // No daemon, or no answer: treat as not deployed, as the probe will.
    } finally {
      if (ticket === statusCheck.current) setCheckingLab(false);
    }
  }, []);

  useEffect(() => {
    api
      .read()
      .then(async (state) => {
        load(state.topology);
        await checkRunning(state.topology);
      })
      .catch((err) => fail(err))
      .finally(() => setCheckingLab(false));
  }, [load, checkRunning]);

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
        edit({
          type: "link",
          a: first.name,
          b: second.name,
          collisionDomain: suggestCollisionDomain(topology),
        });
      } else {
        const device = first.kind === "device" ? first : second;
        const domain = first.kind === "domain" ? first : second;
        edit({ type: "connect", node: device.name, collisionDomain: domain.name });
      }
      // Stay in mode so several links can be drawn in a row.
      setPending(null);
    },
    [edit, topology],
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

  /**
   * Ask the containers whether anything has changed inside them.
   *
   * On request, not on a timer. With the design locked the canvas cannot
   * drift, so the only thing to find is a change made from a terminal — and
   * polling for that every few seconds would load the very host running the
   * simulation (NFR-11) to answer a question nobody has asked yet.
   *
   * This replaces a debounced re-check on every edit, which existed for the
   * canvas-side direction that the lock has removed.
   */
  const checkLab = useCallback(async () => {
    setLabBusy("check");
    try {
      const result = await api.labStatus(topology);
      setLabStatus(result);
      setNotice(describeCheck(result, labStatus?.deployed ?? false));
    } catch (err) {
      fail(err);
    } finally {
      setLabBusy(null);
      refreshEverything();
    }
  }, [topology, labStatus, refreshEverything]);

  /**
   * Stop every lab of this user — `kathara wipe` — capturing nothing.
   *
   * Requested during the first Windows run: labs outlive the application, and
   * a machine without the Kathará command-line tool had no way to clear them
   * all. The panel has already asked, and said what will stop.
   */
  const wipeLabs = useCallback(async () => {
    setLabBusy("wipe");
    try {
      const before = everything?.devices ?? 0;
      const result = await api.wipeLabs();
      setEverything(result);
      if (result.message) {
        fail(result.message);
        return;
      }
      // This lab went with the rest, so the design unlocks. Asked of Docker,
      // not assumed, like every other status.
      setLabStatus(await api.labStatus(topology));
      setDiagnostics(null);
      setConflicts(null);
      setNotice(
        `Stopped every lab: ${before} device${before === 1 ? "" : "s"}. ` +
          "The design can be edited again.",
      );
    } catch (err) {
      fail(err);
    } finally {
      setLabBusy(null);
    }
  }, [everything, topology]);

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
          if (err instanceof ApiError && err.status === 403) {
            setCanValidate(false);
            return;
          }
          // Never leave the previous answer standing. Test step 1A.12 typed
          // "abc" as an address: the server refused the whole topology (422),
          // this was ignored, and the panel went on saying "No addressing
          // problems found". The refusal *is* the addressing problem.
          const invalid = err instanceof ApiError && err.status === 422;
          const where = err instanceof ApiError ? whereInTopology(err.location, topology) : null;
          setIssues([
            {
              severity: "error",
              code: invalid ? "invalid_input" : "check_failed",
              message: invalid
                ? describeFailure(err)
                : `Could not check the addressing: ${describeFailure(err)}`,
              collision_domain: null,
              devices: where ? [where.split(" ")[0]!] : [],
            },
          ]);
          setCounts({ errors: 1, warnings: 0 });
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
        edit({ type: "replaceTopology", topology: result.topology });
        const replaced = Object.entries(result.replaced ?? {}).map(
          ([where, was]) => `${where.replace(":", " eth")} (was ${was})`,
        );
        setNotice(
          (result.changed
            ? `Assigned ${Object.keys(result.assigned_addresses).length} addresses across ` +
              `${Object.keys(result.assigned_subnets).length} collision domains.`
            : "Everything already has an address.") +
            (replaced.length > 0
              ? ` Replaced ${replaced.length === 1 ? "an address" : "addresses"} outside ` +
                `the collision domain's subnet: ${replaced.join(", ")}.`
              : ""),
        );
        if (result.skipped.length > 0) {
          setNotice(`Could not address: ${result.skipped.join(", ")}. The subnet is too small.`);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) {
          setCanAllocate(false);
          setNotice("The subnet calculator is disabled for this scenario.");
        } else {
          fail(err);
        }
      } finally {
        setAllocating(false);
      }
    },
    [edit, topology],
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

    refreshEverything();
  }, [refreshEverything]);

  const runLabAction = useCallback(
    async (
      action: "deploy" | "undeploy" | "verify",
      confirm = false,
      // A capture replaces the topology moments before "Capture, then stop"
      // stops the lab, so that caller passes the fresh one explicitly.
      subject: Topology = topology,
    ) => {
      setLabBusy(action);
      try {
        if (action === "verify") {
          setDiagnostics(await api.verify(subject));
        } else {
          const result =
            action === "deploy"
              ? await api.deploy(subject, confirm)
              : await api.undeploy(subject);

          // Deploying is saving (test 3E.2): the server wrote the scenario
          // into the folder named after it, renaming the folder if the lab
          // was renamed, before it started anything.
          if (action === "deploy" && result.lab_dir) {
            setFolder(result.lab_dir);
            markSaved();
          }

          if (result.needs_confirmation) {
            // Nothing was changed, so the last known status still holds.
            setConflicts(result.conflicts);
            setNotice(
              result.conflicts && result.conflicts.unexpected.length === 0
                ? "This lab is already running. Redeploying replaces it."
                : "Something is already running under this lab name.",
            );
            return;
          }

          setConflicts(null);
          setLabStatus(result);
          // A previous run's results describe a lab that is no longer there.
          setDiagnostics(null);
          // Connect mode is an editing mode, and the design is now locked.
          if (result.deployed) leaveConnectMode(false);
          setNotice(
            action === "deploy"
              ? result.deployed
                ? `Deployed ${result.running.length} of ${result.devices.length} devices. ` +
                  "The design is read-only until the lab is stopped."
                : `Deployed ${result.running.length} of ${result.devices.length} devices.`
              : "Lab stopped. The design can be edited again.",
          );
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) {
          setCanVerify(false);
          setNotice("Link verification is disabled for this scenario.");
        } else {
          fail(err);
        }
      } finally {
        setLabBusy(null);
        if (action !== "verify") refreshEverything();
      }
    },
    [topology, leaveConnectMode, refreshEverything, markSaved],
  );

  const addDevice = useCallback(
    (kind: DeviceKind) => {
      const name = suggestName(topology, kind);
      edit({
        type: "addNode",
        node: newNode(name, kind, placeNew(topology.nodes)),
      });
      setSelected([name]);
    },
    [edit, topology],
  );

  const removeSelected = useCallback(() => {
    // Selecting a link clears any device selection and vice versa, so at most
    // one of these branches can apply.
    if (selectedLink) {
      edit({ type: "removeLink", collisionDomain: selectedLink });
      setSelectedLink(null);
      return;
    }
    for (const name of selected) edit({ type: "removeNode", name });
    setSelected([]);
  }, [edit, selected, selectedLink]);

  const align = useCallback(
    (action: AlignmentAction) => {
      const nodes = topology.nodes.filter((n) => selected.includes(n.name));
      const positions = computeAlignment(nodes, action);
      // An alignment that changes nothing should not create an undo step.
      if (Object.keys(positions).length === 0) return;
      edit({ type: "moveNodes", positions, label: `${ALIGNMENT_LABELS[action]} applied` });
    },
    [edit, selected, topology],
  );

  /**
   * Lay the whole topology out afresh.
   *
   * Dispatched as one `moveNodes`, so a layout the user dislikes costs a
   * single undo — which is what makes trying it cheap.
   */
  const autoArrange = useCallback(async () => {
    setScenarioBusy("arrange");
    try {
      const { positions } = await api.arrange(topology);
      const moved = Object.fromEntries(
        Object.entries(positions).filter(([name, p]) => {
          const node = topology.nodes.find((n) => n.name === name);
          return node && (node.position.x !== p.x || node.position.y !== p.y);
        }),
      );
      // The layout places devices and assumes each shared segment sits between
      // its members, so a segment moved by hand goes back there too.
      const pinned = topology.collision_domains.some((cd) => cd.position);
      if (Object.keys(moved).length === 0 && !pinned) {
        setStatus("The layout is already tidy.");
        return;
      }
      edit({
        type: "moveNodes",
        positions: moved,
        label: "Tidied the layout",
        releaseDomains: true,
      });
    } catch (err) {
      fail(err);
    } finally {
      setScenarioBusy(null);
    }
  }, [topology, edit]);

  // -- the scenario as a folder -----------------------------------------

  /**
   * Save the scenario into its folder in the workspace.
   *
   * This button used to call `PUT /api/topology`, which only pushed the
   * document into the server's memory — nothing reached disk, and the work was
   * lost when the process stopped. A button saying "Save" has to write files.
   */
  const save = useCallback(
    async (name?: string) => {
      // "Save as" names the copy, not just its folder. A copy that kept the
      // original's name looked identical in the Open list, and — since
      // Kathará knows a running lab by its name — would clash with the
      // original when both were deployed (test step 1B.1).
      const newName = name?.trim();
      // Read from the store, not the render's closure: Ctrl+S pressed inside
      // a field commits that field first, and the save must include it.
      let subject = useTopologyStore.getState().topology;
      if (newName && newName !== subject.name) {
        if (locked) {
          fail(
            "Stop the lab before saving it under a new name: the name is how Kathará " +
              "knows the running lab.",
          );
          return;
        }
        if (!edit({ type: "setLabMetadata", changes: { name: newName } })) return;
        subject = useTopologyStore.getState().topology;
      }

      setScenarioBusy("save");
      try {
        const result = await api.saveProject(subject, name);
        setFolder(result.folder);
        markSaved();
        setStatus(
          result.renamed_from
            ? `Saved in ${result.name} (folder renamed from ${result.renamed_from})`
            : `Saved in ${result.name}`,
        );
      } catch (err) {
        fail(err);
      } finally {
        setScenarioBusy(null);
      }
    },
    [topology, markSaved, locked, edit],
  );

  const download = useCallback((blob: Blob, filename: string) => {
    // An object URL and a synthetic click: the only way to hand a blob to the
    // browser's own download, and it must be revoked or the whole file stays
    // in memory for the life of the tab.
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, []);

  const exportScenario = useCallback(async () => {
    setScenarioBusy("export");
    try {
      const blob = await api.exportProject(topology);
      download(blob, `${topology.name || "scenario"}.zip`);
      markSaved(); // exporting saves the folder first, so it is on disk
      setStatus("Scenario exported.");
    } catch (err) {
      fail(err);
    } finally {
      setScenarioBusy(null);
    }
  }, [topology, download, markSaved]);

  const refreshScenarios = useCallback(() => {
    api
      .scenarios()
      .then(setScenarios)
      .catch((err) => fail(err));
  }, []);

  // Known before a rename is typed, so the header can refuse a name another
  // scenario has as it is entered rather than at the next save (test 3E.2).
  useEffect(() => refreshScenarios(), [folder, refreshScenarios]);

  /** Every scenario's name but the open one's own. */
  const ownFolder = folder?.split(/[\\/]/).pop() ?? null;
  const otherScenarioNames = scenarios
    .filter((entry) => entry.folder !== ownFolder)
    .flatMap((entry) => [entry.folder, entry.name]);

  // Save as and Open, from the header. Focus goes back to the button that
  // opened the strip when it closes, so a keyboard user is not dropped at
  // the top of the page.
  const newButton = useRef<HTMLButtonElement>(null);
  const saveAsButton = useRef<HTMLButtonElement>(null);
  const openButton = useRef<HTMLButtonElement>(null);

  const closeDialog = useCallback(() => {
    const opener = { new: newButton, saveAs: saveAsButton, open: openButton };
    if (scenarioDialog) opener[scenarioDialog].current?.focus();
    setScenarioDialog(null);
  }, [scenarioDialog]);

  const toggleDialog = useCallback(
    (dialog: ScenarioDialog) => {
      if (scenarioDialog === dialog) {
        closeDialog();
        return;
      }
      // The list is only correct at the moment it is fetched, so it is
      // refreshed when the chooser opens rather than left to go stale.
      if (dialog === "open") refreshScenarios();
      setScenarioDialog(dialog);
    },
    [scenarioDialog, closeDialog, refreshScenarios],
  );

  /** Adopt an opened scenario: its topology, its folder, and its exam toggles. */
  const adopt = useCallback(
    (result: OpenResponse) => {
      load(result.topology);
      setFolder(result.folder);
      setImportWarnings(result.warnings);
      setCapture(null);
      setLabStatus(null);
      setDiagnostics(null);
      setSelected([]);
      setSelectedLink(null);
      // Feature toggles belong to the scenario, so opening one adopts its
      // restrictions rather than keeping the previous scenario's.
      setCanAllocate(result.features.subnet_calculator);
      setCanValidate(result.features.addressing_validation);
      setCanVerify(result.features.infrastructure_verification);
      setStatus(
        result.foreign
          ? `Opened ${result.topology.name}, imported from outside this application.`
          : `Opened ${result.topology.name}.`,
      );
      void checkRunning(result.topology);
    },
    [load, checkRunning],
  );

  const openScenario = useCallback(
    async (name: string) => {
      setScenarioBusy("open");
      try {
        adopt(await api.openProject(name));
      } catch (err) {
        fail(err);
      } finally {
        setScenarioBusy(null);
      }
    },
    [adopt],
  );

  /**
   * An empty scenario with no folder, so the next Save asks for nothing and
   * cannot overwrite the scenario that was open (bug 27). The server resets
   * too: Save writes to the folder the session has open (F25).
   */
  const newScenario = useCallback(async () => {
    setScenarioBusy("new");
    try {
      const state = await api.reset();
      // An empty scenario never runs, and a check still pending was for the last one.
      statusCheck.current++;
      setCheckingLab(false);
      load(state.topology);
      setFolder(null);
      setImportWarnings([]);
      setCapture(null);
      setLabStatus(null);
      setDiagnostics(null);
      setSelected([]);
      setSelectedLink(null);
      // A new scenario starts without an exam's restrictions.
      setCanAllocate(true);
      setCanValidate(true);
      setCanVerify(true);
      setStatus("Started a new scenario.");
    } catch (err) {
      fail(err);
    } finally {
      setScenarioBusy(null);
    }
  }, [load]);

  const importScenario = useCallback(
    async (file: File) => {
      setScenarioBusy("import");
      try {
        adopt(await api.importProject(file));
      } catch (err) {
        fail(err);
      } finally {
        setScenarioBusy(null);
      }
    },
    [adopt],
  );

  /** Returns the captured topology, or null when the capture failed. */
  const captureState = useCallback(async (): Promise<Topology | null> => {
    setScenarioBusy("capture");
    try {
      const report = await api.captureState(topology);
      setCapture(report);
      // The capture reads live interface addresses back into the model, so a
      // PC configured by hand shows its real address on the canvas. `load`
      // rather than an edit: this is adopting the containers' state, which is
      // exactly what the lock permits, and it is not the user's to undo.
      load(report.topology);
      setFolder(report.folder);
      // The server now measures the lab against what was just captured, so
      // any differences previously listed have been adopted, not ignored.
      setLabStatus((current) => (current ? { ...current, drift: [] } : current));
      setStatus(
        report.captured.length > 0
          ? `Captured configuration from ${report.captured.length} device(s).`
          : (report.message ?? "Nothing was captured."),
      );
      return report.topology;
    } catch (err) {
      fail(err);
      return null;
    } finally {
      setScenarioBusy(null);
    }
  }, [topology, load]);

  /** Keep what the containers hold, then stop. A failed capture stops nothing. */
  const captureAndStop = useCallback(async () => {
    const captured = await captureState();
    if (captured === null) return;
    await runLabAction("undeploy", false, captured);
  }, [captureState, runLabAction]);

  /**
   * Keep what the containers hold, then redeploy over them (test 3E.1). The
   * capture writes each router's frr.conf into the folder the redeploy reads,
   * so the configuration typed inside the containers comes back up with it.
   */
  const captureAndRedeploy = useCallback(async () => {
    setConflicts(null);
    const captured = await captureState();
    if (captured === null) return;
    await runLabAction("deploy", true, captured);
  }, [captureState, runLabAction]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = isTextEntry(event.target);

      // Ctrl+S saves, as in every editor (bug 22), and works from inside a
      // field too, where the browser would otherwise offer to save the page.
      // Blurring first commits a half-typed address, so it is saved as well.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (event.repeat || scenarioBusy !== null) return;
        if (useTopologyStore.getState().topology.nodes.length === 0) {
          setStatus("Nothing to save yet: add a device first.");
          return;
        }
        if (typing && event.target instanceof HTMLElement) event.target.blur();
        void save();
        return;
      }

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
        if (event.shiftKey) redoEdit();
        else undoEdit();
        return;
      }
      if (meta && event.key.toLowerCase() === "a") {
        // Without this the browser selects the page's text instead, which in
        // an editor is never what Ctrl+A is meant to do.
        event.preventDefault();
        setSelectedLink(null);
        setSelected(topology.nodes.map((n) => n.name));
        return;
      }
      if (!meta && event.key.toLowerCase() === "c" && canConnect) {
        event.preventDefault();
        if (locked) setNotice(lockNotice);
        else toggleConnectMode();
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
    undoEdit,
    redoEdit,
    locked,
    lockNotice,
    topology,
    removeSelected,
    selected,
    selectedLink,
    connectMode,
    leaveConnectMode,
    toggleConnectMode,
    canConnect,
    save,
    scenarioBusy,
  ]);

  return (
    <div className="app" data-connect-mode={connectMode || undefined}>
      <a className="skip-link" href="#topology">
        Skip to topology
      </a>

      {/* The drift warning lives here as well as in the Laboratory panel: it
          was being missed in the panel, and it changes what every other
          control in the application means. */}
      <header
        className="app__header"
        data-drift={driftCount > 0 ? "true" : undefined}
        data-locked={running ? "true" : undefined}
      >
        <h1 className="app__title">
          Kathara GUI
          <LabTitle
            name={topology.name}
            deployed={labStatus?.deployed ?? false}
            onRename={(name) => edit({ type: "setLabMetadata", changes: { name } })}
            validate={(name) => labNameProblem(name, otherScenarioNames)}
            onAnnounce={setStatus}
          />
          {checkingLab && !running && (
            <span className="app__checking">Checking whether the lab is running…</span>
          )}
          {running && driftCount === 0 && (
            // Said in words beside the name, because every editing control
            // on the page is about to refuse, and that needs a reason.
            <span className="app__locked">Lab running — design is read-only</span>
          )}
          {driftCount > 0 && (
            <span className="app__drift">
              {/* Words, not only a colour, and specific about the count so it
                  is clear this is a real difference and not a generic nag. */}
              Running lab differs from the canvas in {driftCount} place
              {driftCount === 1 ? "" : "s"}: capture to keep, or stop to discard
            </span>
          )}
          {dirty && (
            <span className="app__dirty" title="Unsaved changes">
              {/* Text, not just a dot: a colour or shape alone is not a status. */}
              Unsaved changes
            </span>
          )}
        </h1>

        <div className="app__actions" role="group" aria-label="Topology actions">
          <button type="button" onClick={undoEdit} disabled={locked || !canUndo()}>
            Undo
          </button>
          <button type="button" onClick={redoEdit} disabled={locked || !canRedo()}>
            Redo
          </button>
          <button
            type="button"
            onClick={removeSelected}
            disabled={locked || (selected.length === 0 && !selectedLink)}
          >
            {selectedLink ? "Delete link" : "Delete"}
          </button>
          <button
            type="button"
            ref={newButton}
            aria-expanded={scenarioDialog === "new"}
            onClick={() => toggleDialog("new")}
            // Allowed while a lab runs, like Open: the lab keeps running.
            disabled={scenarioBusy !== null}
          >
            New…
          </button>
          <button
            type="button"
            onClick={() => save()}
            disabled={scenarioBusy !== null || topology.nodes.length === 0}
          >
            {scenarioBusy === "save" ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            ref={saveAsButton}
            aria-expanded={scenarioDialog === "saveAs"}
            onClick={() => toggleDialog("saveAs")}
            disabled={scenarioBusy !== null || topology.nodes.length === 0}
          >
            Save as…
          </button>
          <button
            type="button"
            ref={openButton}
            aria-expanded={scenarioDialog === "open"}
            onClick={() => toggleDialog("open")}
            // Allowed while a lab runs (test 3E.2). The lab keeps running,
            // and reopening its scenario finds it and locks it again (F33).
            disabled={scenarioBusy !== null}
          >
            Open…
          </button>
        </div>
      </header>

      {scenarioDialog && (
        <ScenarioDrawer
          dialog={scenarioDialog}
          dirty={dirty}
          busy={scenarioBusy}
          scenarios={scenarios}
          runningLab={running ? topology.name : null}
          onSaveAs={(name) => void save(name)}
          validateName={(name) => labNameProblem(name, otherScenarioNames)}
          onOpen={openScenario}
          onNew={() => void newScenario()}
          onClose={closeDialog}
        />
      )}

      <div className="app__body">
        <aside
          className="panel"
          aria-label="Devices"
          style={{ width: `${panelWidths.left}px` }}
        >
          <PanelResizer
            width={panelWidths.left}
            min={PANEL_MIN}
            max={PANEL_MAX}
            side="left"
            label="Width of the devices panel"
            onResize={(left) => setPanelWidths((w) => ({ ...w, left }))}
          />

          <div className="panel__scroll">

          {running && <p className="edit-lock__note">{LOCKED_NOTICE}</p>}

          {/* A disabled fieldset disables every control inside it natively,
              so each stays visible and readable — a screen reader announces
              it as unavailable rather than losing it — and none can act. */}
          <fieldset className="edit-lock" disabled={locked} onPointerDown={refuseLocked}>
            <Palette topology={topology} onAdd={addDevice} />

            <CollisionDomainsPanel topology={topology} onDispatch={edit} />

            <ConnectModeBar
              active={connectMode}
              pending={pending}
              enabled={canConnect}
              onToggle={toggleConnectMode}
            />
          </fieldset>

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
            // Left navigable while locked, since it is how a keyboard user
            // reads the design; only its editing keys are withdrawn.
            onRemove={locked ? undefined : (name) => edit({ type: "removeNode", name })}
            onDisconnect={
              locked ? undefined : (node, number) => edit({ type: "disconnect", node, number })
            }
          />
          </div>
        </aside>

        <main className="app__canvas">
          <TopologyCanvas
            topology={topology}
            selected={selected}
            pending={pending}
            onSelect={activate}
            onSelectCollisionDomain={activateDomain}
            onMove={(name, position) => edit({ type: "moveNode", name, position })}
            onMoveDomain={(name, position) => edit({ type: "moveDomain", name, position })}
            onSelectLink={(domain) => {
              // Exactly one thing is selected at a time, so Delete is never
              // ambiguous about what it will remove.
              setSelectedLink(domain);
              if (domain !== null) setSelected([]);
            }}
            selectedLink={selectedLink}
            connectMode={connectMode}
            locked={locked}
            onLockedEdit={() => setNotice(lockNotice)}
          />
        </main>

        <aside
          className="panel panel--right"
          aria-label="Device details"
          style={{ width: `${panelWidths.right}px` }}
        >
          <PanelResizer
            width={panelWidths.right}
            min={PANEL_MIN}
            max={PANEL_MAX}
            side="right"
            label="Width of the details panel"
            onResize={(right) => setPanelWidths((w) => ({ ...w, right }))}
          />

          <div className="panel__scroll">

          {running && <p className="edit-lock__note">{LOCKED_NOTICE}</p>}

          <fieldset className="edit-lock" disabled={locked} onPointerDown={refuseLocked}>
            <Inspector topology={topology} selected={selected} onDispatch={edit} />
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
            <AlignmentToolbar
              selectionCount={selected.length}
              deviceCount={topology.nodes.length}
              busy={scenarioBusy === "arrange"}
              onAlign={align}
              onAutoArrange={autoArrange}
            />
          </fieldset>
          <ScenarioPanel
            folder={folder}
            dirty={dirty}
            busy={scenarioBusy}
            deviceCount={topology.nodes.length}
            anyRunning={(labStatus?.running.length ?? 0) > 0}
            capture={capture}
            onDismissCapture={() => setCapture(null)}
            importWarnings={importWarnings}
            onExport={exportScenario}
            onImport={importScenario}
            onCapture={captureState}
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
            onCaptureAndStop={captureAndStop}
            onCheck={checkLab}
            everything={everything}
            onWipe={wipeLabs}
            onVerify={() => runLabAction("verify")}
            onDismissDiagnostics={() => setDiagnostics(null)}
            conflicts={conflicts}
            onConfirmDeploy={() => runLabAction("deploy", true)}
            onCaptureAndRedeploy={captureAndRedeploy}
            onCancelDeploy={() => {
              setConflicts(null);
              setNotice("Deployment cancelled. Nothing was changed.");
            }}
            onAnnounce={setNotice}
          />
          </div>
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

      <LiveRegion message={notice ?? lastAnnouncement} error={error} />
    </div>
  );
}
