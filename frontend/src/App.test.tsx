/**
 * Whole-application behaviour, driven the way a keyboard user would.
 *
 * The canvas is stubbed: it is `aria-hidden` by design, needs real layout
 * measurements that jsdom does not provide, and everything it can do is also
 * reachable through the panels — which is precisely the property worth
 * testing.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axeCore from "axe-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { api } from "./api/client";
// Type-only, so it is erased at runtime and does not clash with vi.mock.
import type {
  AllocateResponse,
  DiagnosticsResponse,
  FeaturesResponse,
  IssuesResponse,
  OpenResponse,
  ScenarioSummary,
  ProbeResponse,
  SaveResponse,
  CaptureResponse,
  StatusResponse,
} from "./api/client";
import type { Topology } from "./types";
import { useTopologyStore } from "./store/topology";
import { emptyTopology } from "./types";

vi.mock("./canvas/TopologyCanvas", () => ({
  TopologyCanvas: () => <div data-testid="canvas" aria-hidden="true" />,
}));

// vi.mock is hoisted above the file, so anything it closes over must be
// created by vi.hoisted rather than declared as an ordinary const.
const {
  MockApiError,
  checkAddressing,
  allocateAddressing,
  probe,
  features,
  deploy,
  undeploy,
  verify,
  saveProject,
  openProject,
  importProject,
  exportProject,
  scenarios,
  captureState,
  arrange,
  labEverything,
  wipeLabs,
} = vi.hoisted(() => {
  class MockApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  const blank = () => ({ name: "untitled", nodes: [], collision_domains: [] });
  const idleStatus = (): StatusResponse => ({
    devices: [],
    running: [],
    exited: [],
    drift: [],
    deployed: false,
    lab_dir: null,
    message: null,
    needs_confirmation: false,
    conflicts: null,
  });
  return {
    MockApiError,
    probe: vi.fn(async (): Promise<ProbeResponse> => ({ checks: [], can_deploy: true })),
    features: vi.fn(
      async (): Promise<FeaturesResponse> => ({
        subnet_calculator: true,
        addressing_validation: true,
        infrastructure_verification: true,
      }),
    ),
    deploy: vi.fn(async (_topology: Topology): Promise<StatusResponse> => idleStatus()),
    undeploy: vi.fn(async (_topology: Topology): Promise<StatusResponse> => idleStatus()),
    verify: vi.fn(
      async (_topology: Topology): Promise<DiagnosticsResponse> => ({
        checks: [],
        passed: 0,
        failed: 0,
        skipped: 0,
        healthy: false,
        message: null,
      }),
    ),
    checkAddressing: vi.fn(
      // The parameter is declared so tests can inspect what the editor sent.
      async (_topology: Topology): Promise<IssuesResponse> => ({
        issues: [],
        errors: 0,
        warnings: 0,
      }),
    ),
    allocateAddressing: vi.fn(
      async (options: { topology?: unknown }): Promise<AllocateResponse> => ({
        // Echo back what was sent, as the real endpoint does. Returning a
        // fixed topology here is what let the canvas-wiping bug through.
        topology: (options?.topology ?? blank()) as AllocateResponse["topology"],
        assigned_subnets: {},
        assigned_addresses: {},
        skipped: [],
        changed: true,
      }),
    ),
    saveProject: vi.fn(
      async (_topology: Topology, name?: string): Promise<SaveResponse> => ({
        folder: `/workspace/${name ?? "untitled"}`,
        name: name ?? "untitled",
      }),
    ),
    openProject: vi.fn(async (name: string): Promise<OpenResponse> => ({
      topology: {
        name: "opened scenario",
        nodes: [],
        collision_domains: [],
      } as unknown as Topology,
      features: {
        subnet_calculator: true,
        addressing_validation: true,
        infrastructure_verification: true,
      },
      folder: `/workspace/${name}`,
      warnings: [],
      foreign: false,
    })),
    importProject: vi.fn(async (file: File): Promise<OpenResponse> => ({
      topology: {
        name: "imported scenario",
        nodes: [],
        collision_domains: [],
      } as unknown as Topology,
      features: {
        subnet_calculator: true,
        addressing_validation: true,
        infrastructure_verification: true,
      },
      folder: `/workspace/${file.name}`,
      warnings: [],
      foreign: true,
    })),
    exportProject: vi.fn(async () => new Blob(["PK"], { type: "application/zip" })),
    scenarios: vi.fn(async (): Promise<ScenarioSummary[]> => []),
    labEverything: vi.fn(async () => ({ devices: 0, labs: 0, message: null as string | null })),
    wipeLabs: vi.fn(async () => ({ devices: 0, labs: 0, message: null as string | null })),
    arrange: vi.fn(async (topology: Topology) => ({
      positions: Object.fromEntries(
        topology.nodes.map((n, i) => [n.name, { x: i * 260, y: 0 }]),
      ),
    })),
    captureState: vi.fn(
      async (topology: Topology): Promise<CaptureResponse> => ({
        captured: [],
        skipped: [],
        message: null,
        folder: "/workspace/untitled",
        topology,
      }),
    ),
  };
});

vi.mock("./api/client", () => ({
  ApiError: MockApiError,
  api: {
    read: vi.fn(async () => ({
      topology: { name: "untitled", nodes: [], collision_domains: [] },
      dirty: false,
      path: null,
    })),
    save: vi.fn(async () => ({
      topology: { name: "untitled", nodes: [], collision_domains: [] },
      dirty: false,
      path: null,
    })),
    checkAddressing,
    allocateAddressing,
    probe,
    features,
    deploy,
    undeploy,
    verify,
    labStatus: vi.fn(async () => ({
      devices: [],
      running: [],
      exited: [],
      drift: [],
      deployed: false,
      lab_dir: null,
      message: null,
      needs_confirmation: false,
      conflicts: null,
    })),
    saveProject,
    openProject,
    importProject,
    exportProject,
    scenarios,
    captureState,
    arrange,
    labEverything,
    wipeLabs,
  },
  initialiseToken: vi.fn(),
}));

beforeEach(() => {
  // The store is a module singleton; without this, tests leak into each other.
  useTopologyStore.getState().load(emptyTopology());
  checkAddressing.mockClear();
  checkAddressing.mockResolvedValue({ issues: [], errors: 0, warnings: 0 });
  allocateAddressing.mockClear();

  // mockClear leaves implementations in place, so a test that stubs a
  // failure would leak it into every test after it. Re-establish the
  // defaults explicitly.
  const idleStatus: StatusResponse = {
    devices: [],
    running: [],
    exited: [],
    drift: [],
    deployed: false,
    lab_dir: null,
    message: null,
    needs_confirmation: false,
    conflicts: null,
  };
  probe.mockReset().mockResolvedValue({ checks: [], can_deploy: true });
  features.mockReset().mockResolvedValue({
    subnet_calculator: true,
    addressing_validation: true,
    infrastructure_verification: true,
  });
  deploy.mockReset().mockResolvedValue(idleStatus);
  undeploy.mockReset().mockResolvedValue(idleStatus);
  labEverything.mockReset().mockResolvedValue({ devices: 0, labs: 0, message: null });
  wipeLabs.mockReset().mockResolvedValue({ devices: 0, labs: 0, message: null });
  verify.mockReset().mockResolvedValue({
    checks: [],
    passed: 0,
    failed: 0,
    skipped: 0,
    healthy: false,
    message: null,
  });
});

async function renderApp() {
  const user = userEvent.setup();
  render(<App />);
  // Wait out the initial load so later assertions are not racing it. An empty
  // topology renders no tree at all, so key off the palette instead.
  await screen.findByRole("button", { name: /Add router/ });
  return user;
}

const addRouter = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: /Add router/ }));

const row = (name: string) => screen.getByRole("treeitem", { name: new RegExp(`^${name}`) });

/** Draw a link the way a user does: connect mode, then two clicks. */
async function link(user: ReturnType<typeof userEvent.setup>, a: string, b: string) {
  await user.click(screen.getByRole("button", { name: /Connect mode/ }));
  await user.click(row(a));
  await user.click(row(b));
  await user.keyboard("{Escape}");
}

describe("building a topology", () => {
  it("starts by telling the user what to do", async () => {
    render(<App />);
    expect(await screen.findByText(/No devices yet/)).toBeInTheDocument();
  });

  it("adds a device and shows it in the tree", async () => {
    const user = await renderApp();
    await addRouter(user);
    expect(screen.getByRole("treeitem", { name: /r1, router/ })).toBeInTheDocument();
  });

  it("names successive devices predictably", async () => {
    const user = await renderApp();
    await addRouter(user);
    await addRouter(user);
    expect(screen.getByRole("treeitem", { name: /^r2/ })).toBeInTheDocument();
  });

  it("connects two devices by clicking one then the other", async () => {
    const user = await renderApp();
    await addRouter(user);
    await addRouter(user);
    await link(user, "r1", "r2");

    // The tree reports the link from both ends.
    expect(screen.getByRole("treeitem", { name: /r1, router, 1 interface/ })).toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: /r2, router, 1 interface/ })).toBeInTheDocument();
  });

  it("marks the document dirty once edited", async () => {
    const user = await renderApp();
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
    await addRouter(user);
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });
});

describe("undo and redo", () => {
  it("undoes an addition", async () => {
    const user = await renderApp();
    await addRouter(user);
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByText(/No devices yet/)).toBeInTheDocument();
  });

  it("redoes it again", async () => {
    const user = await renderApp();
    await addRouter(user);
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await user.click(screen.getByRole("button", { name: "Redo" }));
    expect(screen.getByRole("treeitem", { name: /^r1/ })).toBeInTheDocument();
  });

  it("retracts a whole link in one step", async () => {
    // Linking is one user intent, so one undo must undo all of it.
    const user = await renderApp();
    await addRouter(user);
    await addRouter(user);
    await link(user, "r1", "r2");

    await user.click(screen.getByRole("button", { name: "Undo" }));

    expect(screen.getByRole("treeitem", { name: /r1, router, 0 interfaces/ })).toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: /r2, router, 0 interfaces/ })).toBeInTheDocument();
  });

  it("disables undo when there is nothing to undo", async () => {
    await renderApp();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });
});

