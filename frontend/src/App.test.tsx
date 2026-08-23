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
import { useTopologyStore } from "./store/topology";
import { emptyTopology } from "./types";

vi.mock("./canvas/TopologyCanvas", () => ({
  TopologyCanvas: () => <div data-testid="canvas" aria-hidden="true" />,
}));

vi.mock("./api/client", () => ({
  ApiError: class ApiError extends Error {},
  api: {
    read: vi.fn(async () => ({ topology: emptyTopology(), dirty: false, path: null })),
    save: vi.fn(async () => ({ topology: emptyTopology(), dirty: false, path: null })),
  },
  initialiseToken: vi.fn(),
}));

beforeEach(() => {
  // The store is a module singleton; without this, tests leak into each other.
  useTopologyStore.getState().load(emptyTopology());
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

  it("connects two devices through the form", async () => {
    const user = await renderApp();
    await addRouter(user);
    await addRouter(user);

    await user.selectOptions(screen.getByLabelText("Device"), "r1");
    await user.selectOptions(screen.getByLabelText("Connect to"), "device:r2");
    await user.click(screen.getByRole("button", { name: "Connect" }));

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
    await user.selectOptions(screen.getByLabelText("Device"), "r1");
    await user.selectOptions(screen.getByLabelText("Connect to"), "device:r2");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    await user.click(screen.getByRole("button", { name: "Undo" }));

    expect(screen.getByRole("treeitem", { name: /r1, router, 0 interfaces/ })).toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: /r2, router, 0 interfaces/ })).toBeInTheDocument();
  });

  it("disables undo when there is nothing to undo", async () => {
    await renderApp();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
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
    await user.selectOptions(screen.getByLabelText("Device"), "r1");
    await user.selectOptions(screen.getByLabelText("Connect to"), "device:r2");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    await user.click(screen.getByRole("treeitem", { name: /^r1/ }));

    const results = await axeCore.run(document.body);
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});
