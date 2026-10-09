/**
 * End-to-end behaviour of the format-check screen against a mocked API
 * (checker side): upload -> POST /api/format/check (multipart) -> checklist +
 * letter, overrides updating the letter, downloads keyed on the report id,
 * saving, and reopening a previous report. The formatting side lives in
 * format-check-content-formatting.test.tsx.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { FormatCheckContent } from "../format-check-content";
import { SAMPLE_CHECKS, SAMPLE_PREAMBLE, SAMPLE_REPORT, SAMPLE_RUN_RESPONSE, jsonResponse } from "./sample-report";
import { calls, installFetch, letterBox, multipartBody, pdfFile, runWithUpload } from "./content-harness";

// ------------------------------------------------------------------
// Module mocks (hoisted per file)
// ------------------------------------------------------------------

const { mockToast } = vi.hoisted(() => ({
  mockToast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: mockToast }));

// The real ManuscriptSelector talks to several APIs; a stub exposes onChange.
vi.mock("@/components/manuscript", () => ({
  ManuscriptSelector: (props: { onChange: (m: { id: string } | null) => void; value?: string }) => (
    <button type="button" onClick={() => props.onChange({ id: "ms_42" })}>
      Pick manuscript {props.value ?? "(none)"}
    </button>
  ),
}));

beforeEach(() => {
  sessionStorage.clear();
  Object.values(mockToast).forEach((fn) => fn.mockReset());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

describe("FormatCheckContent", () => {
  it("shows the journal, the Word-file note for iScience and an empty state before running", async () => {
    installFetch({});
    render(<FormatCheckContent journalSlug="iscience" />);
    expect(await screen.findByText("Sample Journal")).toBeInTheDocument();
    expect(screen.getByTestId("word-file-note")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check & format" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Check only" })).toBeDisabled();
    expect(screen.queryByTestId("summary-bar")).not.toBeInTheDocument();
  });

  it("posts the upload as multipart to /api/format/check and renders the grouped report", async () => {
    const user = userEvent.setup();
    installFetch({ check: () => jsonResponse(SAMPLE_RUN_RESPONSE) });
    render(<FormatCheckContent journalSlug="sample-journal" />);

    // Progress indicator while the request is in flight is covered by the
    // synchronous state flip; here we assert on the request and the outcome.
    await runWithUpload(user);

    const body = multipartBody();
    expect((body.get("file") as File).name).toBe("sample-manuscript.pdf");
    expect(body.get("journalSlug")).toBe("sample-journal");
    expect(body.get("format")).toBe("true");
    // No explicit profile yet: the server resolves it from the journal.
    expect(body.get("profileId")).toBeNull();

    // Summary bar counts (after no overrides) and letter item count.
    const bar = screen.getByTestId("summary-bar");
    expect(within(bar).getByText("items in the letter").previousSibling).toHaveTextContent("2");
    expect(bar).toHaveTextContent("Sample Journal");
    expect(bar).toHaveTextContent("5,200 words");

    // Grouped checklist in profile order.
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent ?? "");
    expect(headings.map((h) => h.replace(/\s*\(\d+\)$/, ""))).toEqual([
      "Main file",
      "Summary",
      "References",
      "Required statements",
    ]);

    // Letter assembled live from the failing checks.
    expect(letterBox().value).toBe(
      `${SAMPLE_PREAMBLE}\n\n* Please provide the main document as a modifiable Word file.\n\n* Please add DOIs to all references.`,
    );
    // No formatting block in the response: the panel offers to format.
    expect(screen.getByTestId("format-result-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("format-result-panel")).not.toBeInTheDocument();
  });

  it("runs the stored manuscript through /api/format/check-manuscript and remembers the selection", async () => {
    const user = userEvent.setup();
    installFetch({
      checkManuscript: () => jsonResponse(SAMPLE_RUN_RESPONSE),
      reports: () => jsonResponse({ reports: [] }),
    });
    render(<FormatCheckContent journalSlug="sample-journal" />);
    await user.click(screen.getByRole("button", { name: /Pick manuscript/ }));
    expect(sessionStorage.getItem("active_manuscript_id")).toBe("ms_42");
    await user.click(screen.getByRole("button", { name: "Check & format" }));
    await screen.findByTestId("summary-bar");

    const post = calls.find((c) => c.url === "/api/format/check-manuscript");
    expect(JSON.parse(post?.init?.body as string)).toEqual({
      manuscriptId: "ms_42",
      journalSlug: "sample-journal",
      format: true,
    });
  });

  it("updates the letter preview immediately when a status is overridden", async () => {
    const user = userEvent.setup();
    installFetch({ check: () => jsonResponse(SAMPLE_RUN_RESPONSE) });
    render(<FormatCheckContent journalSlug="sample-journal" />);
    await runWithUpload(user);

    // Mark the passing Summary check as Fail -> its phrase appears, in profile order.
    const summaryGroup = screen.getByRole("radiogroup", { name: "Status for: Is the Summary longer than 150 words?" });
    await user.click(within(summaryGroup).getByRole("radio", { name: "Fail" }));
    expect(letterBox().value).toBe(
      `${SAMPLE_PREAMBLE}\n\n* Please provide the main document as a modifiable Word file.\n\n* Please shorten the Summary to 150 words or fewer.\n\n* Please add DOIs to all references.`,
    );

    // Mark the DOI failure as N/A -> it leaves the letter.
    const doiGroup = screen.getByRole("radiogroup", { name: "Status for: Are DOIs missing from the reference list?" });
    await user.click(within(doiGroup).getByRole("radio", { name: "N/A" }));
    expect(letterBox().value).not.toContain("DOIs");
    expect(screen.getByTestId("unsaved-note")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("keeps hand edits until the editor rebuilds the letter from the checklist", async () => {
    const user = userEvent.setup();
    installFetch({ check: () => jsonResponse(SAMPLE_RUN_RESPONSE) });
    render(<FormatCheckContent journalSlug="sample-journal" />);
    await runWithUpload(user);

    await user.type(letterBox(), " Kind regards.");
    expect(letterBox().value).toMatch(/Kind regards\.$/);
    // Overrides no longer rewrite the edited text...
    const doiGroup = screen.getByRole("radiogroup", { name: "Status for: Are DOIs missing from the reference list?" });
    await user.click(within(doiGroup).getByRole("radio", { name: "Pass" }));
    expect(letterBox().value).toContain("DOIs");
    // ...until the editor asks for a rebuild.
    await user.click(screen.getByRole("button", { name: /Rebuild from checklist/ }));
    expect(letterBox().value).not.toContain("DOIs");
  });

  it("builds download links from the report id and saves overrides plus letter text", async () => {
    const user = userEvent.setup();
    let patched: unknown = null;
    installFetch({
      check: () => jsonResponse(SAMPLE_RUN_RESPONSE),
      report: (id, init) => {
        if (init?.method === "PATCH") {
          patched = JSON.parse(init.body as string);
          return jsonResponse({ report: SAMPLE_REPORT, overrides: (patched as { overrides: unknown }).overrides, letterText: (patched as { letterText: string }).letterText, profile: SAMPLE_RUN_RESPONSE.profile });
        }
        return jsonResponse({ error: `unexpected ${id}` }, 500);
      },
    });
    render(<FormatCheckContent journalSlug="sample-journal" />);
    await runWithUpload(user);

    expect(screen.getByTestId("download-docx")).toHaveAttribute("href", "/api/format/reports/rep_123/letter?format=docx");
    expect(screen.getByTestId("download-txt")).toHaveAttribute("href", "/api/format/reports/rep_123/letter?format=txt");
    expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();

    const doiGroup = screen.getByRole("radiogroup", { name: "Status for: Are DOIs missing from the reference list?" });
    await user.click(within(doiGroup).getByRole("radio", { name: "Review" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Report saved"));
    expect(patched).toEqual({
      overrides: { "references.doi": { status: "review" } },
      letterText: `${SAMPLE_PREAMBLE}\n\n* Please provide the main document as a modifiable Word file.`,
    });
    expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();
    expect(screen.queryByTestId("unsaved-note")).not.toBeInTheDocument();
  });

  it("lists previous reports for the selected manuscript and reopens one with its overrides", async () => {
    const user = userEvent.setup();
    installFetch({
      reports: (url) => {
        expect(url).toContain("manuscriptId=ms_42");
        expect(url).toContain("journalSlug=sample-journal");
        return jsonResponse({
          reports: [
            { id: "rep_old", checkedAt: "2026-09-30T09:00:00.000Z", profileId: "sample-journal", summary: { fail: 1 } },
          ],
        });
      },
      report: (id) =>
        id === "rep_old"
          ? jsonResponse({
              report: SAMPLE_REPORT,
              overrides: { "file.word": { status: "not_applicable" } },
              letterText: null,
              manuscript: { title: "Reopened manuscript", wordCount: 5200, sourceType: "pdf" },
              profile: { id: "sample-journal", name: "Sample Journal", version: "2026.1", checks: SAMPLE_CHECKS },
            })
          : jsonResponse({ error: "not found" }, 404),
    });
    render(<FormatCheckContent journalSlug="sample-journal" />);

    await user.click(screen.getByRole("button", { name: /Pick manuscript/ }));
    const list = await screen.findByRole("list", { name: "Previous reports" });
    expect(within(list).getByText("1 fail")).toBeInTheDocument();

    await user.click(within(list).getByRole("button"));
    await screen.findByTestId("summary-bar");

    expect(screen.getByTestId("download-docx")).toHaveAttribute("href", "/api/format/reports/rep_old/letter?format=docx");
    // The saved override (file check set to N/A) is applied: only the DOI item remains.
    expect(letterBox().value).toBe(`${SAMPLE_PREAMBLE}\n\n* Please add DOIs to all references.`);
    const fileGroup = screen.getByRole("radiogroup", { name: "Status for: Is the main manuscript file a PDF?" });
    expect(within(fileGroup).getByRole("radio", { name: "N/A" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("summary-bar")).toHaveTextContent("Reopened manuscript");
  });

  it("reports server errors and non-JSON responses without crashing", async () => {
    const user = userEvent.setup();
    installFetch({
      check: () => new Response("<html>502 Bad Gateway</html>", { status: 502, headers: { "content-type": "text/html" } }),
    });
    render(<FormatCheckContent journalSlug="sample-journal" />);
    await user.upload(screen.getByTestId("format-file-input"), pdfFile());
    await user.click(screen.getByRole("button", { name: "Check & format" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Format check failed \(502\)/);
    expect(screen.queryByTestId("summary-bar")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check & format" })).toBeEnabled();
  });

  it("rejects unsupported file types before running", async () => {
    // user-event honours the accept attribute by default; bypass it to simulate
    // a browser that let an unsupported file through.
    const user = userEvent.setup({ applyAccept: false });
    installFetch({});
    render(<FormatCheckContent journalSlug="sample-journal" />);
    await user.upload(
      screen.getByTestId("format-file-input"),
      new File(["x"], "paper.tex", { type: "text/plain" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/Only PDF/);
    expect(screen.getByRole("button", { name: "Check & format" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Check only" })).toBeDisabled();
  });
});
