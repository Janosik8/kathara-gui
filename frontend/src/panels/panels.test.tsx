import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axeCore from "axe-core";
import { describe, expect, it, vi } from "vitest";
import { type Topology, newNode } from "../types";
import { ConnectForm, suggestCollisionDomain } from "./ConnectForm";
import { Inspector } from "./Inspector";
import { Palette, suggestName } from "./Palette";

function twoRouters(): Topology {
  return {
    name: "lab",
    nodes: [newNode("r1", "router", { x: 0, y: 0 }), newNode("r2", "router", { x: 100, y: 0 })],
    collision_domains: [],
  };
}

function linked(): Topology {
  const topology = twoRouters();
  topology.nodes[0]!.interfaces = [{ number: 0, collision_domain: "A", ip: "10.0.0.1/24" }];
  topology.nodes[1]!.interfaces = [{ number: 0, collision_domain: "A" }];
  topology.collision_domains = [{ name: "A" }];
  return topology;
}

describe("suggestName", () => {
  it("uses a conventional prefix per kind", () => {
    const empty: Topology = { name: "l", nodes: [], collision_domains: [] };
    expect(suggestName(empty, "router")).toBe("r1");
    expect(suggestName(empty, "switch")).toBe("sw1");
    expect(suggestName(empty, "pc")).toBe("pc1");
    expect(suggestName(empty, "server")).toBe("srv1");
  });

  it("skips names already taken", () => {
    expect(suggestName(twoRouters(), "router")).toBe("r3");
  });

  it("compares case-insensitively", () => {
    const topology = twoRouters();
    topology.nodes[0]!.name = "R1";
    expect(suggestName(topology, "router")).toBe("r3");
  });
});

describe("suggestCollisionDomain", () => {
  it("starts at A", () => {
    expect(suggestCollisionDomain(twoRouters())).toBe("A");
  });

  it("skips domains in use", () => {
    const topology = twoRouters();
    topology.collision_domains = [{ name: "A" }, { name: "B" }];
    expect(suggestCollisionDomain(topology)).toBe("C");
  });

  it("continues past Z", () => {
    const topology = twoRouters();
    topology.collision_domains = Array.from({ length: 26 }, (_, i) => ({
      name: String.fromCharCode(65 + i),
    }));
    expect(suggestCollisionDomain(topology)).toBe("AA");
  });
});

describe("Palette", () => {
  it("names the device each button will create", () => {
    render(<Palette topology={twoRouters()} onAdd={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Add router \(r3\)/ })).toBeInTheDocument();
  });

  it("reports the chosen kind", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<Palette topology={twoRouters()} onAdd={onAdd} />);
    await user.click(screen.getByRole("button", { name: /Add pc/ }));
    expect(onAdd).toHaveBeenCalledWith("pc");
  });
});