describe("connect mode", () => {
  const toggle = () => screen.getByRole("button", { name: /Connect mode/ });

  it("is unavailable until there are two devices to join", async () => {
    const user = await renderApp();
    expect(toggle()).toBeDisabled();
    await addRouter(user);
    expect(toggle()).toBeDisabled();
    await addRouter(user);
    expect(toggle()).toBeEnabled();
  });

  it("exposes its state as a pressed button, not just a cursor change", async () => {
    const user = await renderApp();
    await addRouter(user);
    await addRouter(user);

    expect(toggle()).toHaveAttribute("aria-pressed", "false");
    await user.click(toggle());
    expect(toggle()).toHaveAttribute("aria-pressed", "true");
  });

  it("says what the next click will do", async () => {
    const user = await renderApp();
    await addRouter(user);
    await addRouter(user);
    await user.click(toggle());
    expect(screen.getByText(/Choose the first device/)).toBeInTheDocument();

    await user.click(row("r1"));
    expect(screen.getByText(/r1 selected\. Now choose another device/)).toBeInTheDocument();
  });

  it("marks the half-made link in the tree for screen readers", async () => {
    const user = await renderApp();
    await addRouter(user);
    await addRouter(user);
    await user.click(toggle());
    await user.click(row("r1"));

    // Spoken, not merely highlighted.
    expect(
      screen.getByRole("treeitem", { name: /r1.*first end of the new link/ }),
    ).toBeInTheDocument();
  });

  it("does not change the selection while connecting", async () => {
    const user = await renderApp();
    await addRouter(user);
    await addRouter(user);
    await user.click(toggle());
    await user.click(row("r1"));

    expect(row("r1")).toHaveAttribute("aria-selected", "false");
  });

  it("stays in mode so several links can be drawn in a row", async () => {
    const user = await renderApp();
    await addRouter(user);
    await addRouter(user);
    await addRouter(user);

    await user.click(toggle());
    await user.click(row("r1"));
    await user.click(row("r2"));
    // Still on, and ready for the next pair.
    expect(toggle()).toHaveAttribute("aria-pressed", "true");

    await user.click(row("r2"));
    await user.click(row("r3"));
    expect(screen.getByRole("treeitem", { name: /r2, router, 2 interfaces/ })).toBeInTheDocument();
  });

  it("cancels the pending device when it is clicked again", async () => {
    const user = await renderApp();
    await addRouter(user);
    await addRouter(user);
    await user.click(toggle());
    await user.click(row("r1"));
    await user.click(row("r1"));

    expect(await screen.findByText(/r1 deselected/)).toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: /r1, router, 0 interfaces/ })).toBeInTheDocument();
  });

  it("leaves the mode on Escape without stranding a half-made link", async () => {
    const user = await renderApp();
    await addRouter(user);
    await addRouter(user);
    await user.click(toggle());
    await user.click(row("r1"));
    await user.keyboard("{Escape}");

    expect(toggle()).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("treeitem", { name: /r1, router, 0 interfaces/ })).toBeInTheDocument();
  });

  it("toggles with the C key", async () => {
    const user = await renderApp();
    await addRouter(user);
    await addRouter(user);

    await user.keyboard("c");
    expect(toggle()).toHaveAttribute("aria-pressed", "true");
    await user.keyboard("c");
    expect(toggle()).toHaveAttribute("aria-pressed", "false");
  });

  it("does not hijack C while typing in a field", async () => {
    const user = await renderApp();
    await addRouter(user);
    await addRouter(user);
    await user.click(row("r1"));

    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "core");

    expect(toggle()).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText("Name")).toHaveValue("core");
  });

  it("forgets a pending device that is deleted underneath it", async () => {
    const user = await renderApp();
    await addRouter(user);
    await addRouter(user);
    await user.click(toggle());
    await user.click(row("r1"));

    // Removing r1 from the tree must not leave a dangling first end.
    await user.click(row("r1"));
    await user.click(toggle());
    await user.click(row("r1"));
    await user.keyboard("{Delete}");

    expect(screen.queryByRole("treeitem", { name: /first end of the new link/ })).toBeNull();
  });
});

describe("joining an existing collision domain", () => {
  const toggle = () => screen.getByRole("button", { name: /Connect mode/ });

  /**
   * Expand a device so its interface rows are reachable.
   *
   * Done before entering connect mode on purpose: in connect mode a click on
   * a device row *picks* that device, so expanding by clicking would
   * accidentally choose an end.
   */
  async function expand(user: ReturnType<typeof userEvent.setup>, device: string) {
    await user.click(row(device));
    await user.keyboard("{ArrowRight}");
  }

  async function threeRoutersOneLink(user: ReturnType<typeof userEvent.setup>) {
    await addRouter(user);
    await addRouter(user);
    await addRouter(user);
    await link(user, "r1", "r2");
  }

  it("adds a third device to the domain r1 and r2 already share", async () => {
    const user = await renderApp();
    await threeRoutersOneLink(user);

    // Pick the device, then the collision domain — via r1's eth0 row, which
    // is the keyboard equivalent of clicking the link on the canvas.
    await expand(user, "r1");
    await user.click(toggle());
    await user.click(row("r3"));
    await user.click(screen.getByRole("treeitem", { name: /eth0.*domain A/ }));

    // All three now sit on A, rather than r3 getting a separate domain B.
    expect(screen.getByRole("treeitem", { name: /r3, router, 1 interface/ })).toBeInTheDocument();
    expect(
      screen.getByRole("treeitem", { name: /eth0.*domain A.*r2 eth0, r3 eth0/ }),
    ).toBeInTheDocument();
  });

  it("works in the other order too", async () => {
    const user = await renderApp();
    await threeRoutersOneLink(user);

    await expand(user, "r1");
    await user.click(toggle());
    await user.click(screen.getByRole("treeitem", { name: /eth0.*domain A/ }));
    await user.click(row("r3"));

    expect(screen.getByRole("treeitem", { name: /r3, router, 1 interface/ })).toBeInTheDocument();
  });

  it("tells the user what activating an interface row will do", async () => {
    const user = await renderApp();
    await threeRoutersOneLink(user);
    await expand(user, "r1");
    await user.click(toggle());

    expect(
      screen.getByRole("treeitem", { name: /press Enter to use collision domain A/ }),
    ).toBeInTheDocument();
  });

  it("offers no such hint outside connect mode", async () => {
    const user = await renderApp();
    await threeRoutersOneLink(user);
    await expand(user, "r1");

    expect(screen.queryByRole("treeitem", { name: /press Enter to use/ })).toBeNull();
  });

  it("refuses to join two collision domains", async () => {
    const user = await renderApp();
    await addRouter(user);
    await addRouter(user);
    await addRouter(user);
    await addRouter(user);
    await link(user, "r1", "r2");
    await link(user, "r3", "r4");

    await expand(user, "r1");
    await expand(user, "r3");
    await user.click(toggle());
    await user.click(screen.getByRole("treeitem", { name: /eth0.*domain A/ }));
    await user.click(screen.getByRole("treeitem", { name: /eth0.*domain B/ }));

    expect(await screen.findByText(/Two collision domains cannot be joined/)).toBeInTheDocument();
  });

  it("drops a pending domain that no longer exists", async () => {
    const user = await renderApp();
    await threeRoutersOneLink(user);

    await expand(user, "r1");
    await user.click(toggle());
    await user.click(screen.getByRole("treeitem", { name: /eth0.*domain A/ }));

    // Deleting both members leaves domain A with nothing on it.
    await user.keyboard("{Escape}");
    await user.click(row("r1"));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(row("r2"));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(screen.queryByRole("treeitem", { name: /first end of the new link/ })).toBeNull();
  });
});

