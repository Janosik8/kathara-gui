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
import type { AllocateResponse, IssuesResponse } from "./api/client";
import type { Topology } from "./types";
import { useTopologyStore } from "./store/topology";
import { emptyTopology } from "./types";

vi.mock("./canvas/TopologyCanvas", () => ({
  TopologyCanvas: () => <div data-testid="canvas" aria-hidden="true" />,
}));

// vi.mock is hoisted above the file, so anything it closes over must be
// created by vi.hoisted rather than declared as an ordinary const.
const { MockApiError, checkAddressing, allocateAddressing } = vi.hoisted(() => {
  class MockApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  const blank = () => ({ name: "untitled", nodes: [], collision_domains: [] });
  return {
    MockApiError,
    checkAddressing: vi.fn(
      // The parameter is declared so tests can inspect what the editor sent.
      async (_topology: Topology): Promise<IssuesResponse> => ({
        issues: [],
        errors: 0,
        warnings: 0,
      }),
    ),
    allocateAddressing: vi.fn(
      async (): Promise<AllocateResponse> => ({
        topology: blank(),
        assigned_subnets: {},
        assigned_addresses: {},
        skipped: [],
        changed: false,
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
  },
  initialiseToken: vi.fn(),
}));

beforeEach(() => {
  // The store is a module singleton; without this, tests leak into each other.
  useTopologyStore.getState().load(emptyTopology());
  checkAddressing.mockClear();
  checkAddressing.mockResolvedValue({ issues: [], errors: 0, warnings: 0 });
  allocateAddressing.mockClear();
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
    expect(allocateAddressing).toHaveBeenCalledWith({ overwrite: true });

    await user.click(screen.getByRole("button", { name: "Assign addresses" }));
    expect(allocateAddressing).toHaveBeenLastCalledWith({ overwrite: false });
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
