/**
 * The tree is the accessible interface to the topology, so these tests assert
 * behaviour a screen-reader or keyboard-only user depends on — not just that
 * the component renders.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axeCore from "axe-core";
import { describe, expect, it, vi } from "vitest";
import { type Topology, newNode } from "../types";
import { TopologyTree } from "./TopologyTree";

function topology(): Topology {
  const r1 = newNode("r1", "router", { x: 0, y: 0 });
  r1.interfaces = [
    { number: 0, collision_domain: "A", ip: "10.0.0.1/24" },
    { number: 1, collision_domain: "B" },
  ];
  const r2 = newNode("r2", "router", { x: 100, y: 0 });
  r2.interfaces = [{ number: 0, collision_domain: "A", ip: "10.0.0.2/24" }];
  const pc1 = newNode("pc1", "pc", { x: 200, y: 0 });

  return {
    name: "lab",
    nodes: [r1, r2, pc1],
    collision_domains: [{ name: "A", subnet: "10.0.0.0/24" }, { name: "B" }],
  };
}

function renderTree(overrides: Partial<Parameters<typeof TopologyTree>[0]> = {}) {
  const onSelect = vi.fn();
  const onRemove = vi.fn();
  const utils = render(
    <TopologyTree
      topology={topology()}
      selected={[]}
      onSelect={onSelect}
      onRemove={onRemove}
      {...overrides}
    />,
  );
  return { ...utils, onSelect, onRemove };
}

describe("structure", () => {
  it("exposes a labelled tree", () => {
    renderTree();
    expect(screen.getByRole("tree", { name: "Network topology" })).toBeInTheDocument();
  });

  it("lists every device as a treeitem", () => {
    renderTree();
    const items = screen.getAllByRole("treeitem");
    expect(items).toHaveLength(3);
  });

  it("announces each device's kind and interface count", () => {
    renderTree();
    expect(screen.getByRole("treeitem", { name: /r1, router, 2 interfaces/ })).toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: /pc1, pc, 0 interfaces/ })).toBeInTheDocument();
  });

  it("marks devices with interfaces as expandable", () => {
    renderTree();
    expect(screen.getByRole("treeitem", { name: /^r1/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("does not mark a device without interfaces as expandable", () => {
    // A control that claims to expand but cannot is a worse lie than no control.
    renderTree();
    expect(screen.getByRole("treeitem", { name: /^pc1/ })).not.toHaveAttribute("aria-expanded");
  });

  it("reflects selection with aria-selected", () => {
    renderTree({ selected: ["r2"] });
    expect(screen.getByRole("treeitem", { name: /^r2/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

describe("conveying the graph without sight", () => {
  it("names the neighbours sharing a collision domain", async () => {
    // The crux: a sighted user sees an edge. Saying "eth0 on domain A" does
    // not convey who is at the other end, so the connection is spelled out.
    const user = userEvent.setup();
    renderTree();
    await user.click(screen.getByRole("treeitem", { name: /^r1/ }));
    await user.keyboard("{ArrowRight}");

    expect(
      screen.getByRole("treeitem", { name: /eth0.*domain A.*10\.0\.0\.1\/24.*r2 eth0/ }),
    ).toBeInTheDocument();
  });

  it("says so when an interface leads nowhere", async () => {
    const user = userEvent.setup();
    renderTree();
    await user.click(screen.getByRole("treeitem", { name: /^r1/ }));
    await user.keyboard("{ArrowRight}");

    expect(
      screen.getByRole("treeitem", { name: /eth1.*not connected to any other device/ }),
    ).toBeInTheDocument();
  });

  it("states when an interface has no address", async () => {
    const user = userEvent.setup();
    renderTree();
    await user.click(screen.getByRole("treeitem", { name: /^r1/ }));
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("treeitem", { name: /eth1.*no address/ })).toBeInTheDocument();
  });
});

describe("keyboard navigation", () => {
  it("is a single tab stop with a roving tabindex", async () => {
    renderTree();
    const items = screen.getAllByRole("treeitem");
    // Exactly one reachable by Tab; the rest via arrows.
    expect(items.filter((i) => i.getAttribute("tabindex") === "0")).toHaveLength(1);
    expect(items[0]).toHaveAttribute("tabindex", "0");
  });

  it("moves down and up with the arrow keys", async () => {
    const user = userEvent.setup();
    renderTree();
    await user.tab();
    expect(screen.getByRole("treeitem", { name: /^r1/ })).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("treeitem", { name: /^r2/ })).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("treeitem", { name: /^r1/ })).toHaveFocus();
  });

  it("does not wrap past the ends", async () => {
    const user = userEvent.setup();
    renderTree();
    await user.tab();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("treeitem", { name: /^r1/ })).toHaveFocus();
  });

  it("jumps to first and last with Home and End", async () => {
    const user = userEvent.setup();
    renderTree();
    await user.tab();
    await user.keyboard("{End}");
    expect(screen.getByRole("treeitem", { name: /^pc1/ })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("treeitem", { name: /^r1/ })).toHaveFocus();
  });

  it("expands with ArrowRight and collapses with ArrowLeft", async () => {
    const user = userEvent.setup();
    renderTree();
    await user.tab();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("treeitem", { name: /^r1/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getAllByRole("treeitem")).toHaveLength(5); // 3 devices + 2 interfaces

    await user.keyboard("{ArrowLeft}");
    expect(screen.getAllByRole("treeitem")).toHaveLength(3);
  });

  it("returns from an interface to its device with ArrowLeft", async () => {
    const user = userEvent.setup();
    renderTree();
    await user.tab();
    await user.keyboard("{ArrowRight}{ArrowDown}");
    expect(screen.getByRole("treeitem", { name: /eth0/ })).toHaveFocus();

    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("treeitem", { name: /^r1/ })).toHaveFocus();
  });

  it("selects with Enter", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderTree();
    await user.tab();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("r1", false);
  });

  it("removes a device with Delete", async () => {
    const user = userEvent.setup();
    const { onRemove } = renderTree();
    await user.tab();
    await user.keyboard("{Delete}");
    expect(onRemove).toHaveBeenCalledWith("r1");
  });
});

describe("empty state", () => {
  it("explains what to do rather than showing an empty box", () => {
    render(
      <TopologyTree
        topology={{ name: "lab", nodes: [], collision_domains: [] }}
        selected={[]}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText(/No devices yet/)).toBeInTheDocument();
  });
});

describe("automated audit", () => {
  it("has no axe violations", async () => {
    const { container } = renderTree();
    const results = await axeCore.run(container);
    const summary = results.violations.map((v) => `${v.id}: ${v.help}`);
    expect(summary).toEqual([]);
  });

  it("has no axe violations when expanded", async () => {
    const user = userEvent.setup();
    const { container } = renderTree();
    await user.click(screen.getByRole("treeitem", { name: /^r1/ }));
    await user.keyboard("{ArrowRight}");

    const results = await axeCore.run(container);
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  it("keeps interfaces inside the tree's accessibility subtree", async () => {
    const user = userEvent.setup();
    renderTree();
    await user.click(screen.getByRole("treeitem", { name: /^r1/ }));
    await user.keyboard("{ArrowRight}");

    const tree = screen.getByRole("tree");
    expect(within(tree).getAllByRole("treeitem")).toHaveLength(5);
  });
});
