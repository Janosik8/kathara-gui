import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axeCore from "axe-core";
import { describe, expect, it, vi } from "vitest";
import type { ExamState, Features } from "../api/client";
import { ExamPanel } from "./ExamPanel";

const ALL_ON: Features = {
  subnet_calculator: true,
  addressing_validation: true,
  infrastructure_verification: true,
  interface_addresses: false,
};

function renderPanel(exam: ExamState, intact: boolean | null = null) {
  const handlers = {
    onSetFeatures: vi.fn(),
    onLock: vi.fn(),
    onUnlock: vi.fn(),
    onRelock: vi.fn(),
    onRemoveLock: vi.fn(),
  };
  render(<ExamPanel features={ALL_ON} exam={exam} intact={intact} busy={false} {...handlers} />);
  return handlers;
}

describe("ExamPanel (FR-28, note 1)", () => {
  it("switches a feature off", async () => {
    const user = userEvent.setup();
    const { onSetFeatures } = renderPanel({ locked: false, unlocked: false });
    await user.click(screen.getByRole("checkbox", { name: "Subnet calculator" }));
    expect(onSetFeatures).toHaveBeenCalledWith({ ...ALL_ON, subnet_calculator: false });
  });

  it("locks only with a password typed twice alike", async () => {
    const user = userEvent.setup();
    const { onLock } = renderPanel({ locked: false, unlocked: false });
    const lock = screen.getByRole("button", { name: "Lock the switches" });
    expect(lock).toBeDisabled();

    await user.type(screen.getByLabelText("Author's password"), "abc");
    expect(screen.getByText(/at least 4 characters/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Author's password"), "d");
    await user.type(screen.getByLabelText("The password again"), "abce");
    expect(screen.getByText(/the two passwords differ/)).toBeInTheDocument();
    expect(lock).toBeDisabled();

    await user.clear(screen.getByLabelText("The password again"));
    await user.type(screen.getByLabelText("The password again"), "abcd");
    await user.click(lock);
    expect(onLock).toHaveBeenCalledWith("abcd");
    // Not left in the field for the next person at the machine.
    expect(screen.getByLabelText("Author's password")).toHaveValue("");
  });

  it("freezes the switches while locked, and asks for the password", async () => {
    const user = userEvent.setup();
    const { onUnlock, onSetFeatures } = renderPanel({ locked: true, unlocked: false });
    for (const box of screen.getAllByRole("checkbox")) expect(box).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "Link verification" }));
    expect(onSetFeatures).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Author's password"), "secret{Enter}");
    expect(onUnlock).toHaveBeenCalledWith("secret");
  });

  it("offers to lock again or remove the lock once unlocked", async () => {
    const user = userEvent.setup();
    const { onRelock, onRemoveLock } = renderPanel({ locked: true, unlocked: true });
    for (const box of screen.getAllByRole("checkbox")) expect(box).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Lock again" }));
    await user.click(screen.getByRole("button", { name: "Remove the lock" }));
    expect(onRelock).toHaveBeenCalled();
    expect(onRemoveLock).toHaveBeenCalled();
  });

  it("warns when the switches were changed outside the application", () => {
    renderPanel({ locked: true, unlocked: true }, false);
    expect(screen.getByRole("alert")).toHaveTextContent(/changed outside this application/);
  });

  it("has no axe violations, locked or not", async () => {
    for (const exam of [
      { locked: false, unlocked: false },
      { locked: true, unlocked: false },
      { locked: true, unlocked: true },
    ]) {
      const { container, unmount } = render(
        <ExamPanel
          features={ALL_ON}
          exam={exam}
          intact={false}
          busy={false}
          onSetFeatures={() => undefined}
          onLock={() => undefined}
          onUnlock={() => undefined}
          onRelock={() => undefined}
          onRemoveLock={() => undefined}
        />,
      );
      const results = await axeCore.run(container);
      expect(results.violations.map((v) => v.id)).toEqual([]);
      unmount();
    }
  });

  it("switches the addresses on the canvas on (FR-49)", async () => {
    const user = userEvent.setup();
    const { onSetFeatures } = renderPanel({ locked: false, unlocked: false });
    const box = screen.getByRole("checkbox", { name: "Addresses on the canvas" });
    expect(box).not.toBeChecked();
    await user.click(box);
    expect(onSetFeatures).toHaveBeenCalledWith({ ...ALL_ON, interface_addresses: true });
  });
});
