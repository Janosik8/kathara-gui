import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axeCore from "axe-core";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Operation } from "../store/operations";
import { type Topology, newNode, suggestCollisionDomain } from "../types";
import { Inspector, validateLoopback } from "./Inspector";
import { CollisionDomainsPanel, validateSubnet } from "./CollisionDomainsPanel";
import { DEVICE_DRAG_TYPE, Palette, suggestName } from "./Palette";
import { ExplainContext } from "./Explain";

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

  it("lets each button be dragged, carrying its kind (FR-48)", () => {
    render(<Palette topology={twoRouters()} onAdd={vi.fn()} />);
    const button = screen.getByRole("button", { name: /Add server/ });
    expect(button).toHaveAttribute("draggable", "true");
    const setData = vi.fn();
    fireEvent.dragStart(button, { dataTransfer: { setData, effectAllowed: "" } });
    expect(setData).toHaveBeenCalledWith(DEVICE_DRAG_TYPE, "server");
  });

  it("cannot be dragged while disabled", () => {
    render(<Palette topology={twoRouters()} onAdd={vi.fn()} disabled />);
    expect(screen.getByRole("button", { name: /Add server/ })).toHaveAttribute("draggable", "false");
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

    await user.click(screen.getByRole("checkbox", { name: "ospfd OSPFv2" }));

    // A protocol daemon without zebra yields a router that silently does nothing.
    const [op] = onDispatch.mock.calls[0]!;
    expect(op.changes.daemons).toContain("ospfd");
    expect(op.changes.daemons).toContain("zebra");
  });

  it("offers every FRR daemon, saying what each is for", () => {
    // Bug 29: ldpd, and "all the daemons that can be set on FRR".
    render(<Inspector topology={linked()} selected={["r1"]} onDispatch={vi.fn()} />);
    expect(screen.getByRole("checkbox", { name: "ldpd MPLS LDP" })).toBeInTheDocument();
    // Twenty daemons, and the privileged switch.
    expect(screen.getAllByRole("checkbox")).toHaveLength(21);
  });

  it("applies one router's daemons to every router in one step", async () => {
    // Test step 3B.1: one button for the whole daemon setting, not per daemon.
    const user = userEvent.setup();
    const onDispatch = vi.fn();
    const topology = linked();
    topology.nodes[0]!.daemons = ["zebra", "ospfd"];
    render(<Inspector topology={topology} selected={["r1"]} onDispatch={onDispatch} />);

    await user.click(screen.getByRole("button", { name: "Apply to all routers" }));
    expect(onDispatch).toHaveBeenCalledExactlyOnceWith({ type: "applyDaemons", from: "r1" });
  });

  it("has nothing to apply when every router already matches", () => {
    const topology = linked();
    topology.nodes.forEach((n) => (n.daemons = ["zebra", "bgpd"]));
    render(<Inspector topology={topology} selected={["r1"]} onDispatch={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Apply to all routers" })).toBeDisabled();
  });

  it("sets privileged mode, and says what it needs", async () => {
    // Bug 31.
    const user = userEvent.setup();
    const onDispatch = vi.fn();
    // What it needs is an explanation, so it shows while ⓘ is on (note 4).
    render(
      <ExplainContext.Provider value={true}>
        <Inspector topology={linked()} selected={["r1"]} onDispatch={onDispatch} />
      </ExplainContext.Provider>,
    );
    const box = screen.getByRole("checkbox", { name: "Privileged" });
    expect(box).toHaveAccessibleDescription(/administrator .* or root/);
    await user.click(box);
    expect(onDispatch).toHaveBeenCalledWith({
      type: "updateNode",
      name: "r1",
      changes: { privileged: true },
    });
  });

  it("describes privileged mode only while explanations are on, never pointing at nothing", () => {
    render(<Inspector topology={linked()} selected={["r1"]} onDispatch={vi.fn()} />);
    const box = screen.getByRole("checkbox", { name: "Privileged" });
    expect(box).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByText(/administrator .* or root/)).toBeNull();
  });

  describe("loopback rows", () => {
    // Bug 28, and the rows asked for after it: + opens a field, − closes one,
    // and there is always at least one.

    /** The inspector over a topology that follows its own edits. */
    function Live({ loopbacks = [], spy }: { loopbacks?: string[]; spy: (op: Operation) => void }) {
      const [topology, setTopology] = useState(() => {
        const t = linked();
        t.nodes[0]!.loopbacks = loopbacks;
        return t;
      });
      const onDispatch = (op: Operation) => {
        spy(op);
        if (op.type === "updateNode") {
          setTopology((t) => ({
            ...t,
            nodes: t.nodes.map((n) => (n.name === op.name ? { ...n, ...op.changes } : n)),
          }));
        }
      };
      return <Inspector topology={topology} selected={["r1"]} onDispatch={onDispatch} />;
    }

    const field = (n: number) => screen.getByLabelText(`Loopback address ${n}`);
    const remove = (n: number) =>
      screen.getByRole("button", { name: `Remove loopback address ${n}` });
    const add = () => screen.getByRole("button", { name: "Add another loopback address" });
    const loopbacksSent = (spy: ReturnType<typeof vi.fn>) =>
      spy.mock.calls.map(([op]) => (op as { changes: { loopbacks: string[] } }).changes.loopbacks);

    it("shows one empty field when there is none, which cannot be removed", () => {
      render(<Live spy={vi.fn()} />);
      expect(screen.getAllByLabelText(/^Loopback address \d$/)).toHaveLength(1);
      expect(field(1)).toHaveValue("");
      expect(remove(1)).toBeDisabled();
    });

    it("adds the first address from that field", async () => {
      const user = userEvent.setup();
      const spy = vi.fn();
      render(<Live spy={spy} />);
      await user.type(field(1), "10.255.0.1/32{Enter}");
      expect(loopbacksSent(spy)).toEqual([["10.255.0.1/32"]]);
      // Still one row, now holding it, with the cursor still in it.
      expect(field(1)).toHaveValue("10.255.0.1/32");
      expect(field(1)).toHaveFocus();
    });

    it("opens a second field with +, focused, and adds to the list", async () => {
      const user = userEvent.setup();
      const spy = vi.fn();
      render(<Live loopbacks={["1.1.1.1/32"]} spy={spy} />);
      await user.click(add());
      expect(field(2)).toHaveFocus();
      await user.keyboard("2.2.2.2/32{Enter}");
      expect(loopbacksSent(spy)).toEqual([["1.1.1.1/32", "2.2.2.2/32"]]);
    });

    it("closes an empty field with − without changing anything", async () => {
      const user = userEvent.setup();
      const spy = vi.fn();
      render(<Live loopbacks={["1.1.1.1/32"]} spy={spy} />);
      await user.click(add());
      await user.click(remove(2));
      expect(screen.queryByLabelText("Loopback address 2")).not.toBeInTheDocument();
      expect(spy).not.toHaveBeenCalled();
    });

    it("removes a saved address with −, leaving an empty field after the last", async () => {
      const user = userEvent.setup();
      const spy = vi.fn();
      render(<Live loopbacks={["1.1.1.1/32", "2.2.2.2/32"]} spy={spy} />);
      await user.click(remove(1));
      await user.click(remove(1));
      expect(loopbacksSent(spy)).toEqual([["2.2.2.2/32"], []]);
      expect(field(1)).toHaveValue("");
      expect(remove(1)).toBeDisabled();
    });

    it("keeps a bad or repeated address in the field with a reason", async () => {
      const user = userEvent.setup();
      const spy = vi.fn();
      render(<Live loopbacks={["1.1.1.1/32"]} spy={spy} />);
      await user.click(add());
      await user.keyboard("3.3.3.3{Enter}");
      expect(screen.getByText("Add a prefix, usually 3.3.3.3/32.")).toBeInTheDocument();
      await user.clear(field(2));
      await user.keyboard("1.1.1.1/32{Enter}");
      expect(screen.getByText("1.1.1.1/32 is already on lo.")).toBeInTheDocument();
      expect(spy).not.toHaveBeenCalled();
    });

    it("has no axe violations with several rows", async () => {
      const user = userEvent.setup();
      const { container } = render(<Live loopbacks={["1.1.1.1/32"]} spy={vi.fn()} />);
      await user.click(add());
      const results = await axeCore.run(container);
      expect(results.violations.map((v) => v.id)).toEqual([]);
    });
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

describe("validateSubnet", () => {
  it("accepts a network in CIDR form", () => {
    expect(validateSubnet("192.168.1.0/24")).toBeNull();
    expect(validateSubnet("10.0.0.0/8")).toBeNull();
    expect(validateSubnet("172.16.4.0/30")).toBeNull();
  });

  it("treats blank as 'allocate one for me'", () => {
    expect(validateSubnet("")).toBeNull();
    expect(validateSubnet("   ")).toBeNull();
  });

  it("rejects text that is not CIDR at all", () => {
    expect(validateSubnet("192.168.1.0")).toMatch(/CIDR/);
    expect(validateSubnet("hello")).toMatch(/CIDR/);
  });

  it("rejects out-of-range octets", () => {
    expect(validateSubnet("300.1.1.0/24")).toMatch(/0-255/);
  });

  it("rejects an impossible prefix", () => {
    expect(validateSubnet("10.0.0.0/33")).toMatch(/\/32 or shorter/);
  });

  it("catches a host address and suggests the network", () => {
    // The common slip: typing the router's own address as the subnet.
    expect(validateSubnet("192.168.1.1/24")).toBe(
      "That is a host address. Did you mean 192.168.1.0/24?",
    );
    expect(validateSubnet("10.0.0.5/30")).toBe(
      "That is a host address. Did you mean 10.0.0.4/30?",
    );
  });
});

describe("CollisionDomainsPanel", () => {
  function withDomains() {
    const topology = linked();
    topology.nodes.push(newNode("r3", "router", { x: 200, y: 0 }));
    topology.nodes[2]!.interfaces = [{ number: 0, collision_domain: "C" }];
    topology.collision_domains = [{ name: "A" }, { name: "C", subnet: "192.168.1.0/24" }];
    return topology;
  }

  it("lists every collision domain in use", () => {
    render(<CollisionDomainsPanel topology={withDomains()} onDispatch={vi.fn()} />);
    expect(screen.getByLabelText("Subnet for A")).toBeInTheDocument();
    expect(screen.getByLabelText("Subnet for C")).toBeInTheDocument();
  });

  it("shows how many devices share each domain", () => {
    render(<CollisionDomainsPanel topology={withDomains()} onDispatch={vi.fn()} />);
    expect(screen.getByText("2 devices")).toBeInTheDocument();
    expect(screen.getByText("1 device")).toBeInTheDocument();
  });

  it("slides a two-device link's label from the keyboard, one step per release (FR-50)", () => {
    const onDispatch = vi.fn();
    render(<CollisionDomainsPanel topology={withDomains()} onDispatch={onDispatch} />);
    // C has one device, so no link and no label to slide.
    expect(screen.queryByLabelText("Label of C along the link")).not.toBeInTheDocument();
    const slider = screen.getByLabelText("Label of A along the link");
    expect(slider).toHaveValue("50");

    // jsdom does not move a range on arrow keys, so the value is set as the
    // browser would set it; the arrow keys themselves were tried in Chrome.
    fireEvent.change(slider, { target: { value: "45" } });
    fireEvent.change(slider, { target: { value: "40" } });
    expect(onDispatch).not.toHaveBeenCalled();
    fireEvent.keyUp(slider, { key: "ArrowLeft" });
    expect(onDispatch).toHaveBeenCalledTimes(1);
    expect(onDispatch).toHaveBeenCalledWith({ type: "moveLabel", collisionDomain: "A", at: 0.4 });
  });

  it("puts a slid label back in the middle", async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn();
    const topology = withDomains();
    topology.collision_domains[0]!.label_at = 0.3;
    render(<CollisionDomainsPanel topology={topology} onDispatch={onDispatch} />);
    expect(screen.getByLabelText("Label of A along the link")).toHaveValue("30");
    await user.click(screen.getByRole("button", { name: "Middle" }));
    expect(onDispatch).toHaveBeenCalledWith({ type: "moveLabel", collisionDomain: "A", at: null });
  });

  it("shows a subnet that has already been pinned", () => {
    render(<CollisionDomainsPanel topology={withDomains()} onDispatch={vi.fn()} />);
    expect(screen.getByLabelText("Subnet for C")).toHaveValue("192.168.1.0/24");
  });

  it("pins a subnet on commit", async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn();
    render(<CollisionDomainsPanel topology={withDomains()} onDispatch={onDispatch} />);

    await user.type(screen.getByLabelText("Subnet for A"), "10.20.30.0/24");
    await user.tab();

    expect(onDispatch).toHaveBeenCalledWith({
      type: "setSubnet",
      collisionDomain: "A",
      subnet: "10.20.30.0/24",
    });
  });

  it("clearing the field releases the subnet for allocation", async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn();
    render(<CollisionDomainsPanel topology={withDomains()} onDispatch={onDispatch} />);

    await user.clear(screen.getByLabelText("Subnet for C"));
    await user.tab();

    expect(onDispatch).toHaveBeenCalledWith({
      type: "setSubnet",
      collisionDomain: "C",
      subnet: null,
    });
  });

  it("refuses to commit an invalid subnet and says why", async () => {
    // Committing it would poison the topology and 422 every later request.
    const user = userEvent.setup();
    const onDispatch = vi.fn();
    render(<CollisionDomainsPanel topology={withDomains()} onDispatch={onDispatch} />);

    await user.type(screen.getByLabelText("Subnet for A"), "192.168.1.1/24");
    await user.tab();

    expect(onDispatch).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/Did you mean 192\.168\.1\.0\/24/);
  });

  it("keeps what the user typed rather than discarding it", async () => {
    const user = userEvent.setup();
    render(<CollisionDomainsPanel topology={withDomains()} onDispatch={vi.fn()} />);

    await user.type(screen.getByLabelText("Subnet for A"), "192.168.1.1/24");
    await user.tab();

    expect(screen.getByLabelText("Subnet for A")).toHaveValue("192.168.1.1/24");
  });

  it("marks the field invalid for assistive technology", async () => {
    const user = userEvent.setup();
    render(<CollisionDomainsPanel topology={withDomains()} onDispatch={vi.fn()} />);

    await user.type(screen.getByLabelText("Subnet for A"), "nonsense");
    expect(screen.getByLabelText("Subnet for A")).toHaveAttribute("aria-invalid", "true");
  });

  it("renders nothing when no domain is in use", () => {
    const { container } = render(
      <CollisionDomainsPanel topology={twoRouters()} onDispatch={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <CollisionDomainsPanel topology={withDomains()} onDispatch={vi.fn()} />,
    );
    const results = await axeCore.run(container);
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});

describe("validateLoopback", () => {
  it("accepts IPv4 and IPv6 addresses in CIDR form", () => {
    expect(validateLoopback("10.255.0.1/32")).toBeNull();
    expect(validateLoopback("2001:db8::1/128")).toBeNull();
  });

  it("explains what is wrong", () => {
    expect(validateLoopback("abc")).toMatch(/CIDR form/);
    expect(validateLoopback("10.0.0.300/32")).toMatch(/0-255/);
    expect(validateLoopback("127.0.0.2/8")).toMatch(/already on lo/);
    expect(validateLoopback("1.1.1.1/32", ["1.1.1.1/32"])).toMatch(/already on lo/);
  });
});
