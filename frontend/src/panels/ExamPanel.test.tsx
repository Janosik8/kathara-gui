import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axeCore from "axe-core";
import { describe, expect, it, vi } from "vitest";
import type { Features } from "../api/client";
import { ExamPanel } from "./ExamPanel";

const ALL_ON: Features = {
  subnet_calculator: true,
  addressing_validation: true,
  infrastructure_verification: true,
  interface_addresses: false,
};

describe("ExamPanel (FR-28)", () => {
  it("switches a feature off", async () => {
    const user = userEvent.setup();
    const onSetFeatures = vi.fn();
    render(<ExamPanel features={ALL_ON} busy={false} onSetFeatures={onSetFeatures} />);
    await user.click(screen.getByRole("checkbox", { name: "Subnet calculator" }));
    expect(onSetFeatures).toHaveBeenCalledWith({ ...ALL_ON, subnet_calculator: false });
  });

  it("switches the addresses on the canvas on (FR-49)", async () => {
    const user = userEvent.setup();
    const onSetFeatures = vi.fn();
    render(<ExamPanel features={ALL_ON} busy={false} onSetFeatures={onSetFeatures} />);
    const box = screen.getByRole("checkbox", { name: "Addresses on the canvas" });
    expect(box).not.toBeChecked();
    await user.click(box);
    expect(onSetFeatures).toHaveBeenCalledWith({ ...ALL_ON, interface_addresses: true });
  });

  it("offers no password on the switches (F51)", () => {
    render(<ExamPanel features={ALL_ON} busy={false} onSetFeatures={() => undefined} />);
    expect(screen.queryByLabelText(/password/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /lock/i })).toBeNull();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <ExamPanel features={ALL_ON} busy={false} onSetFeatures={() => undefined} />,
    );
    const results = await axeCore.run(container);
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});
