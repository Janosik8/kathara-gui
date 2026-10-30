import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axeCore from "axe-core";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { newText, nextTextId, sizeProblem } from "../canvas/texts";
import { type Operation, apply, describe as describeOp } from "../store/operations";
import { type TextLabel, type Topology, newNode } from "../types";
import { TextLabelsPanel } from "./TextLabelsPanel";

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

const TITLE: TextLabel = { id: "t1", text: "Area 0", position: { x: 0, y: 0 }, size: 24 };

describe("text label placement (FR-51)", () => {
  it("numbers labels without reusing an id", () => {
    expect(nextTextId(lab())).toBe("t1");
    expect(nextTextId({ ...lab(), texts: [TITLE, { ...TITLE, id: "t3" }] })).toBe("t2");
  });

  it("puts a new label above the selected devices, or above the lab", () => {
    expect(newText(lab(), ["pc1"]).position).toEqual({ x: 600, y: 344 });
    expect(newText(lab(), []).position.y).toBeLessThan(0);
    expect(newText(lab(), [], { x: 7, y: 9 }).position).toEqual({ x: 7, y: 9 });
  });

  it("accepts whole font sizes from 8 to 96 only", () => {
    expect(sizeProblem("24")).toBeNull();
    expect(sizeProblem(" 8 ")).toBeNull();
    expect(sizeProblem("96")).toBeNull();
    for (const bad of ["", "7", "97", "12.5", "big"]) expect(sizeProblem(bad)).not.toBeNull();
  });
});

describe("text label operations", () => {
  it("adds, changes and removes a label, leaving devices where they are", () => {
    let t = apply(lab(), { type: "addText", text: TITLE });
    t = apply(t, { type: "updateText", id: "t1", changes: { position: { x: 50, y: 60 }, size: 40 } });
    expect(t.texts?.[0]).toEqual({ ...TITLE, position: { x: 50, y: 60 }, size: 40 });
    expect(t.nodes).toEqual(lab().nodes);
    t = apply(t, { type: "removeText", id: "t1" });
    expect(t.texts).toEqual([]);
  });

  it("refuses a label it does not have, and a second label with one id", () => {
    expect(() => apply(lab(), { type: "removeText", id: "t9" })).toThrow();
    expect(() => apply(lab(), { type: "updateText", id: "t9", changes: {} })).toThrow();
    const once = apply(lab(), { type: "addText", text: TITLE });
    expect(() => apply(once, { type: "addText", text: TITLE })).toThrow();
  });

  it("describes each change for the undo hint", () => {
    expect(describeOp({ type: "addText", text: TITLE })).toBe("Added the text Area 0");
    expect(describeOp({ type: "removeText", id: "t1" })).toBe("Removed a text label");
  });
});

/** The panel over a topology it really changes, as the app's store does. */
function Live({ selected = [] as string[], spy = vi.fn() }) {
  const [topology, setTopology] = useState<Topology>(lab());
  const [text, setText] = useState<string | null>(null);
  return (
    <TextLabelsPanel
      topology={topology}
      selected={selected}
      selectedText={text}
      onSelectText={setText}
      onDispatch={(op: Operation) => {
        spy(op);
        setTopology((t) => apply(t, op));
      }}
    />
  );
}

describe("TextLabelsPanel", () => {
  it("adds a label from the keyboard with its words ready to type over", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Live selected={["r2"]} spy={spy} />);
    screen.getByRole("button", { name: "Add text label" }).focus();
    await user.keyboard("{Enter}");
    const added = spy.mock.calls[0]![0] as Extract<Operation, { type: "addText" }>;
    expect(added.text.position.x).toBe(260);
    expect(screen.getByLabelText("Text")).toHaveFocus();
    await user.keyboard("Backbone{Enter}");
    expect(spy.mock.calls[1]![0]).toMatchObject({ type: "updateText", changes: { text: "Backbone" } });
  });

  it("sets the font size, and refuses one out of range without committing it", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Live spy={spy} />);
    await user.click(screen.getByRole("button", { name: "Add text label" }));
    const size = screen.getByLabelText("Font size (8–96 px)");
    expect(size).toHaveValue("16");
    await user.clear(size);
    await user.type(size, "200{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent("from 8 to 96 pixels");
    expect(spy).toHaveBeenCalledTimes(1);
    await user.clear(size);
    await user.type(size, "32{Enter}");
    expect(spy.mock.calls[1]![0]).toMatchObject({ type: "updateText", changes: { size: 32 } });
  });

  it("refuses an empty label", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Live spy={spy} />);
    await user.click(screen.getByRole("button", { name: "Add text label" }));
    await user.clear(screen.getByLabelText("Text"));
    await user.keyboard("{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent("needs some text");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("moves a label above the selected devices, and deletes it", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    const { rerender } = render(<Live spy={spy} />);
    await user.click(screen.getByRole("button", { name: "Add text label" }));
    expect(screen.getByRole("button", { name: "Move above selected devices" })).toBeDisabled();
    rerender(<Live selected={["pc1"]} spy={spy} />);
    await user.click(screen.getByRole("button", { name: "Move above selected devices" }));
    expect(spy.mock.calls[1]![0]).toMatchObject({
      type: "updateText",
      changes: { position: { x: 600, y: 344 } },
    });
    await user.click(screen.getByRole("button", { name: "Delete text label Text" }));
    expect(screen.queryByLabelText("Text")).toBeNull();
  });

  it("has no axe violations with a label listed", async () => {
    const user = userEvent.setup();
    const { container } = render(<Live />);
    await user.click(screen.getByRole("button", { name: "Add text label" }));
    const results = await axeCore.run(container);
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});
