/**
 * StatusControl is a keyboard-usable radiogroup.
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { StatusControl } from "../status-control";

afterEach(cleanup);

describe("StatusControl", () => {
  it("marks the current value and selects on click", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StatusControl value="pass" onChange={onChange} label="Status for: Q" />);
    expect(screen.getByRole("radio", { name: "Pass" })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("radio", { name: "N/A" }));
    expect(onChange).toHaveBeenCalledWith("not_applicable");
  });

  it("moves the selection with arrow keys and wraps around", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StatusControl value="pass" onChange={onChange} label="Status for: Q" />);
    const pass = screen.getByRole("radio", { name: "Pass" });
    pass.focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("fail");
    await user.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith("pass");
    await user.keyboard("{End}");
    expect(onChange).toHaveBeenLastCalledWith("not_applicable");
  });

  it("keeps the first option tabbable when the status is unknown", () => {
    render(<StatusControl value="unknown" onChange={vi.fn()} label="Status for: Q" />);
    expect(screen.getByRole("radio", { name: "Pass" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "Fail" })).toHaveAttribute("tabindex", "-1");
    screen.getAllByRole("radio").forEach((radio) => expect(radio).toHaveAttribute("aria-checked", "false"));
  });
});
