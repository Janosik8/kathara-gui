import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axeCore from "axe-core";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fitAround, newZone, nextZoneId } from "../canvas/zones";
import { type Operation, apply, describe as describeOp } from "../store/operations";
import { type Topology, type Zone, newNode } from "../types";
import { ZonesPanel } from "./ZonesPanel";

function lab(): Topology {
  return {
    name: "lab",
    nodes: [
      newNode("r1", "router", { x: 0, y: 0 }),
      newNode("r2", "router", { x: 260, y: 170 }),
      newNode("pc1", "pc", { x: 600, y: 400 }),
    ],
    collision_domains: [],
  };
}

const AREA: Zone = {
  id: "z1",
  name: "Area 0",
  shape: "rectangle",
  position: { x: 0, y: 0 },
  width: 100,
  height: 100,
};

describe("zone geometry (FR-10)", () => {
  it("fits a zone round devices with room for their labels", () => {
    const box = fitAround(lab().nodes.slice(0, 2));
    expect(box.position).toEqual({ x: -70, y: -60 });
    // Both devices, and the second one's own size past its position.
    expect(box.position.x + box.width).toBeGreaterThan(260 + 80);
    expect(box.position.y + box.height).toBeGreaterThan(170 + 80);
  });

  it("numbers zones without reusing an id", () => {
    expect(nextZoneId(lab())).toBe("z1");
    expect(nextZoneId({ ...lab(), zones: [AREA, { ...AREA, id: "z3" }] })).toBe("z2");
  });

  it("puts a zone with nothing selected above the lab, covering no device", () => {
    const zone = newZone(lab(), []);
    expect(zone.position.y + zone.height).toBeLessThan(0);
  });
});

describe("zone operations", () => {
  it("adds, changes and removes a zone, leaving devices where they are", () => {
    let t = apply(lab(), { type: "addZone", zone: AREA });
    t = apply(t, { type: "updateZone", id: "z1", changes: { position: { x: 500, y: 500 } } });
    expect(t.zones?.[0]?.position).toEqual({ x: 500, y: 500 });
    expect(t.nodes).toEqual(lab().nodes);
    t = apply(t, { type: "removeZone", id: "z1" });
    expect(t.zones).toEqual([]);
  });

  it("refuses a zone it does not have, and a second zone with one id", () => {
    expect(() => apply(lab(), { type: "removeZone", id: "z9" })).toThrow();
    const once = apply(lab(), { type: "addZone", zone: AREA });
    expect(() => apply(once, { type: "addZone", zone: AREA })).toThrow();
  });

  it("describes each change for the undo hint", () => {
    expect(describeOp({ type: "addZone", zone: AREA })).toBe("Added the zone Area 0");
    expect(describeOp({ type: "updateZone", id: "z1", changes: {}, label: "Moved Area 0" })).toBe(
      "Moved Area 0",
    );
  });
});

/** The panel over a topology it really changes, as the app's store does. */
function Live({ selected = [] as string[], spy = vi.fn() }) {
  const [topology, setTopology] = useState<Topology>(lab());
  const [zone, setZone] = useState<string | null>(null);
  return (
    <ZonesPanel
      topology={topology}
      selected={selected}
      selectedZone={zone}
      onSelectZone={setZone}
      onDispatch={(op: Operation) => {
        spy(op);
        setTopology((t) => apply(t, op));
      }}
    />
  );
}

describe("ZonesPanel", () => {
  it("adds a zone round the selected devices, from the keyboard", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Live selected={["r1", "r2"]} spy={spy} />);
    screen.getByRole("button", { name: "Add zone round 2 devices" }).focus();
    await user.keyboard("{Enter}");
    const added = spy.mock.calls[0]![0] as Extract<Operation, { type: "addZone" }>;
    expect(added.zone.position).toEqual(fitAround(lab().nodes.slice(0, 2)).position);
    expect(screen.getByLabelText("Zone name")).toHaveValue("Zone 1");
  });

  it("names, reshapes, fits and deletes a zone", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Live selected={["pc1"]} spy={spy} />);
    await user.click(screen.getByRole("button", { name: "Add zone round 1 device" }));

    await user.clear(screen.getByLabelText("Zone name"));
    await user.type(screen.getByLabelText("Zone name"), "Backbone{Enter}");
    await user.selectOptions(screen.getByLabelText("Shape"), "cloud");
    await user.click(screen.getByRole("button", { name: "Fit to selected devices" }));
    expect(spy.mock.calls.map(([op]) => (op as Operation).type)).toEqual([
      "addZone",
      "updateZone",
      "updateZone",
      "updateZone",
    ]);
    expect(screen.getByLabelText("Shape")).toHaveValue("cloud");

    await user.click(screen.getByRole("button", { name: "Delete zone Backbone" }));
    expect(screen.queryByLabelText("Zone name")).toBeNull();
  });

  it("cannot fit a zone with no device selected", async () => {
    const user = userEvent.setup();
    render(<Live />);
    await user.click(screen.getByRole("button", { name: "Add zone" }));
    expect(screen.getByRole("button", { name: "Fit to selected devices" })).toBeDisabled();
  });

  it("has no axe violations with a zone listed", async () => {
    const user = userEvent.setup();
    const { container } = render(<Live />);
    await user.click(screen.getByRole("button", { name: "Add zone" }));
    const results = await axeCore.run(container);
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});