describe("ConnectForm", () => {
  it("creates a link between two devices", async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn();
    render(<ConnectForm topology={twoRouters()} onConnect={onConnect} />);

    await user.selectOptions(screen.getByLabelText("Device"), "r1");
    await user.selectOptions(screen.getByLabelText("Connect to"), "device:r2");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    expect(onConnect).toHaveBeenCalledWith({
      type: "link",
      a: "r1",
      b: "r2",
      collisionDomain: "A",
    });
  });

  it("joins an existing collision domain when one is chosen", async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn();
    const topology = linked();
    topology.nodes.push(newNode("r3", "router", { x: 200, y: 0 }));
    render(<ConnectForm topology={topology} onConnect={onConnect} />);

    await user.selectOptions(screen.getByLabelText("Device"), "r3");
    await user.selectOptions(screen.getByLabelText("Connect to"), "domain:A");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    expect(onConnect).toHaveBeenCalledWith({
      type: "connect",
      node: "r3",
      collisionDomain: "A",
    });
  });

  it("never offers a device as its own destination", async () => {
    const user = userEvent.setup();
    render(<ConnectForm topology={twoRouters()} onConnect={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText("Device"), "r1");

    const target = screen.getByLabelText("Connect to") as HTMLSelectElement;
    const values = [...target.options].map((o) => o.value);
    expect(values).not.toContain("device:r1");
    expect(values).toContain("device:r2");
  });

  it("states the outcome before the button is pressed", async () => {
    const user = userEvent.setup();
    render(<ConnectForm topology={twoRouters()} onConnect={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText("Device"), "r1");
    await user.selectOptions(screen.getByLabelText("Connect to"), "device:r2");

    expect(
      screen.getByText(/A new collision domain A will link r1 and r2/),
    ).toBeInTheDocument();
  });

  it("cannot be submitted until both ends are chosen", () => {
    render(<ConnectForm topology={twoRouters()} onConnect={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled();
  });

  it("renders nothing when there are no devices", () => {
    const { container } = render(
      <ConnectForm
        topology={{ name: "l", nodes: [], collision_domains: [] }}
        onConnect={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("has no axe violations", async () => {
    const { container } = render(<ConnectForm topology={linked()} onConnect={vi.fn()} />);
    const results = await axeCore.run(container);
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});

describe("Inspector", () => {
  it("invites a selection when nothing is selected", () => {
    render(<Inspector topology={linked()} selected={[]} onDispatch={vi.fn()} />);
    expect(screen.getByText(/Select a device/)).toBeInTheDocument();
  });

  it("commits a rename on blur rather than per keystroke", async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn();
    render(<Inspector topology={linked()} selected={["r1"]} onDispatch={onDispatch} />);

    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "core1");
    // Still nothing: a dispatch per character would ruin undo.
    expect(onDispatch).not.toHaveBeenCalled();

    await user.tab();
    expect(onDispatch).toHaveBeenCalledExactlyOnceWith({
      type: "renameNode",
      from: "r1",
      to: "core1",
    });
  });

  it("commits on Enter", async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn();
    render(<Inspector topology={linked()} selected={["r1"]} onDispatch={onDispatch} />);

    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "core1{Enter}");
    expect(onDispatch).toHaveBeenCalledWith({ type: "renameNode", from: "r1", to: "core1" });
  });

  it("abandons an edit on Escape", async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn();
    render(<Inspector topology={linked()} selected={["r1"]} onDispatch={onDispatch} />);

    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "oops{Escape}");
    await user.tab();
    expect(onDispatch).not.toHaveBeenCalled();
  });

  it("enables zebra alongside any protocol daemon", async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn();
    const topology = linked();
    topology.nodes[0]!.daemons = [];
    render(<Inspector topology={topology} selected={["r1"]} onDispatch={onDispatch} />);

    await user.click(screen.getByRole("checkbox", { name: "ospfd" }));

    // A protocol daemon without zebra yields a router that silently does nothing.
    const [op] = onDispatch.mock.calls[0]!;
    expect(op.changes.daemons).toContain("ospfd");
    expect(op.changes.daemons).toContain("zebra");
  });

  it("lists interfaces with their collision domain", () => {
    render(<Inspector topology={linked()} selected={["r1"]} onDispatch={vi.fn()} />);
    expect(screen.getByText("eth0 on A")).toBeInTheDocument();
  });

  it("sets an interface address", async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn();
    const topology = linked();
    topology.nodes[0]!.interfaces[0]!.ip = null;
    render(<Inspector topology={topology} selected={["r1"]} onDispatch={onDispatch} />);

    await user.type(screen.getByLabelText("Address for eth0"), "10.0.0.9/24");
    await user.tab();

    expect(onDispatch).toHaveBeenCalledWith({
      type: "updateInterface",
      node: "r1",
      number: 0,
      changes: { ip: "10.0.0.9/24" },
    });
  });

  it("explains how to connect an unconnected device", () => {
    render(<Inspector topology={twoRouters()} selected={["r1"]} onDispatch={vi.fn()} />);
    expect(screen.getByText(/Use the Connect panel/)).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <Inspector topology={linked()} selected={["r1"]} onDispatch={vi.fn()} />,
    );
    const results = await axeCore.run(container);
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});
