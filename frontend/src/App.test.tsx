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
// Type-only, so it is erased at runtime and does not clash with vi.mock.
import type {
  AllocateResponse,
  DiagnosticsResponse,
  FeaturesResponse,
  IssuesResponse,
  ProbeResponse,
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
const { MockApiError, checkAddressing, allocateAddressing, probe, features, deploy, undeploy, verify } =
  vi.hoisted(() => {
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
    deployed: false,
    lab_dir: null,
    message: null,
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
      deployed: false,
      lab_dir: null,
      message: null,
    })),
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
    deployed: false,
    lab_dir: null,
    message: null,
  };
  probe.mockReset().mockResolvedValue({ checks: [], can_deploy: true });
  features.mockReset().mockResolvedValue({
    subnet_calculator: true,
    addressing_validation: true,
    infrastructure_verification: true,
  });
  deploy.mockReset().mockResolvedValue(idleStatus);
  undeploy.mockReset().mockResolvedValue(idleStatus);
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
    deployed: true,
    lab_dir: "/tmp/lab",
    message: null,
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
    devices: [{ name: "r1", state: "running" }],
    running: ["r1"],
    deployed: true,
    lab_dir: dir,
    message: null,
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

  it("gives a connect command that cds first", async () => {
    // Without the cd, kathara connect fails with MachineNotRunningError even
    // though the container is running: Kathará keys a lab by its directory.
    deploy.mockResolvedValue(deployedAt("/labs/untitled"));
    const user = await renderApp();
    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Deploy" }));

    expect(
      await screen.findByText("cd /labs/untitled && kathara connect r1"),
    ).toBeInTheDocument();
  });

  it("copies the command and confirms in the live region", async () => {
    deploy.mockResolvedValue(deployedAt("/labs/untitled"));
    const user = await renderApp();

    const writeText = vi.fn(async () => undefined);
    stubClipboard(writeText);

    await addRouter(user);
    await user.click(await screen.findByRole("button", { name: "Deploy" }));
    await user.click(await screen.findByRole("button", { name: "Copy command" }));

    expect(writeText).toHaveBeenCalledWith("cd /labs/untitled && kathara connect r1");
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
