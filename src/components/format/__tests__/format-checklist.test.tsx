/**
 * FormatChecklist renders the profile-driven, grouped checklist.
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { FormatChecklist } from "../format-checklist";
import { SAMPLE_CHECKS, SAMPLE_REPORT } from "./sample-report";

afterEach(cleanup);

describe("FormatChecklist", () => {
  it("renders groups in profile order with the editor question, summary and status", () => {
    render(<FormatChecklist report={SAMPLE_REPORT} checks={SAMPLE_CHECKS} overrides={{}} onOverride={vi.fn()} />);

    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings[0]).toContain("Main file");
    expect(headings[1]).toContain("Summary");
    expect(headings[2]).toContain("References");
    expect(headings[3]).toContain("Required statements");

    expect(screen.getByText("Is the main manuscript file a PDF?")).toBeInTheDocument();
    expect(screen.getByText("The uploaded file is a PDF.")).toBeInTheDocument();

    const group = screen.getByRole("radiogroup", { name: "Status for: Is the main manuscript file a PDF?" });
    expect(within(group).getByRole("radio", { name: "Fail" })).toHaveAttribute("aria-checked", "true");
    expect(within(group).getByRole("radio", { name: "Pass" })).toHaveAttribute("aria-checked", "false");
  });

  it("shows detector badges and the letter phrase for failing rows", () => {
    render(<FormatChecklist report={SAMPLE_REPORT} checks={SAMPLE_CHECKS} overrides={{}} onOverride={vi.fn()} />);
    expect(screen.getAllByText("Rule").length).toBeGreaterThan(0);
    expect(screen.getByText("AI")).toBeInTheDocument();
    expect(screen.getByText("Please provide the main document as a modifiable Word file.")).toBeInTheDocument();
    expect(screen.getByText("Please add DOIs to all references.")).toBeInTheDocument();
    // A passing row keeps its phrase behind a collapsed <details>.
    expect(screen.getByText("Please shorten the Summary to 150 words or fewer.")).not.toBeVisible();
  });

  it("expands evidence quotes on demand", async () => {
    const user = userEvent.setup();
    render(<FormatChecklist report={SAMPLE_REPORT} checks={SAMPLE_CHECKS} overrides={{}} onOverride={vi.fn()} />);
    expect(screen.queryByText("sample-manuscript.pdf")).not.toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: /1 evidence quote/ })[0]);
    expect(screen.getByText("sample-manuscript.pdf")).toBeInTheDocument();
    expect(screen.getByText("(file name)")).toBeInTheDocument();
  });

  it("calls onOverride with the chosen status and offers a reset once overridden", async () => {
    const user = userEvent.setup();
    const onOverride = vi.fn();
    const { rerender } = render(
      <FormatChecklist report={SAMPLE_REPORT} checks={SAMPLE_CHECKS} overrides={{}} onOverride={onOverride} />,
    );
    const group = screen.getByRole("radiogroup", { name: "Status for: Is the Summary longer than 150 words?" });
    await user.click(within(group).getByRole("radio", { name: "Fail" }));
    expect(onOverride).toHaveBeenCalledWith("summary.length", "fail");

    rerender(
      <FormatChecklist
        report={SAMPLE_REPORT}
        checks={SAMPLE_CHECKS}
        overrides={{ "summary.length": { status: "fail" } }}
        onOverride={onOverride}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Reset status to detected \(Pass\)/ }));
    expect(onOverride).toHaveBeenCalledWith("summary.length", undefined);
  });

  it("falls back to the summary line and derived categories without a catalog", () => {
    render(<FormatChecklist report={SAMPLE_REPORT} overrides={{}} onOverride={vi.fn()} />);
    expect(screen.getByText("0 of 42 references carry a DOI.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: /References/ })).toBeInTheDocument();
  });

  it("shows an empty state when there is no report", () => {
    render(<FormatChecklist report={undefined} overrides={{}} onOverride={vi.fn()} />);
    expect(screen.getByTestId("checklist-empty")).toBeInTheDocument();
  });
});