describe("selection and deletion", () => {
  it("deletes the selected device", async () => {
    const user = await renderApp();
    await addRouter(user);
    await user.click(screen.getByRole("treeitem", { name: /^r1/ }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText(/No devices yet/)).toBeInTheDocument();
  });

  it("extends the selection with Ctrl+click", async () => {
    const user = await renderApp();
    await addRouter(user);
    await addRouter(user);

    await user.click(screen.getByRole("treeitem", { name: /^r1/ }));
    await user.keyboard("{Control>}");
    await user.click(screen.getByRole("treeitem", { name: /^r2/ }));
    await user.keyboard("{/Control}");

    expect(screen.getByRole("treeitem", { name: /^r1/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("treeitem", { name: /^r2/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("replaces the selection on a plain click", async () => {
    const user = await renderApp();
    await addRouter(user);
    await addRouter(user);

    await user.click(screen.getByRole("treeitem", { name: /^r1/ }));
    await user.click(screen.getByRole("treeitem", { name: /^r2/ }));

    expect(screen.getByRole("treeitem", { name: /^r1/ })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });
});

describe("arrange", () => {
  it("keeps alignment disabled until enough is selected", async () => {
    const user = await renderApp();
    await addRouter(user);
    await user.click(screen.getByRole("treeitem", { name: /^r1/ }));
    expect(screen.getByRole("button", { name: "Align left" })).toBeDisabled();
  });

  it("enables alignment for two selected devices", async () => {
    const user = await renderApp();
    await addRouter(user);
    await addRouter(user);
    await user.click(screen.getByRole("treeitem", { name: /^r1/ }));
    await user.keyboard("{Control>}");
    await user.click(screen.getByRole("treeitem", { name: /^r2/ }));
    await user.keyboard("{/Control}");

    expect(screen.getByRole("button", { name: "Align left" })).toBeEnabled();
  });

  it("requires three devices before distributing", async () => {
    const user = await renderApp();
    await addRouter(user);
    await addRouter(user);
    await user.click(screen.getByRole("treeitem", { name: /^r1/ }));
    await user.keyboard("{Control>}");
    await user.click(screen.getByRole("treeitem", { name: /^r2/ }));
    await user.keyboard("{/Control}");

    expect(screen.getByRole("button", { name: "Distribute horizontally" })).toBeDisabled();
  });
});

describe("accessibility", () => {
  it("offers a skip link to the topology", async () => {
    await renderApp();
    expect(screen.getByRole("link", { name: /Skip to topology/ })).toBeInTheDocument();
  });

  it("labels each region", async () => {
    await renderApp();
    expect(screen.getByRole("complementary", { name: "Devices" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Device details" })).toBeInTheDocument();
  });

  it("announces edits in a live region", async () => {
    const user = await renderApp();
    await addRouter(user);
    // A canvas change is silent to a screen reader unless it is announced.
    await waitFor(() =>
      expect(within(screen.getByRole("status")).getByText(/Added router r1/)).toBeTruthy(),
    );
  });

  it("has no axe violations when empty", async () => {
    const { container } = render(<App />);
    await screen.findByText(/No devices yet/);
    const results = await axeCore.run(container);
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  it("has no axe violations with a populated topology", async () => {
    const user = await renderApp();
    await addRouter(user);
    await addRouter(user);
    await link(user, "r1", "r2");
    await user.click(row("r1"));

    const results = await axeCore.run(document.body);
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});

describe("addressing", () => {
  const MIXED = {
    issues: [
      {
        severity: "error" as const,
        code: "mixed_subnets",
        message:
          "Collision domain A carries more than one subnet: 10.0.0.0/24 (r1 eth0); " +
          "192.168.1.0/24 (r2 eth0).",
        collision_domain: "A",
        devices: ["r1", "r2"],
      },
      {
        severity: "warning" as const,
        code: "missing_address",
        message: "r3 eth0 has no address.",
        collision_domain: "B",
        devices: ["r3"],
      },
    ],
    errors: 1,
    warnings: 1,
  };

  it("confirms when nothing is wrong, rather than staying silent", async () => {
    const user = await renderApp();
    await addRouter(user);
    expect(await screen.findByText("No addressing problems found.")).toBeInTheDocument();
  });

  it("reports problems found in the current design", async () => {
    checkAddressing.mockResolvedValue(MIXED);
    const user = await renderApp();
    await addRouter(user);

    expect(await screen.findByText("1 error, 1 warning")).toBeInTheDocument();
    expect(screen.getByText(/carries more than one subnet/)).toBeInTheDocument();
  });

  it("labels severity in words, not only by colour", async () => {
    // Capability 6 Scenario A: diagnostics must be unambiguous without hue.
    checkAddressing.mockResolvedValue(MIXED);
    const user = await renderApp();
    await addRouter(user);

    await screen.findByText("1 error, 1 warning");
    expect(screen.getByText("Error:")).toBeInTheDocument();
    expect(screen.getByText("Warning:")).toBeInTheDocument();
  });

  it("validates the topology in the browser, not the saved one", async () => {
    const user = await renderApp();
    await addRouter(user);
    await screen.findByText("No addressing problems found.");

    const sent = checkAddressing.mock.calls.at(-1)?.[0];
    expect(sent?.nodes.map((n) => n.name)).toEqual(["r1"]);
  });

  it("debounces so a burst of edits is one request", async () => {
    const user = await renderApp();
    await addRouter(user);
    await addRouter(user);
    await addRouter(user);
    await screen.findByText("No addressing problems found.");

    expect(checkAddressing.mock.calls.length).toBeLessThan(3);
  });

  it("assigns addresses and folds the result into one undo step", async () => {
    const user = await renderApp();
    await addRouter(user);

    const filled = emptyTopology();
    filled.nodes = [
      {
        name: "r1",
        kind: "router",
        bridged: false,
        position: { x: 0, y: 0 },
        interfaces: [{ number: 0, collision_domain: "A", ip: "10.0.0.1/24" }],
        daemons: [],
        extra_options: {},
      },
    ];
    allocateAddressing.mockResolvedValue({
      topology: filled,
      assigned_subnets: { A: "10.0.0.0/24" },
      assigned_addresses: { "r1:0": "10.0.0.1/24" },
      skipped: [],
      changed: true,
    });

    await user.click(screen.getByRole("button", { name: "Assign addresses" }));

    expect(await screen.findByRole("treeitem", { name: /r1, router, 1 interface/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("treeitem", { name: /r1, router, 0 interfaces/ })).toBeInTheDocument();
  });

  it("distinguishes assigning from renumbering", async () => {
    const user = await renderApp();
    await addRouter(user);

    await user.click(screen.getByRole("button", { name: "Renumber all" }));
    expect(allocateAddressing).toHaveBeenCalledWith(
      expect.objectContaining({ overwrite: true }),
    );

    await user.click(screen.getByRole("button", { name: "Assign addresses" }));
    expect(allocateAddressing).toHaveBeenLastCalledWith(
      expect.objectContaining({ overwrite: false }),
    );
  });

  it("withdraws the calculator when the scenario forbids it", async () => {
    // Exam mode: the server refuses, and the control stops pretending.
    allocateAddressing.mockRejectedValue(new MockApiError("disabled", 403));
    const user = await renderApp();
    await addRouter(user);

    await user.click(screen.getByRole("button", { name: "Assign addresses" }));

    expect(await screen.findByText(/subnet calculator is disabled/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Assign addresses" })).toBeNull();
  });

  it("withdraws validation when the scenario forbids it", async () => {
    checkAddressing.mockRejectedValue(new MockApiError("disabled", 403));
    const user = await renderApp();
    await addRouter(user);

    await waitFor(() =>
      expect(screen.queryByText(/No addressing problems found/)).toBeNull(),
    );
  });

  it("has no axe violations while reporting problems", async () => {
    checkAddressing.mockResolvedValue(MIXED);
    const user = await renderApp();
    await addRouter(user);
    await screen.findByText("1 error, 1 warning");

    const results = await axeCore.run(document.body);
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});

describe("regression: allocation must not wipe the canvas", () => {
  it("sends the topology the editor is holding", async () => {
    // Omitting it made the server allocate over its stale, empty session and
    // return that, which the editor then adopted — losing every device.
    const user = await renderApp();
    await addRouter(user);
    await addRouter(user);

    await user.click(screen.getByRole("button", { name: "Assign addresses" }));

    const sent = allocateAddressing.mock.calls.at(-1)?.[0] as
      | { topology?: { nodes: { name: string }[] } }
      | undefined;
    expect(sent?.topology?.nodes.map((n) => n.name)).toEqual(["r1", "r2"]);
  });

  it("keeps every device after assigning", async () => {
    const user = await renderApp();
    await addRouter(user);
    await addRouter(user);

    await user.click(screen.getByRole("button", { name: "Assign addresses" }));

    expect(await screen.findByRole("treeitem", { name: /^r1/ })).toBeTruthy();
    expect(screen.getByRole("treeitem", { name: /^r2/ })).toBeInTheDocument();
    expect(screen.queryByText(/No devices yet/)).toBeNull();
  });

  it("keeps every device after renumbering", async () => {
    const user = await renderApp();
    await addRouter(user);
    await addRouter(user);

    await user.click(screen.getByRole("button", { name: "Renumber all" }));

    expect(await screen.findByRole("treeitem", { name: /^r1/ })).toBeTruthy();
    expect(screen.getByRole("treeitem", { name: /^r2/ })).toBeInTheDocument();
  });
});

describe("deploying and verifying", () => {
  const deployed: StatusResponse = {
    devices: [
      { name: "r1", state: "running" },
      { name: "r2", state: "running" },
    ],
    running: ["r1", "r2"],
    exited: [],
    drift: [],
    deployed: true,
    lab_dir: "/tmp/lab",
    message: null,
    needs_confirmation: false,
    conflicts: null,
  };

  it("will not deploy an empty topology", async () => {
    await renderApp();
    expect(await screen.findByRole("button", { name: "Deploy" })).toBeDisabled();
    expect(screen.getByText("Add a device before deploying.")).toBeInTheDocument();
  });

  it("deploys the topology the editor is holding", async () => {
    const user = await renderApp();
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Deploy" }));

    const sent = deploy.mock.calls.at(-1)?.[0];
    expect(sent?.nodes.map((n) => n.name)).toEqual(["r1"]);
  });

  it("reports each device with a word, not only a colour", async () => {
    deploy.mockResolvedValue(deployed);
    const user = await renderApp();
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Deploy" }));

    expect(await screen.findByText("r1")).toBeInTheDocument();
    expect(screen.getAllByText("Running")).toHaveLength(2);
  });

  it("keeps Stop and Verify unavailable until something is running", async () => {
    const user = await renderApp();
    await addRouter(user);
    expect(await screen.findByRole("button", { name: "Stop" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Verify links" })).toBeDisabled();

    deploy.mockResolvedValue(deployed);
    await user.click(screen.getByRole("button", { name: "Deploy" }));
    expect(await screen.findByRole("button", { name: "Stop" })).toBeEnabled();
  });

  it("reports a failing link in words", async () => {
    // Capability 6 Scenario A: a diagnostic must not depend on hue.
    deploy.mockResolvedValue(deployed);
    verify.mockResolvedValue({
      checks: [
        {
          collision_domain: "A",
          source: "r1",
          source_interface: 0,
          target: "r2",
          target_interface: 0,
          target_address: "10.0.0.2",
          outcome: "fail" as const,
          detail: "no reply",
        },
      ],
      passed: 0,
      failed: 1,
      skipped: 0,
      healthy: false,
      message: null,
    });

    const user = await renderApp();
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Deploy" }));
    await user.click(await screen.findByRole("button", { name: "Verify links" }));

    expect(await screen.findByText("1 of 1 links failed")).toBeInTheDocument();
    expect(screen.getByText("Fail")).toBeInTheDocument();
    expect(screen.getByText(/r1 eth0 → r2 eth0 on A/)).toBeInTheDocument();
  });

  it("discards stale diagnostics when the lab is stopped", async () => {
    // Results describing a lab that is no longer running would be a lie.
    deploy.mockResolvedValue(deployed);
    verify.mockResolvedValue({
      checks: [],
      passed: 1,
      failed: 0,
      skipped: 0,
      healthy: true,
      message: null,
    });

    const user = await renderApp();
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Deploy" }));
    await user.click(await screen.findByRole("button", { name: "Verify links" }));
    expect(await screen.findByText("All 1 links passed")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Stop" }));
    await user.click(
      await screen.findByRole("button", { name: "Stop and discard container changes" }),
    );
    await waitFor(() => expect(screen.queryByText("All 1 links passed")).toBeNull());
  });

  it("shows an environment blocker with its remedy, and refuses to deploy", async () => {
    probe.mockResolvedValue({
      checks: [
        {
          name: "Docker daemon",
          status: "blocked" as const,
          detail: "Could not reach the Docker daemon.",
          remedy: "Start Docker Desktop and wait for it to report running.",
        },
      ],
      can_deploy: false,
    });

    const user = await renderApp();
    await addRouter(user);

    expect(await screen.findByText(/Could not reach the Docker daemon/)).toBeInTheDocument();
    expect(screen.getByText(/Start Docker Desktop/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deploy" })).toBeDisabled();
  });

  it("hides verification when the scenario withdraws it", async () => {
    features.mockResolvedValue({
      subnet_calculator: true,
      addressing_validation: true,
      infrastructure_verification: false,
    });
    const user = await renderApp();
    await addRouter(user);

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Verify links" })).toBeNull(),
    );
  });

  it("has no axe violations while showing results", async () => {
    deploy.mockResolvedValue(deployed);
    const user = await renderApp();
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Deploy" }));
    await screen.findByText("r1");

    const results = await axeCore.run(document.body);
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});

describe("finding the lab on disk", () => {
  /**
   * navigator.clipboard is getter-only in jsdom, so it must be redefined —
   * and `userEvent.setup()` installs a stub of its own, so this has to run
   * *after* the user session is created or it is silently replaced.
   */
  function stubClipboard(writeText: () => Promise<void>) {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
  }

  const deployedAt = (dir: string): StatusResponse => ({
    devices: [
      { name: "r1", state: "running", container: "kathara_u_r1_h", shell: "/bin/bash" },
      { name: "r2", state: "running", container: "kathara_u_r2_h", shell: "/bin/bash" },
    ],
    running: ["r1", "r2"],
    exited: [],
    drift: [],
    deployed: true,
    lab_dir: dir,
    message: null,
    needs_confirmation: false,
    conflicts: null,
  });

  it("shows nothing about a directory before anything is deployed", async () => {
    await renderApp();
    expect(screen.queryByText("Lab directory")).toBeNull();
  });

  it("shows where the lab was written", async () => {
    deploy.mockResolvedValue(deployedAt("/home/jan/KatharaGUI/kathara-labs/untitled"));
    const user = await renderApp();
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Deploy" }));

    expect(
      await screen.findByText("/home/jan/KatharaGUI/kathara-labs/untitled"),
    ).toBeInTheDocument();
  });

  it("gives a shell command that needs nothing but Docker", async () => {
    // Found on the first Windows run: `cd DIR && kathara connect r1` failed,
    // because the Kathará CLI is a separate install there and Windows
    // PowerShell 5.1 has no `&&`. Docker is already required, so this works
    // in any terminal.
    deploy.mockResolvedValue(deployedAt("/labs/untitled"));
    const user = await renderApp();
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Deploy" }));

    expect(
      await screen.findByText("docker exec -it kathara_u_r1_h /bin/bash"),
    ).toBeInTheDocument();
  });

  it("offers the Kathará form without cd or &&, quoted for spaces", async () => {
    // Kathará keys a lab by its directory, so `-d` names it instead of a cd.
    deploy.mockResolvedValue(deployedAt("C:\\Users\\Jan Kowalski\\kathara-labs\\untitled"));
    const user = await renderApp();
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Deploy" }));

    expect(
      await screen.findByText(
        'kathara connect -d "C:\\Users\\Jan Kowalski\\kathara-labs\\untitled" r1',
      ),
    ).toBeInTheDocument();
  });

  it("lets the user choose which device to open a shell on", async () => {
    deploy.mockResolvedValue(deployedAt("/labs/untitled"));
    const user = await renderApp();
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Deploy" }));

    await user.selectOptions(await screen.findByLabelText("Open a shell on"), "r2");
    expect(screen.getByText("docker exec -it kathara_u_r2_h /bin/bash")).toBeInTheDocument();
  });

  it("copies the command and confirms in the live region", async () => {
    deploy.mockResolvedValue(deployedAt("/labs/untitled"));
    const user = await renderApp();

    const writeText = vi.fn(async () => undefined);
    stubClipboard(writeText);

    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Deploy" }));
    await user.click(await screen.findByRole("button", { name: "Copy command" }));

    expect(writeText).toHaveBeenCalledWith("docker exec -it kathara_u_r1_h /bin/bash");
    await waitFor(() =>
      expect(within(screen.getByRole("status")).getByText(/copied/i)).toBeTruthy(),
    );
  });

  it("says so when the clipboard is refused, rather than failing silently", async () => {
    deploy.mockResolvedValue(deployedAt("/labs/untitled"));
    const user = await renderApp();

    stubClipboard(async () => {
      throw new Error("denied");
    });

    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Deploy" }));
    await user.click(await screen.findByRole("button", { name: "Copy command" }));

    await waitFor(() =>
      expect(within(screen.getByRole("status")).getByText(/Could not copy/)).toBeTruthy(),
    );
  });
})

describe("resizing the side panels", () => {
  // Requested after the layout crowded the canvas on a small window. A divider
  // that only responds to dragging is unusable from the keyboard, so this is
  // the ARIA separator pattern and the keyboard route is tested first.

  const divider = (name: string) => screen.getByRole("separator", { name });

  it("offers a divider for each panel", async () => {
    await renderApp();
    expect(divider("Width of the devices panel")).toBeInTheDocument();
    expect(divider("Width of the details panel")).toBeInTheDocument();
  });

  it("reports its width, and its limits, to assistive technology", async () => {
    await renderApp();
    const handle = divider("Width of the devices panel");

    expect(handle).toHaveAttribute("aria-valuenow", "336");
    expect(handle).toHaveAttribute("aria-valuemin", "208");
    expect(handle).toHaveAttribute("aria-valuemax", "560");
    expect(handle).toHaveAttribute("aria-orientation", "vertical");
  });

  it("widens the left panel with the right arrow", async () => {
    const user = await renderApp();
    const handle = divider("Width of the devices panel");
    handle.focus();
    await user.keyboard("{ArrowRight}");

    expect(divider("Width of the devices panel")).toHaveAttribute("aria-valuenow", "352");
  });

  it("widens the right panel with the *left* arrow", async () => {
    // Arrows mean a direction on screen, not "bigger". Dragging the right
    // panel's edge leftwards widens it, and the keyboard has to agree or the
    // two controls contradict each other.
    const user = await renderApp();
    const handle = divider("Width of the details panel");
    handle.focus();
    await user.keyboard("{ArrowLeft}");

    expect(divider("Width of the details panel")).toHaveAttribute("aria-valuenow", "320");
  });

  it("stops at the narrow limit rather than collapsing the panel", async () => {
    const user = await renderApp();
    const handle = divider("Width of the devices panel");
    handle.focus();
    await user.keyboard("{Home}");

    expect(divider("Width of the devices panel")).toHaveAttribute("aria-valuenow", "208");
  });

  it("stops at the wide limit rather than swallowing the canvas", async () => {
    const user = await renderApp();
    const handle = divider("Width of the devices panel");
    handle.focus();
    await user.keyboard("{End}");

    expect(divider("Width of the devices panel")).toHaveAttribute("aria-valuenow", "560");
  });

  it("can be reached by keyboard at all", async () => {
    const user = await renderApp();
    await user.tab();
    // Whatever comes first, the divider must be somewhere in the tab order.
    const handle = divider("Width of the devices panel");
    expect(handle).toHaveAttribute("tabindex", "0");
  });
});

describe("the selected device's own panel", () => {
  // Requested: the controls belonging to one device should sit in a coloured
  // rectangle of their own, and that rectangle should not be there when no
  // device is selected — an empty tinted block promises controls that are not.

  const deviceBlock = () => document.querySelector(".inspector--device");

  it("shows no device block until something is selected", async () => {
    await renderApp();
    expect(await screen.findByText(/Select a device to edit/)).toBeInTheDocument();
    expect(deviceBlock()).toBeNull();
  });

  it("wraps the selected device's settings in one block", async () => {
    const user = await renderApp();
    await addRouter(user);

    const block = deviceBlock();
    expect(block).not.toBeNull();
    // Everything about that one device, gathered together.
    expect(block).toHaveTextContent("Name");
    expect(block).toHaveTextContent("Container image");
  });

  it("takes the block away again when the selection is cleared", async () => {
    const user = await renderApp();
    await addRouter(user);
    expect(deviceBlock()).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deviceBlock()).toBeNull());
  });
});

describe("when the running lab has drifted from the canvas", () => {
  // Reported: an address changed, Verify pressed, and the results described
  // something else. Diagnostics ping real containers, so they can only report
  // what is running — the missing part was saying so. With the design locked
  // while deployed, the difference can only come from inside a container.

  const drifted: StatusResponse = {
    drift: ["r1 eth0 is 192.168.1.1/24 on the canvas but 10.0.0.1/24 in the running lab"],
    devices: [{ name: "r1", state: "running" }],
    running: ["r1"],
    exited: [],
    deployed: true,
    lab_dir: "/workspace/untitled",
    message: null,
    needs_confirmation: false,
    conflicts: null,
  };

  it("turns the header so the difference cannot be missed", async () => {
    // Reported twice: the panel warning was not being seen. A colour alone is
    // not a status, so the header carries the words too.
    deploy.mockResolvedValue(drifted);
    const user = await renderApp();
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Deploy" }));

    expect(await screen.findByText(/differs from the canvas in 1 place:/)).toBeInTheDocument();
    // And says what to do about it, not only that something is wrong.
    expect(screen.getByText(/capture to keep, or stop to discard/)).toBeInTheDocument();
    expect(document.querySelector('.app__header[data-drift="true"]')).not.toBeNull();
  });

  it("counts the differences, rather than nagging generically", async () => {
    deploy.mockResolvedValue({
      ...drifted,
      drift: ["r1 eth0 differs", "r2 was added and is not running"],
    });
    const user = await renderApp();
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Deploy" }));

    expect(await screen.findByText(/in 2 places/)).toBeInTheDocument();
  });

  it("leaves the header alone when the two agree", async () => {
    const user = await renderApp();
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Deploy" }));

    await waitFor(() =>
      expect(document.querySelector('.app__header[data-drift="true"]')).toBeNull(),
    );
  });

  it("says the two no longer match", async () => {
    deploy.mockResolvedValue(drifted);
    const user = await renderApp();
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Deploy" }));

    expect(
      await screen.findByText(/The running lab no longer matches the canvas/),
    ).toBeInTheDocument();
  });

  it("lists what actually differs, rather than only that something does", async () => {
    deploy.mockResolvedValue(drifted);
    const user = await renderApp();
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Deploy" }));

    expect(await screen.findByText(/192\.168\.1\.1\/24 on the canvas/)).toBeInTheDocument();
  });

  it("says the link checks describe the running lab", async () => {
    deploy.mockResolvedValue(drifted);
    verify.mockResolvedValue({
      checks: [],
      passed: 1,
      failed: 0,
      skipped: 0,
      healthy: true,
      message: null,
    });
    const user = await renderApp();
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Deploy" }));
    await user.click(await screen.findByRole("button", { name: "Verify links" }));

    expect(await screen.findByText(/describe the/)).toBeInTheDocument();
  });

  it("says nothing when the canvas and the lab agree", async () => {
    const user = await renderApp();
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Deploy" }));

    await waitFor(() =>
      expect(screen.queryByText(/running lab no longer matches the canvas/)).toBeNull(),
    );
  });
});

describe("tidying the whole layout", () => {
  // Reported: an imported lab piles every device on the same spot, and
  // distributing them by hand is not good enough. The algorithm lays them out
  // in layers with as few link crossings as it can.

  it("needs at least two devices", async () => {
    await renderApp();
    expect(await screen.findByRole("button", { name: "Tidy layout" })).toBeDisabled();
  });

  it("moves the devices where the server says", async () => {
    const user = await renderApp();
    await addRouter(user);
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Tidy layout" }));

    await waitFor(() => expect(arrange).toHaveBeenCalled());
  });

  it("is one undo step, however many devices moved", async () => {
    // Which is what makes trying a layout cheap.
    const user = await renderApp();
    await addRouter(user);
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Tidy layout" }));
    await waitFor(() => expect(arrange).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Undo" }));
    // Back to two devices with their original positions, and nothing further
    // to undo beyond the two additions.
    expect(screen.getByRole("button", { name: "Redo" })).toBeEnabled();
  });

  it("says so rather than creating an empty undo step when nothing moves", async () => {
    arrange.mockImplementation(async (topology: Topology) => ({
      positions: Object.fromEntries(topology.nodes.map((n) => [n.name, n.position])),
    }));
    const user = await renderApp();
    await addRouter(user);
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Tidy layout" }));

    expect(await screen.findByText("The layout is already tidy.")).toBeInTheDocument();
  });
});

describe("the scenario as a folder", () => {
  // Capability 5. A scenario is a Kathará lab folder and the export is a plain
  // zip of it — one Save, one Open, one Export, one Import. The earlier design
  // offered `.kgui` and `lab.conf` as separate pairs, which asked the user to
  // understand a distinction that should not have existed.

  it("will not save an empty scenario", async () => {
    await renderApp();
    const [save] = await screen.findAllByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
  });

  it("writes files, rather than only pushing to the server", async () => {
    // The header button used to call PUT /api/topology, which put the document
    // in the server's memory and nothing on disk, while saying "Save".
    const user = await renderApp();
    await addRouter(user);
    await user.click((await screen.findAllByRole("button", { name: "Save" }))[0]!);

    await waitFor(() => expect(saveProject).toHaveBeenCalled());
    expect(await screen.findByText(/Saved in untitled/)).toBeInTheDocument();
  });

  it("reports the folder the scenario lives in", async () => {
    const user = await renderApp();
    await addRouter(user);
    await user.click((await screen.findAllByRole("button", { name: "Save" }))[0]!);

    // Scoped to the panel: the header shows the scenario's name, which for a
    // fresh document happens to read the same as its folder.
    const panel = screen.getByRole("region", { name: "Scenario" });
    await waitFor(() => expect(within(panel).getByText(/Saved in/)).toBeInTheDocument());
    expect(within(panel).getByText("untitled")).toBeInTheDocument();
  });

  it("clears the unsaved marker without losing undo history", async () => {
    const user = await renderApp();
    await addRouter(user);
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    await user.click((await screen.findAllByRole("button", { name: "Save" }))[0]!);

    await waitFor(() => expect(screen.queryByText("Unsaved changes")).toBeNull());
    // Saving is not reloading: the edit is still undoable.
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
  });

  it("saves under a chosen name", async () => {
    const user = await renderApp();
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Save as…" }));
    await user.type(screen.getByLabelText("Save as"), "submission-group-b");
    await user.click(screen.getByRole("button", { name: "Save scenario" }));

    await waitFor(() =>
      expect(saveProject).toHaveBeenCalledWith(expect.anything(), "submission-group-b"),
    );
  });

  it("lists the scenarios in the workspace when the chooser opens", async () => {
    scenarios.mockResolvedValue([
      { folder: "week-3", name: "OSPF triangle", devices: 3, modified: 1, foreign: false },
    ]);
    const user = await renderApp();
    await user.click(await screen.findByRole("button", { name: "Open…" }));

    expect(await screen.findByText("OSPF triangle")).toBeInTheDocument();
    expect(screen.getByText(/week-3 · 3 devices/)).toBeInTheDocument();
  });

  it("marks a scenario that came from outside", async () => {
    scenarios.mockResolvedValue([
      { folder: "someone-elses", name: "legacy lab", devices: 2, modified: 1, foreign: true },
    ]);
    const user = await renderApp();
    await user.click(await screen.findByRole("button", { name: "Open…" }));

    const list = await screen.findByRole("list", { name: "Scenarios in the workspace" });
    expect(within(list).getByText(/imported/)).toBeInTheDocument();
  });

  it("opens the scenario that was chosen", async () => {
    scenarios.mockResolvedValue([
      { folder: "week-3", name: "OSPF triangle", devices: 3, modified: 1, foreign: false },
    ]);
    const user = await renderApp();
    await user.click(await screen.findByRole("button", { name: "Open…" }));
    await user.click(await screen.findByText("OSPF triangle"));

    await waitFor(() => expect(openProject).toHaveBeenCalledWith("week-3"));
    expect(await screen.findByText(/Opened opened scenario/)).toBeInTheDocument();
  });

  it("warns that opening replaces unsaved work", async () => {
    const user = await renderApp();
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Open…" }));

    expect(await screen.findByText(/opening another replaces it/)).toBeInTheDocument();
  });

  it("does not warn when there is nothing to lose", async () => {
    const user = await renderApp();
    await user.click(await screen.findByRole("button", { name: "Open…" }));

    expect(screen.queryByText(/opening another replaces it/)).toBeNull();
  });

  it("hands the exported zip to the browser", async () => {
    const createObjectURL = vi.fn(() => "blob:scenario");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, writable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: revokeObjectURL, writable: true });

    const user = await renderApp();
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Export" }));

    await waitFor(() => expect(exportProject).toHaveBeenCalled());
    expect(createObjectURL).toHaveBeenCalled();
    // Not revoking would keep the whole archive in memory for the tab's life.
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:scenario");
  });

  it("imports a scenario the user picks", async () => {
    const user = await renderApp();
    const file = new File(["PK"], "submission-jan.zip", { type: "application/zip" });
    await user.upload(screen.getByLabelText("Scenario file to import"), file);

    await waitFor(() => expect(importProject).toHaveBeenCalled());
    expect(await screen.findByText(/Opened imported scenario/)).toBeInTheDocument();
  });

  it("says when an imported lab came from outside this application", async () => {
    // Its feature toggles are defaults rather than an instructor's choices.
    const user = await renderApp();
    await user.upload(
      screen.getByLabelText("Scenario file to import"),
      new File(["PK"], "legacy.zip", { type: "application/zip" }),
    );

    expect(
      await screen.findByText(/imported from outside this application/),
    ).toBeInTheDocument();
  });

  it("accepts a bare lab.conf as well as a zip", async () => {
    const user = await renderApp();
    await user.upload(
      screen.getByLabelText("Scenario file to import"),
      new File(['r1[0]="A"'], "lab.conf", { type: "text/plain" }),
    );

    await waitFor(() => expect(importProject).toHaveBeenCalled());
  });

  it("reports lines of an imported lab.conf it could not understand", async () => {
    importProject.mockResolvedValue({
      topology: { name: "partial", nodes: [], collision_domains: [] } as never,
      features: {
        subnet_calculator: true,
        addressing_validation: true,
        infrastructure_verification: true,
      },
      folder: "/workspace/partial",
      warnings: ["r1[99]=nonsense"],
      foreign: true,
    });
    const user = await renderApp();
    await user.upload(
      screen.getByLabelText("Scenario file to import"),
      new File(["junk"], "lab.conf", { type: "text/plain" }),
    );

    expect(await screen.findByText("r1[99]=nonsense")).toBeInTheDocument();
  });

  it("adopts an opened scenario's exam restrictions", async () => {
    // Feature toggles belong to the scenario, not the machine it is opened on.
    openProject.mockResolvedValue({
      topology: { name: "exam", nodes: [], collision_domains: [] } as never,
      features: {
        subnet_calculator: false,
        addressing_validation: true,
        infrastructure_verification: true,
      },
      folder: "/workspace/exam",
      warnings: [],
      foreign: false,
    });
    scenarios.mockResolvedValue([
      { folder: "exam", name: "exam", devices: 1, modified: 1, foreign: false },
    ]);

    const user = await renderApp();
    await user.click(await screen.findByRole("button", { name: "Open…" }));
    await user.click(await screen.findByText("exam"));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Assign addresses/ })).toBeNull(),
    );
  });
});

describe("capturing running configuration", () => {
  const running: StatusResponse = {
    devices: [{ name: "r1", state: "running" }],
    running: ["r1"],
    exited: [],
    drift: [],
    deployed: true,
    lab_dir: "/workspace/untitled",
    message: null,
    needs_confirmation: false,
    conflicts: null,
  };

  it("cannot capture from a lab that is not running", async () => {
    await renderApp();
    expect(
      await screen.findByRole("button", { name: "Capture running state" }),
    ).toBeDisabled();
    expect(screen.getByText(/nothing to capture from/)).toBeInTheDocument();
  });

  it("captures once the lab is up", async () => {
    deploy.mockResolvedValue(running);
    captureState.mockResolvedValue({
      captured: [{ device: "r1", path: "r1/etc/frr/frr.conf", lines: 42 }],
      skipped: [],
      message: null,
      folder: "/workspace/untitled",
      topology: { name: "untitled", nodes: [], collision_domains: [] } as never,
    });

    const user = await renderApp();
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Deploy" }));
    await user.click(await screen.findByRole("button", { name: "Capture running state" }));

    await waitFor(() => expect(captureState).toHaveBeenCalled());
    expect(await screen.findByText("42 lines")).toBeInTheDocument();
  });

  it("says what it could not capture, rather than staying silent", async () => {
    // Silence would look like success.
    deploy.mockResolvedValue(running);
    captureState.mockResolvedValue({
      captured: [],
      skipped: [["pc1", "not a router"]],
      message: "Nothing was captured.",
      folder: "/workspace/untitled",
      topology: { name: "untitled", nodes: [], collision_domains: [] } as never,
    });

    const user = await renderApp();
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Deploy" }));
    await user.click(await screen.findByRole("button", { name: "Capture running state" }));

    expect(await screen.findByText("not a router")).toBeInTheDocument();
    expect(screen.getByText("Nothing was captured.")).toBeInTheDocument();
  });
});

describe("a lab whose containers have died", () => {
  // Docker does not restart Kathará containers, so a Docker restart or a
  // machine sleeping overnight leaves the lab here. The reported symptom was
  // baffling: `kathara list` still showed every device, the interface said the
  // lab was running, and every `kathara connect` failed with a 409.
  const halfDead: StatusResponse = {
    devices: [
      { name: "r1", state: "exited" },
      { name: "r2", state: "running" },
    ],
    running: ["r2"],
    exited: ["r1"],
    drift: [],
    deployed: true,
    lab_dir: "/labs/untitled",
    message: null,
    needs_confirmation: false,
    conflicts: null,
  };

  const allDead: StatusResponse = {
    devices: [{ name: "r1", state: "exited" }],
    running: [],
    exited: ["r1"],
    drift: [],
    deployed: true,
    lab_dir: "/labs/untitled",
    message: null,
    needs_confirmation: false,
    conflicts: null,
  };

  it("says the device stopped rather than calling it running", async () => {
    deploy.mockResolvedValue(halfDead);
    const user = await renderApp();
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Deploy" }));

    const rows = await screen.findAllByRole("listitem");
    const r1 = rows.find((row) => row.textContent?.includes("r1"))!;
    expect(r1).toHaveTextContent("Exited");
    expect(r1).not.toHaveTextContent("Running");
  });

  it("explains why connecting to it fails", async () => {
    deploy.mockResolvedValue(halfDead);
    const user = await renderApp();
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Deploy" }));

    expect(await screen.findByText(/1 device has.*stopped/s)).toBeInTheDocument();
    expect(screen.getByText(/cannot open a shell/)).toBeInTheDocument();
  });

  it("says nothing when every device is alive", async () => {
    deploy.mockResolvedValue({
      ...halfDead,
      devices: [{ name: "r1", state: "running" }, { name: "r2", state: "running" }],
      running: ["r1", "r2"],
      exited: [],
    });
    const user = await renderApp();
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Deploy" }));

    await waitFor(() => expect(screen.queryByText(/stopped:/)).toBeNull());
  });

  it("will not verify links when nothing is running", async () => {
    // Verification runs commands inside the containers, so it has nothing to
    // work with — and `deployed` is true here, which is what used to enable it.
    deploy.mockResolvedValue(allDead);
    const user = await renderApp();
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Deploy" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Verify links" })).toBeDisabled(),
    );
  });

  it("still offers to stop the lab, because the names are taken", async () => {
    deploy.mockResolvedValue(allDead);
    const user = await renderApp();
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Deploy" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Stop" })).toBeEnabled(),
    );
  });
});

describe("redeploying a running lab", () => {
  const running: StatusResponse = {
    devices: [{ name: "r1", state: "running" }],
    running: ["r1"],
    exited: [],
    drift: [],
    deployed: true,
    lab_dir: "/labs/untitled",
    message: null,
    needs_confirmation: false,
    conflicts: null,
  };

  it("names the button for what it will do", async () => {
    const user = await renderApp();
    await addRouter(user);
    expect(await screen.findByRole("button", { name: "Deploy" })).toBeInTheDocument();

    deploy.mockResolvedValue(running);
    await user.click(screen.getByRole("button", { name: "Deploy" }));

    // Pressing it again replaces the lab, so it should not still say "Deploy".
    expect(await screen.findByRole("button", { name: "Redeploy" })).toBeInTheDocument();
  });

  it("warns that a redeploy loses in-container changes", async () => {
    deploy.mockResolvedValue(running);
    const user = await renderApp();
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Deploy" }));

    expect(await screen.findByText(/Redeploying replaces the running lab/)).toBeInTheDocument();
  });

  it("stays usable after a redeploy", async () => {
    deploy.mockResolvedValue(running);
    const user = await renderApp();
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Deploy" }));
    await user.click(await screen.findByRole("button", { name: "Redeploy" }));

    expect(deploy).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Redeploy" })).toBeEnabled();
  });

  it("reports a deploy failure as a message rather than breaking", async () => {
    // The backend now returns 200 with a reason instead of raising.
    deploy.mockResolvedValue({
      devices: [],
      running: [],
      exited: [],
      drift: [],
      deployed: false,
      lab_dir: null,
      message: "Could not deploy: image not found",
      needs_confirmation: false,
      conflicts: null,
    });
    const user = await renderApp();
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Deploy" }));

    expect(await screen.findByText(/Could not deploy: image not found/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deploy" })).toBeEnabled();
  });
})

describe("confirming before stopping a running lab", () => {
  const conflicted = (expected: string[], unexpected: string[]): StatusResponse => ({
    devices: [],
    running: [],
    exited: [],
    drift: [],
    deployed: false,
    lab_dir: "/labs/untitled",
    message: null,
    needs_confirmation: true,
    conflicts: { lab_name: "untitled", expected, unexpected },
  });

  const deployed: StatusResponse = {
    devices: [{ name: "r1", state: "running" }],
    running: ["r1"],
    exited: [],
    drift: [],
    deployed: true,
    lab_dir: "/labs/untitled",
    message: "Stopped 1 device already running.",
    needs_confirmation: false,
    conflicts: null,
  };

  it("asks instead of deploying when something is already running", async () => {
    deploy.mockResolvedValue(conflicted(["r1"], []));
    const user = await renderApp();
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Deploy" }));

    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText(/already running/i)).toBeInTheDocument();
  });

  it("does not send confirm on the first attempt", async () => {
    deploy.mockResolvedValue(conflicted(["r1"], []));
    const user = await renderApp();
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Deploy" }));

    expect(deploy).toHaveBeenLastCalledWith(expect.anything(), false);
  });

  it("warns hard when another lab is using the name", async () => {
    // Kathará keys a lab by its name, so this would stop somebody else's lab.
    deploy.mockResolvedValue(conflicted([], ["alpha", "beta"]));
    const user = await renderApp();
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Deploy" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/another lab is probably using it/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Renaming this lab avoids the clash/)).toBeInTheDocument();
  });

  it("deploys with confirm once the user agrees", async () => {
    deploy.mockResolvedValue(conflicted(["r1"], []));
    const user = await renderApp();
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Deploy" }));

    deploy.mockResolvedValue(deployed);
    await user.click(
      await screen.findByRole("button", { name: "Stop them and deploy" }),
    );

    expect(deploy).toHaveBeenLastCalledWith(expect.anything(), true);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("cancelling changes nothing and says so", async () => {
    deploy.mockResolvedValue(conflicted(["r1"], []));
    const user = await renderApp();
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Deploy" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    // One call only: the cancel must not have deployed anything.
    expect(deploy).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Nothing was changed/)).toBeInTheDocument();
  });

  it("has no axe violations while asking", async () => {
    deploy.mockResolvedValue(conflicted(["r1"], ["alpha"]));
    const user = await renderApp();
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Deploy" }));
    await screen.findByRole("alertdialog");

    const results = await axeCore.run(document.body);
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
})

describe("deleting a link", () => {
  async function twoLinkedRouters(user: ReturnType<typeof userEvent.setup>) {
    await addRouter(user);
    await addRouter(user);
    await link(user, "r1", "r2");
  }

  it("removes both ends from the keyboard, via the interface row", async () => {
    // The canvas route needs a click; this is how it is done without one.
    const user = await renderApp();
    await twoLinkedRouters(user);

    await user.click(row("r1"));
    await user.keyboard("{ArrowRight}{ArrowDown}"); // expand, move to eth0
    await user.keyboard("{Delete}");

    expect(screen.getByRole("treeitem", { name: /r1, router, 0 interfaces/ })).toBeInTheDocument();
  });

  it("keeps deleting a device working from a device row", async () => {
    const user = await renderApp();
    await twoLinkedRouters(user);

    await user.click(row("r1"));
    await user.keyboard("{Delete}");

    expect(screen.queryByRole("treeitem", { name: /^r1/ })).toBeNull();
  });

  it("undoes a disconnection", async () => {
    const user = await renderApp();
    await twoLinkedRouters(user);

    await user.click(row("r1"));
    await user.keyboard("{ArrowRight}{ArrowDown}{Delete}");
    await user.click(screen.getByRole("button", { name: "Undo" }));

    expect(screen.getByRole("treeitem", { name: /r1, router, 1 interface/ })).toBeInTheDocument();
  });

  it("offers nothing to delete until something is selected", async () => {
    await renderApp();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  });

  it("enables delete for the device just added", async () => {
    // Adding a device selects it, so it is immediately deletable.
    const user = await renderApp();
    await addRouter(user);
    expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled();
  });
})

describe("deleting several links in a row", () => {
  /** Build the triangle: r1-r2 on A, r2-r3 on B, r1-r3 on C. */
  async function triangle(user: ReturnType<typeof userEvent.setup>) {
    await addRouter(user);
    await addRouter(user);
    await addRouter(user);
    await link(user, "r1", "r2");
    await link(user, "r2", "r3");
    await link(user, "r1", "r3");
  }

  const interfaceCount = (device: string) => {
    const item = screen.getByRole("treeitem", { name: new RegExp(`^${device}`) });
    return /(\d+) interface/.exec(item.textContent ?? "")?.[1];
  };

  /**
   * Disconnect a device's first interface through the tree.
   *
   * Expands only when collapsed and clicks the interface row directly: a
   * fixed ArrowRight/ArrowDown sequence walks onto the *next device* once the
   * tree is already open, and deletes that instead.
   */
  async function disconnectFirst(
    user: ReturnType<typeof userEvent.setup>,
    device: string,
  ) {
    await user.click(row(device));
    if (row(device).getAttribute("aria-expanded") === "false") {
      await user.keyboard("{ArrowRight}");
    }

    // Interface rows are aria-level 2 and follow their device. Matching on
    // text is unreliable — the row begins with a tree glyph, not "eth".
    const rows = screen.getAllByRole("treeitem");
    const start = rows.indexOf(row(device));
    const iface = rows.slice(start + 1).find((el) => el.getAttribute("aria-level") === "2");
    if (!iface) throw new Error(`${device} has no interface row to delete`);

    await user.click(iface);
    await user.keyboard("{Delete}");
  }

  it("keeps working after the first link is removed", async () => {
    // The reported defect: one link could be deleted, then no more.
    const user = await renderApp();
    await triangle(user);
    expect(interfaceCount("r1")).toBe("2");

    // Remove r1's first link, then its second.
    await disconnectFirst(user, "r1");
    expect(interfaceCount("r1")).toBe("1");

    await disconnectFirst(user, "r1");
    expect(interfaceCount("r1")).toBe("0");
  });

  it("detaches only the end that was disconnected", async () => {
    // Disconnecting is not the same as deleting the link: the far end stays
    // attached to a domain nothing else is on. That asymmetry is the reason
    // removeLink exists, and clicking a link on the canvas uses it.
    const user = await renderApp();
    await triangle(user);

    await disconnectFirst(user, "r1");
    await disconnectFirst(user, "r1");

    expect(interfaceCount("r1")).toBe("0");
    // r2 and r3 each keep the far end of a link r1 has left.
    expect(interfaceCount("r2")).toBe("2");
    expect(interfaceCount("r3")).toBe("2");
  });

  it("undoes each removal separately", async () => {
    const user = await renderApp();
    await triangle(user);

    await disconnectFirst(user, "r1");
    await disconnectFirst(user, "r1");
    expect(interfaceCount("r1")).toBe("0");

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(interfaceCount("r1")).toBe("1");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(interfaceCount("r1")).toBe("2");
  });
})

describe("device images", () => {
  it("gives a new router an image that actually carries FRR", async () => {
    // Kathará's own default is kathara/base, which has no routing daemons at
    // all: no vtysh, nothing for the generated /etc/frr/daemons to configure,
    // and no way to run a routing lab.
    const user = await renderApp();
    await user.click(screen.getByRole("button", { name: /Add router/ }));
    await user.click(screen.getByRole("treeitem", { name: /^r1/ }));

    expect(screen.getByLabelText("Container image")).toHaveValue("kathara/frr");
  });

  it("gives a PC the base image", async () => {
    const user = await renderApp();
    await user.click(screen.getByRole("button", { name: /Add pc/ }));
    await user.click(screen.getByRole("treeitem", { name: /^pc1/ }));

    expect(screen.getByLabelText("Container image")).toHaveValue("kathara/base");
  });

  it("follows the image when the kind is changed", async () => {
    const user = await renderApp();
    await user.click(screen.getByRole("button", { name: /Add pc/ }));
    await user.click(screen.getByRole("treeitem", { name: /^pc1/ }));

    await user.selectOptions(screen.getByLabelText("Kind"), "router");
    expect(screen.getByLabelText("Container image")).toHaveValue("kathara/frr");
  });

  it("never overwrites an image the user chose", async () => {
    const user = await renderApp();
    await user.click(screen.getByRole("button", { name: /Add router/ }));
    await user.click(screen.getByRole("treeitem", { name: /^r1/ }));

    const image = screen.getByLabelText("Container image");
    await user.clear(image);
    await user.type(image, "my/custom:1{Enter}");

    await user.selectOptions(screen.getByLabelText("Kind"), "pc");
    expect(screen.getByLabelText("Container image")).toHaveValue("my/custom:1");
  });
})

describe("a deployed lab locks the design", () => {
  // D9. Two sources of truth that can both change drift in both directions at
  // once. While the lab runs, only the containers may move on: capture brings
  // their state onto the canvas, and stopping asks whether to keep it.

  const running: StatusResponse = {
    devices: [{ name: "r1", state: "running" }],
    running: ["r1"],
    exited: [],
    drift: [],
    deployed: true,
    lab_dir: "/workspace/untitled",
    message: null,
    needs_confirmation: false,
    conflicts: null,
  };

  const captured = (ip: string): CaptureResponse => ({
    captured: [{ device: "r1", path: "r1/etc/frr/frr.conf", lines: 7 }],
    skipped: [],
    message: null,
    folder: "/workspace/untitled",
    topology: {
      name: "untitled",
      nodes: [
        {
          name: "r1",
          kind: "router",
          image: "kathara/frr",
          memory: null,
          position: { x: 0, y: 0 },
          daemons: [],
          interfaces: [{ number: 0, collision_domain: "A", ip }],
          extra_options: {},
        },
      ],
      collision_domains: [],
    } as unknown as Topology,
  });

  beforeEach(() => {
    captureState.mockReset().mockImplementation(async (topology: Topology) => ({
      captured: [],
      skipped: [],
      message: null,
      folder: "/workspace/untitled",
      topology,
    }));
    vi.mocked(api.labStatus).mockReset().mockResolvedValue(running);
  });

  async function deployed() {
    deploy.mockResolvedValue(running);
    const user = await renderApp();
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Deploy" }));
    await screen.findByText("Lab running — design is read-only");
    return user;
  }

  it("says so in the header, in words", async () => {
    await deployed();
    expect(screen.getAllByText(/the design is read-only/i).length).toBeGreaterThan(0);
  });

  it("withdraws every editing control", async () => {
    await deployed();
    expect(screen.getByRole("button", { name: /Add router/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Open/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Import/ })).toBeDisabled();
  });

  it("still lets a device be selected and its settings read", async () => {
    // Locked is not hidden: the point of the running design is to look at it.
    const user = await deployed();
    await user.click(row("r1"));
    expect(screen.getByLabelText("Name")).toHaveValue("r1");
    expect(screen.getByLabelText("Name")).toBeDisabled();
  });

  it("refuses the undo shortcut and says why", async () => {
    const user = await deployed();
    await user.keyboard("{Control>}z{/Control}");
    expect(useTopologyStore.getState().topology.nodes).toHaveLength(1);
    // Announced, not only written on the page: a keyboard user pressing
    // Ctrl+Z needs to hear why nothing happened.
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/Stop the lab to edit it/),
    );
  });

  it("refuses an edit however it arrives", async () => {
    // The guard sits on the path every edit takes, not on each control, so a
    // shortcut or a control added later cannot slip past it.
    const user = await deployed();
    await user.click(row("r1"));
    await user.keyboard("{Delete}");
    expect(useTopologyStore.getState().topology.nodes).toHaveLength(1);
  });

  it("asks before stopping whether to keep what changed inside the containers", async () => {
    const user = await deployed();
    await user.click(screen.getByRole("button", { name: "Stop" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("button", { name: "Capture, then stop" })).toBeEnabled();
    expect(
      within(dialog).getByRole("button", { name: "Stop and discard container changes" }),
    ).toBeEnabled();
    // Asking changes nothing.
    expect(undeploy).not.toHaveBeenCalled();
  });

  it("discarding stops without capturing, and unlocks the design", async () => {
    const user = await deployed();
    await user.click(screen.getByRole("button", { name: "Stop" }));
    await user.click(
      await screen.findByRole("button", { name: "Stop and discard container changes" }),
    );

    await waitFor(() => expect(undeploy).toHaveBeenCalledTimes(1));
    expect(captureState).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Add router/ })).toBeEnabled(),
    );
  });

  it("keeping captures first, then stops the lab it captured", async () => {
    captureState.mockResolvedValue(captured("10.9.9.9/24"));
    const user = await deployed();
    await user.click(screen.getByRole("button", { name: "Stop" }));
    await user.click(await screen.findByRole("button", { name: "Capture, then stop" }));

    await waitFor(() => expect(undeploy).toHaveBeenCalledTimes(1));
    expect(captureState).toHaveBeenCalledTimes(1);
    // The stop is sent the captured design, not the one from before it.
    expect(undeploy.mock.calls[0]?.[0].nodes[0]?.interfaces[0]?.ip).toBe("10.9.9.9/24");
    // And the canvas shows what the containers were running.
    expect(useTopologyStore.getState().topology.nodes[0]?.interfaces[0]?.ip).toBe(
      "10.9.9.9/24",
    );
  });

  it("a failed capture stops nothing, so nothing is lost", async () => {
    captureState.mockRejectedValue(new MockApiError("Docker went away", 500));
    const user = await deployed();
    await user.click(screen.getByRole("button", { name: "Stop" }));
    await user.click(await screen.findByRole("button", { name: "Capture, then stop" }));

    // Shown on screen and announced as an alert. It used to reach only the
    // hidden live region, where a sighted user never saw it (step 0.8).
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/Docker went away/),
    );
    expect(document.querySelector(".app__error")).toHaveTextContent(/Docker went away/);
    expect(undeploy).not.toHaveBeenCalled();
  });

  it("changing your mind keeps the lab running", async () => {
    const user = await deployed();
    await user.click(screen.getByRole("button", { name: "Stop" }));
    await user.click(await screen.findByRole("button", { name: "Keep running" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(undeploy).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Add router/ })).toBeDisabled();
  });

  it("does not ask when nothing is running to capture from", async () => {
    // Exited containers hold their names but answer nothing, so there is no
    // choice to offer: they can only be cleared.
    deploy.mockResolvedValue({
      ...running,
      running: [],
      exited: ["r1"],
      devices: [{ name: "r1", state: "exited" }],
    });
    const user = await renderApp();
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Deploy" }));
    await user.click(await screen.findByRole("button", { name: "Stop" }));

    await waitFor(() => expect(undeploy).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("looks inside the containers only when asked", async () => {
    // No timer: an idle editor must not load the host running the lab.
    const user = await deployed();
    vi.mocked(api.labStatus).mockClear();
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(api.labStatus).not.toHaveBeenCalled();

    vi.mocked(api.labStatus).mockResolvedValue({
      ...running,
      drift: ["r1 eth0 is 10.0.0.1/24 on the canvas but 10.0.0.9/24 in the running lab"],
    });
    await user.click(screen.getByRole("button", { name: "Check for changes" }));

    expect(await screen.findByText(/Found 1 change inside the containers/)).toBeInTheDocument();
    expect(screen.getByText(/differs from the canvas in 1 place/)).toBeInTheDocument();
  });

  it("a capture clears the differences it has just adopted", async () => {
    // Bug 20: capturing reported itself as a mismatch.
    const user = await deployed();
    vi.mocked(api.labStatus).mockResolvedValue({
      ...running,
      drift: ["r1 eth0 is 10.0.0.1/24 on the canvas but 10.0.0.9/24 in the running lab"],
    });
    await user.click(screen.getByRole("button", { name: "Check for changes" }));
    await screen.findByText(/differs from the canvas in 1 place/);

    await user.click(screen.getByRole("button", { name: "Capture running state" }));

    await waitFor(() => expect(screen.queryByText(/differs from the canvas/)).toBeNull());
    expect(screen.getByText("Lab running — design is read-only")).toBeInTheDocument();
  });

  it("comes back locked when the page is reloaded while the lab runs", async () => {
    // The containers outlive the tab.
    vi.mocked(api.read).mockResolvedValueOnce({
      topology: captured("10.0.0.1/24").topology,
      dirty: false,
      path: null,
    } as never);
    render(<App />);

    expect(await screen.findByText("Lab running — design is read-only")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add router/ })).toBeDisabled();
  });

  it("announces edits again once the lab is stopped", async () => {
    // A standing notice ("Lab stopped…") used to mask every edit's own
    // description, so a screen reader user stopped hearing what they did.
    const user = await deployed();
    await user.click(screen.getByRole("button", { name: "Stop" }));
    await user.click(
      await screen.findByRole("button", { name: "Stop and discard container changes" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Add router/ })).toBeEnabled(),
    );

    await addRouter(user);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/Added router r2/),
    );
  });

  it("passes the accessibility audit while locked", async () => {
    await deployed();
    const results = await axeCore.run(document.body);
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});

describe("stopping every lab at once", () => {
  // Requested in the first Windows run (test step 0.6): labs outlive the
  // application, and there was no way to clear them all without Kathará's
  // command-line tool. `kathara wipe`, capturing nothing — but asked first,
  // because UX-07 says a destructive action states what it will do.

  const running: StatusResponse = {
    devices: [{ name: "r1", state: "running" }],
    running: ["r1"],
    exited: [],
    drift: [],
    deployed: true,
    lab_dir: "/workspace/untitled",
    message: null,
    needs_confirmation: false,
    conflicts: null,
  };
  const idle: StatusResponse = { ...running, devices: [], running: [], deployed: false };

  beforeEach(() => {
    vi.mocked(api.labStatus).mockReset().mockResolvedValue(idle);
  });

  it("has nothing to stop when nothing is deployed", async () => {
    await renderApp();
    expect(
      await screen.findByText(/No Kathará labs are deployed on this computer/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop every lab" })).toBeDisabled();
  });

  it("counts labs not opened here, and is available while the design is locked", async () => {
    labEverything.mockResolvedValue({ devices: 5, labs: 2, message: null });
    deploy.mockResolvedValue(running);
    const user = await renderApp();
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Deploy" }));
    await screen.findByText("Lab running — design is read-only");

    expect(await screen.findByText(/5 devices in 2 labs deployed/)).toBeInTheDocument();
    // A lab action, not an edit: the lock does not reach it.
    expect(screen.getByRole("button", { name: "Stop every lab" })).toBeEnabled();
  });

  it("says what will stop before stopping anything", async () => {
    labEverything.mockResolvedValue({ devices: 5, labs: 2, message: null });
    const user = await renderApp();
    await user.click(await screen.findByRole("button", { name: "Stop every lab" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/5 devices in 2 labs/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Nothing is captured/)).toBeInTheDocument();
    // No capture or save option, as requested.
    expect(within(dialog).queryByRole("button", { name: /capture/i })).toBeNull();
    expect(wipeLabs).not.toHaveBeenCalled();
  });

  it("cancelling stops nothing", async () => {
    labEverything.mockResolvedValue({ devices: 5, labs: 2, message: null });
    const user = await renderApp();
    await user.click(await screen.findByRole("button", { name: "Stop every lab" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(wipeLabs).not.toHaveBeenCalled();
  });

  it("stops everything and unlocks the design", async () => {
    labEverything.mockResolvedValue({ devices: 5, labs: 2, message: null });
    deploy.mockResolvedValue(running);
    const user = await renderApp();
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Deploy" }));
    await screen.findByText("Lab running — design is read-only");

    await user.click(screen.getByRole("button", { name: "Stop every lab" }));
    await user.click(await screen.findByRole("button", { name: "Stop everything" }));

    await waitFor(() => expect(wipeLabs).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Add router/ })).toBeEnabled(),
    );
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/Stopped every lab: 5 devices/),
    );
    expect(screen.getByText(/No Kathará labs are deployed/)).toBeInTheDocument();
  });

  it("a failed wipe says why and leaves the lock alone", async () => {
    labEverything.mockResolvedValue({ devices: 3, labs: 1, message: null });
    wipeLabs.mockResolvedValue({
      devices: 3,
      labs: 1,
      message: "Could not stop every lab: Docker went away",
    });
    deploy.mockResolvedValue(running);
    const user = await renderApp();
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Deploy" }));
    await screen.findByText("Lab running — design is read-only");

    await user.click(screen.getByRole("button", { name: "Stop every lab" }));
    await user.click(await screen.findByRole("button", { name: "Stop everything" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/Docker went away/),
    );
    expect(document.querySelector(".app__error")).toHaveTextContent(/Docker went away/);
    expect(screen.getByRole("button", { name: /Add router/ })).toBeDisabled();
  });

  it("passes the accessibility audit with the question open", async () => {
    labEverything.mockResolvedValue({ devices: 2, labs: 1, message: null });
    const user = await renderApp();
    await user.click(await screen.findByRole("button", { name: "Stop every lab" }));
    await screen.findByRole("alertdialog");

    const results = await axeCore.run(document.body);
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});

describe("a failed request is shown, not only announced", () => {
  // Found in the Windows test run, step 0.8: every Save failed on the server,
  // and the interface showed nothing but "Not saved yet". Failures went only
  // to the visually hidden live region.

  it("shows why a save failed, on screen", async () => {
    saveProject.mockRejectedValueOnce(
      new MockApiError(
        "The operating system refused: The filename is invalid. Path: C:\Temp\kgui test\n",
        500,
      ),
    );
    const user = await renderApp();
    await addRouter(user);
    await user.click(screen.getAllByRole("button", { name: "Save" })[0]!);

    await waitFor(() =>
      expect(document.querySelector(".app__error")).toHaveTextContent(
        /The operating system refused/,
      ),
    );
    // Announced as an alert as well, for a screen-reader user.
    expect(screen.getByRole("alert")).toHaveTextContent(/The operating system refused/);
    // And the message can be dismissed.
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(document.querySelector(".app__error")).toBeNull();
  });
});
