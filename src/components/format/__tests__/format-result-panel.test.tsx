/**
 * FormatResultPanel renders the formatting block: summary chips, downloads,
 * grouped operations and author actions; plus its empty state.
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { FormatResultPanel } from "../format-result-panel";
import { SAMPLE_FORMATTING, SAMPLE_FORMATTING_DOCX } from "./sample-report";

afterEach(cleanup);

describe("FormatResultPanel", () => {
  it("renders the summary chips and the download links from the downloads URLs", () => {
    render(<FormatResultPanel formatting={SAMPLE_FORMATTING} sourceType="pdf" />);

    const chips = screen.getByTestId("format-summary-chips");
    expect(chips).toHaveTextContent("3 changes applied automatically");
    expect(chips).toHaveTextContent("2 items for the authors");
    expect(chips).toHaveTextContent("References matched 40/42");

    expect(screen.getByTestId("download-formatted")).toHaveAttribute("href", "/api/format/reports/rep_123/file?kind=formatted");
    expect(screen.getByTestId("download-change-log")).toHaveAttribute("href", "/api/format/reports/rep_123/file?kind=change-log");
    expect(screen.getByTestId("download-letter-docx")).toHaveAttribute(
      "href",
      "/api/format/reports/rep_123/file?kind=letter&format=docx",
    );
    expect(screen.getByTestId("download-letter-txt")).toHaveAttribute(
      "href",
      "/api/format/reports/rep_123/file?kind=letter&format=txt",
    );
  });

  it("hides the tracked-changes download for PDF sources and explains why", () => {
    render(<FormatResultPanel formatting={SAMPLE_FORMATTING} sourceType="pdf" />);
    expect(screen.queryByTestId("download-tracked")).not.toBeInTheDocument();
    expect(screen.getByTestId("tracked-note")).toHaveTextContent(/only available when the source is a Word/);
  });

  it("offers the tracked-changes download for Word sources", () => {
    render(<FormatResultPanel formatting={SAMPLE_FORMATTING_DOCX} sourceType="docx" />);
    expect(screen.getByTestId("download-tracked")).toHaveAttribute("href", "/api/format/reports/rep_123/file?kind=tracked");
    expect(screen.queryByTestId("tracked-note")).not.toBeInTheDocument();
  });

  it("expands the operations grouped by kind with before/after snippets", async () => {
    const user = userEvent.setup();
    render(<FormatResultPanel formatting={SAMPLE_FORMATTING} sourceType="pdf" />);

    const toggle = screen.getByTestId("toggle-operations");
    expect(toggle).toHaveTextContent("4 operations in 3 groups");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("operations-list")).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const list = screen.getByTestId("operations-list");
    const groupNames = within(list)
      .getAllByRole("heading", { level: 4 })
      .map((h) => h.textContent?.replace(/\s*\(\d+\).*$/, ""));
    expect(groupNames).toEqual(["Renamed headings", "Inserted sections", "Added DOIs"]);

    const renamed = within(list).getByRole("region", { name: "Renamed headings" });
    const snippets = renamed.querySelectorAll("[data-snippet]");
    expect(snippets[0]).toHaveAttribute("data-snippet", "before");
    expect(snippets[0]).toHaveTextContent("Abstract");
    expect(snippets[1]).toHaveAttribute("data-snippet", "after");
    expect(snippets[1]).toHaveTextContent("Summary");

    const inserted = within(list).getByRole("region", { name: "Inserted sections" });
    expect(inserted).toHaveTextContent("Needs the authors");
    expect(inserted).toHaveTextContent("In the letter:");
    expect(within(list).getAllByText("Automatic")).toHaveLength(3);

    // Keyboard: the toggle is a real button, so Enter collapses it again.
    toggle.focus();
    await user.keyboard("{Enter}");
    expect(screen.queryByTestId("operations-list")).not.toBeInTheDocument();
  });

  it("lists the author actions with their origin", () => {
    render(<FormatResultPanel formatting={SAMPLE_FORMATTING} sourceType="pdf" />);
    const list = screen.getByRole("list", { name: "Author actions" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Limitations of the study");
    expect(items[0]).toHaveTextContent("Formatter");
    expect(items[1]).toHaveTextContent("modifiable Word file");
    expect(items[1]).toHaveTextContent("Check");
  });

  it("shows an empty state with a Format now action when formatting did not run", async () => {
    const user = userEvent.setup();
    const onRebuild = vi.fn();
    render(<FormatResultPanel formatting={null} sourceType="pdf" onRebuild={onRebuild} />);
    expect(screen.getByTestId("format-result-empty")).toHaveTextContent(/Formatting was not run/);
    await user.click(screen.getByRole("button", { name: "Format now" }));
    expect(onRebuild).toHaveBeenCalledTimes(1);
  });

  it("offers Re-run formatting and disables it while rebuilding", () => {
    const onRebuild = vi.fn();
    const { rerender } = render(<FormatResultPanel formatting={SAMPLE_FORMATTING} onRebuild={onRebuild} />);
    expect(screen.getByRole("button", { name: "Re-run formatting" })).toBeEnabled();
    rerender(<FormatResultPanel formatting={SAMPLE_FORMATTING} onRebuild={onRebuild} rebuilding />);
    expect(screen.getByRole("button", { name: "Formatting…" })).toBeDisabled();
  });

  it("replaces the rebuild action with a note when no source file is stored", () => {
    const onRebuild = vi.fn();
    const { rerender } = render(<FormatResultPanel formatting={null} onRebuild={onRebuild} canFormat={false} />);
    expect(screen.queryByRole("button", { name: "Format now" })).not.toBeInTheDocument();
    expect(screen.getByTestId("no-source-note")).toHaveTextContent(/not stored/);

    rerender(<FormatResultPanel formatting={SAMPLE_FORMATTING} onRebuild={onRebuild} canFormat={false} />);
    expect(screen.queryByRole("button", { name: "Re-run formatting" })).not.toBeInTheDocument();
    expect(screen.getByTestId("no-source-note")).toBeInTheDocument();
    // Downloads of the stored files are unaffected.
    expect(screen.getByTestId("download-formatted")).toBeInTheDocument();
  });

  it("shows the engine's notes (degradations) and hides the box without any", () => {
    const { rerender } = render(
      <FormatResultPanel formatting={{ ...SAMPLE_FORMATTING, notes: ["Crossref lookups were skipped (time budget)."] }} />,
    );
    expect(screen.getByRole("note", { name: "Formatting notes" })).toHaveTextContent("Crossref lookups were skipped");
    rerender(<FormatResultPanel formatting={SAMPLE_FORMATTING} />);
    expect(screen.queryByTestId("format-notes")).not.toBeInTheDocument();
  });

  it("says when nothing is left for the authors", () => {
    render(
      <FormatResultPanel
        formatting={{ ...SAMPLE_FORMATTING, authorActions: [], summary: { ...SAMPLE_FORMATTING.summary, needsAuthor: 0 } }}
      />,
    );
    expect(screen.getByTestId("author-actions-empty")).toBeInTheDocument();
    expect(screen.getByTestId("format-summary-chips")).toHaveTextContent("0 items for the authors");
  });
});
