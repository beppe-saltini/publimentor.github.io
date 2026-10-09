/**
 * End-to-end behaviour of the format-check screen against a mocked API
 * (formatting side): profile picker sending profileId, "Check & format" vs
 * "Check only" flags and progress stages, the formatting panel and the
 * composed letter, rebuilding through POST .../format, and reopening a
 * formatted report.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { FormatCheckContent } from "../format-check-content";
import {
  SAMPLE_CHECKS,
  SAMPLE_FORMAT_RUN_RESPONSE,
  SAMPLE_FORMATTING,
  SAMPLE_FORMATTING_DOCX,
  SAMPLE_PREAMBLE,
  SAMPLE_REPORT,
  SAMPLE_RUN_RESPONSE,
  jsonResponse,
} from "./sample-report";
import {
  calls,
  docxFile,
  holdRoute,
  installFetch,
  letterBox,
  multipartBody,
  pdfFile,
  profileSelect,
  runWithUpload,
} from "./content-harness";

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

describe("FormatCheckContent formatting", () => {
  // ----------------------------------------------------------------
  // Profile picker and run modes
  // ----------------------------------------------------------------

  it("loads the profiles, defaults to the resolved profile and sends the chosen profileId with every run", async () => {
    const user = userEvent.setup();
    installFetch({ check: () => jsonResponse(SAMPLE_FORMAT_RUN_RESPONSE) });
    render(<FormatCheckContent journalSlug="sample-journal" />);

    // Registry loaded; nothing selected before the first run.
    await waitFor(() => expect(screen.getByRole("option", { name: /Other Journal/ })).toBeInTheDocument());
    expect(profileSelect().value).toBe("__journal_default__");
    expect(screen.queryByTestId("profile-version")).not.toBeInTheDocument();

    await runWithUpload(user);
    // The resolved profile becomes the selection and its version is shown.
    expect(profileSelect().value).toBe("sample-journal");
    expect(screen.getByTestId("profile-version")).toHaveTextContent("v2026.1");

    // Pick another profile and run again: it travels as profileId.
    await user.selectOptions(profileSelect(), "other-journal");
    expect(screen.getByTestId("profile-version")).toHaveTextContent("v3.0");
    calls.length = 0;
    await user.click(screen.getByRole("button", { name: "Check & format" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/format/check")).toBe(true));
    expect(multipartBody().get("profileId")).toBe("other-journal");

    // The explicit choice survives the response (which resolved "sample-journal").
    await waitFor(() => expect(screen.getByRole("button", { name: "Check & format" })).toBeEnabled());
    expect(profileSelect().value).toBe("other-journal");
  });

  it("sends profileId and format in the JSON body for stored manuscripts", async () => {
    const user = userEvent.setup();
    installFetch({ checkManuscript: () => jsonResponse(SAMPLE_FORMAT_RUN_RESPONSE) });
    render(<FormatCheckContent journalSlug="sample-journal" />);
    await waitFor(() => expect(screen.getByRole("option", { name: /Other Journal/ })).toBeInTheDocument());
    await user.selectOptions(profileSelect(), "other-journal");
    await user.click(screen.getByRole("button", { name: /Pick manuscript/ }));
    await user.click(screen.getByRole("button", { name: "Check only" }));
    await screen.findByTestId("summary-bar");

    const post = calls.find((c) => c.url === "/api/format/check-manuscript");
    expect(JSON.parse(post?.init?.body as string)).toEqual({
      manuscriptId: "ms_42",
      journalSlug: "sample-journal",
      profileId: "other-journal",
      format: false,
    });
  });

  it("sends format=false for Check only and does not show the formatting stage", async () => {
    const user = userEvent.setup();
    installFetch({ check: () => jsonResponse(SAMPLE_RUN_RESPONSE) });
    // Keep the request pending so the progress stages are observable.
    const release = holdRoute("/api/format/check");

    render(<FormatCheckContent journalSlug="sample-journal" />);
    await user.upload(screen.getByTestId("format-file-input"), pdfFile());
    await user.click(screen.getByRole("button", { name: "Check only" }));

    const progress = await screen.findByTestId("run-progress");
    expect(progress).toHaveTextContent("Parsing manuscript");
    expect(progress).not.toHaveTextContent("Formatting (references on Crossref)");
    expect(screen.getByRole("button", { name: "Running checks…" })).toBeDisabled();

    release();
    await screen.findByTestId("summary-bar");
    expect(multipartBody().get("format")).toBe("false");
    expect(screen.getByTestId("format-result-empty")).toBeInTheDocument();
  });

  it("shows the formatting stage while Check & format is in flight", async () => {
    const user = userEvent.setup();
    installFetch({ check: () => jsonResponse(SAMPLE_FORMAT_RUN_RESPONSE) });
    const release = holdRoute("/api/format/check");

    render(<FormatCheckContent journalSlug="sample-journal" />);
    await user.upload(screen.getByTestId("format-file-input"), pdfFile());
    await user.click(screen.getByRole("button", { name: "Check & format" }));
    const progress = await screen.findByTestId("run-progress");
    expect(progress).toHaveTextContent("Formatting (references on Crossref)");
    expect(screen.getByRole("button", { name: "Checking and formatting…" })).toBeDisabled();
    release();
    await screen.findByTestId("format-result-panel");
  });

  // ----------------------------------------------------------------
  // Formatting panel and composed letter
  // ----------------------------------------------------------------

  it("renders the formatting panel and uses the composed letter when the response has a formatting block", async () => {
    const user = userEvent.setup();
    installFetch({ check: () => jsonResponse(SAMPLE_FORMAT_RUN_RESPONSE) });
    render(<FormatCheckContent journalSlug="sample-journal" />);
    await runWithUpload(user);

    const panel = screen.getByTestId("format-result-panel");
    expect(within(panel).getByTestId("format-summary-chips")).toHaveTextContent("3 changes applied automatically");
    expect(within(panel).getByTestId("download-formatted")).toHaveAttribute("href", SAMPLE_FORMATTING.downloads.formatted);
    // PDF source: no tracked-changes download.
    expect(within(panel).queryByTestId("download-tracked")).not.toBeInTheDocument();
    expect(within(panel).getByTestId("tracked-note")).toBeInTheDocument();

    // The letter is the composed one, and its downloads use the file route.
    expect(letterBox().value).toBe(SAMPLE_FORMATTING.letter.text);
    expect(screen.getByTestId("letter-description")).toHaveTextContent("Composed by the formatter: 2 items");
    expect(screen.getByTestId("download-docx")).toHaveAttribute("href", "/api/format/reports/rep_123/file?kind=letter&format=docx");
    expect(screen.getByTestId("download-txt")).toHaveAttribute("href", "/api/format/reports/rep_123/file?kind=letter&format=txt");
    expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();

    // The editor can still edit and save.
    await user.type(letterBox(), " Kind regards.");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Undo edits" })).toBeInTheDocument();
  });

  it("offers the tracked-changes download for Word sources", async () => {
    const user = userEvent.setup();
    installFetch({
      check: () =>
        jsonResponse({
          ...SAMPLE_FORMAT_RUN_RESPONSE,
          report: { ...SAMPLE_REPORT, stats: { ...SAMPLE_REPORT.stats, sourceType: "docx" } },
          manuscript: { ...SAMPLE_RUN_RESPONSE.manuscript, sourceType: "docx", fileName: "sample.docx" },
          formatting: SAMPLE_FORMATTING_DOCX,
        }),
    });
    render(<FormatCheckContent journalSlug="sample-journal" />);
    await user.upload(screen.getByTestId("format-file-input"), docxFile());
    await user.click(screen.getByRole("button", { name: "Check & format" }));
    await screen.findByTestId("format-result-panel");
    expect(screen.getByTestId("download-tracked")).toHaveAttribute("href", SAMPLE_FORMATTING_DOCX.downloads.tracked);
    expect(screen.queryByTestId("tracked-note")).not.toBeInTheDocument();
  });

  it("rebuilds the formatting through POST .../format and refreshes the panel and the letter", async () => {
    const user = userEvent.setup();
    const rebuilt = {
      ...SAMPLE_FORMATTING,
      summary: { ...SAMPLE_FORMATTING.summary, automatic: 5, referencesMatched: 42 },
      letter: { ...SAMPLE_FORMATTING.letter, text: `${SAMPLE_PREAMBLE}\n\n* Rebuilt item.` },
    };
    let formatBody: unknown = null;
    installFetch({
      check: () => jsonResponse(SAMPLE_FORMAT_RUN_RESPONSE),
      format: (id, init) => {
        expect(id).toBe("rep_123");
        expect(init?.method).toBe("POST");
        formatBody = JSON.parse(init?.body as string);
        return jsonResponse({ formatting: rebuilt });
      },
    });
    render(<FormatCheckContent journalSlug="sample-journal" />);
    await runWithUpload(user);

    // Hand edit, then Rebuild: the fresh composed letter replaces the edit.
    await user.type(letterBox(), " Edited.");
    await user.click(screen.getByRole("button", { name: "Rebuild" }));
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Formatting rebuilt"));
    expect(formatBody).toEqual({ profileId: "sample-journal" });
    expect(screen.getByTestId("format-summary-chips")).toHaveTextContent("5 changes applied automatically");
    expect(screen.getByTestId("format-summary-chips")).toHaveTextContent("References matched 42/42");
    expect(letterBox().value).toBe(`${SAMPLE_PREAMBLE}\n\n* Rebuilt item.`);
    expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();
  });

  it("adopts the full report detail returned by POST .../format (overrides, letter text, profile)", async () => {
    const user = userEvent.setup();
    const composed = `${SAMPLE_PREAMBLE}\n\n* Composed on the server.`;
    installFetch({
      check: () => jsonResponse(SAMPLE_FORMAT_RUN_RESPONSE),
      // The real route answers like GET /api/format/reports/[id].
      format: () =>
        jsonResponse({
          report: SAMPLE_REPORT,
          overrides: { "summary.length": { status: "fail" } },
          letterText: composed,
          manuscript: SAMPLE_RUN_RESPONSE.manuscript,
          profile: SAMPLE_RUN_RESPONSE.profile,
          formatting: { ...SAMPLE_FORMATTING, letter: { ...SAMPLE_FORMATTING.letter, text: composed } },
          canFormat: true,
        }),
    });
    render(<FormatCheckContent journalSlug="sample-journal" />);
    await runWithUpload(user);

    await user.click(screen.getByRole("button", { name: "Rebuild" }));
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Formatting rebuilt"));
    // The server's letter and overrides are now the saved state: nothing is dirty.
    expect(letterBox().value).toBe(composed);
    expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();
    // The override that came back is applied to the checklist row.
    const summaryGroup = screen.getByRole("radiogroup", { name: "Status for: Is the Summary longer than 150 words?" });
    expect(within(summaryGroup).getByRole("radio", { name: "Fail" })).toHaveAttribute("aria-checked", "true");
  });

  it("hides Format now and Rebuild when the reopened report has no stored source file", async () => {
    const user = userEvent.setup();
    installFetch({
      reports: () =>
        jsonResponse({
          reports: [{ id: "rep_legacy", checkedAt: "2026-08-01T09:00:00.000Z", profileId: "sample-journal", summary: { fail: 2 } }],
        }),
      report: (id) =>
        id === "rep_legacy"
          ? jsonResponse({
              report: SAMPLE_REPORT,
              overrides: {},
              letterText: null,
              manuscript: { title: "Legacy manuscript", sourceType: "pdf" },
              profile: SAMPLE_RUN_RESPONSE.profile,
              formatting: null,
              canFormat: false,
            })
          : jsonResponse({ error: "not found" }, 404),
    });
    render(<FormatCheckContent journalSlug="sample-journal" />);
    await user.click(screen.getByRole("button", { name: /Pick manuscript/ }));
    const list = await screen.findByRole("list", { name: "Previous reports" });
    await user.click(within(list).getByRole("button"));

    const empty = await screen.findByTestId("format-result-empty");
    expect(within(empty).queryByRole("button", { name: "Format now" })).not.toBeInTheDocument();
    expect(within(empty).getByTestId("no-source-note")).toHaveTextContent(/not stored/);
    expect(screen.queryByRole("button", { name: "Rebuild" })).not.toBeInTheDocument();
    // The checklist letter still works and can be downloaded from the letter route.
    expect(screen.getByTestId("download-docx")).toHaveAttribute("href", "/api/format/reports/rep_legacy/letter?format=docx");
  });

  it("formats a check-only report on demand from the empty panel", async () => {
    const user = userEvent.setup();
    installFetch({
      check: () => jsonResponse(SAMPLE_RUN_RESPONSE),
      format: () => jsonResponse(SAMPLE_FORMATTING),
    });
    render(<FormatCheckContent journalSlug="sample-journal" />);
    await runWithUpload(user, "check");
    expect(screen.getByTestId("format-result-empty")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Format now" }));
    await screen.findByTestId("format-result-panel");
    expect(calls.some((c) => c.url === "/api/format/reports/rep_123/format" && c.init?.method === "POST")).toBe(true);
    expect(letterBox().value).toBe(SAMPLE_FORMATTING.letter.text);
  });

  it("reports a failed rebuild without losing the current panel", async () => {
    const user = userEvent.setup();
    installFetch({
      check: () => jsonResponse(SAMPLE_FORMAT_RUN_RESPONSE),
      format: () => jsonResponse({ error: "Source file is gone" }, 410),
    });
    render(<FormatCheckContent journalSlug="sample-journal" />);
    await runWithUpload(user);
    await user.click(screen.getByRole("button", { name: "Rebuild" }));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("Source file is gone"));
    expect(screen.getByTestId("format-result-panel")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rebuild" })).toBeEnabled();
  });

  it("restores the formatting panel and download links when reopening a formatted report", async () => {
    const user = userEvent.setup();
    const oldFormatting = {
      ...SAMPLE_FORMATTING,
      downloads: {
        formatted: "/api/format/reports/rep_old/file?kind=formatted",
        changeLog: "/api/format/reports/rep_old/file?kind=change-log",
        letter: "/api/format/reports/rep_old/file?kind=letter",
      },
    };
    installFetch({
      reports: () =>
        jsonResponse({
          reports: [{ id: "rep_old", checkedAt: "2026-09-30T09:00:00.000Z", profileId: "sample-journal", summary: { fail: 2 } }],
        }),
      report: (id) =>
        id === "rep_old"
          ? jsonResponse({
              report: SAMPLE_REPORT,
              overrides: {},
              letterText: oldFormatting.letter.text,
              manuscript: { title: "Reopened manuscript", sourceType: "pdf" },
              profile: { id: "sample-journal", name: "Sample Journal", version: "2026.1", checks: SAMPLE_CHECKS },
              formatting: oldFormatting,
            })
          : jsonResponse({ error: "not found" }, 404),
    });
    render(<FormatCheckContent journalSlug="sample-journal" />);
    await user.click(screen.getByRole("button", { name: /Pick manuscript/ }));
    const list = await screen.findByRole("list", { name: "Previous reports" });
    await user.click(within(list).getByRole("button"));

    const panel = await screen.findByTestId("format-result-panel");
    expect(within(panel).getByTestId("download-formatted")).toHaveAttribute("href", "/api/format/reports/rep_old/file?kind=formatted");
    expect(within(panel).getByTestId("download-change-log")).toHaveAttribute("href", "/api/format/reports/rep_old/file?kind=change-log");
    expect(screen.getByTestId("download-docx")).toHaveAttribute("href", "/api/format/reports/rep_old/file?kind=letter&format=docx");
    expect(letterBox().value).toBe(oldFormatting.letter.text);
    // The stored letter equals the composed one, so nothing is dirty.
    expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();
    // The picker follows the reopened report's profile.
    expect(profileSelect().value).toBe("sample-journal");
  });

  it("keeps working when the profile registry fails to load", async () => {
    const user = userEvent.setup();
    installFetch({
      profiles: () => jsonResponse({ error: "boom" }, 500),
      check: () => jsonResponse(SAMPLE_FORMAT_RUN_RESPONSE),
    });
    render(<FormatCheckContent journalSlug="sample-journal" />);
    await runWithUpload(user);
    // The resolved profile is still offered as an option and selected.
    expect(profileSelect().value).toBe("sample-journal");
    expect(screen.getByRole("option", { name: "Sample Journal (v2026.1)" })).toBeInTheDocument();
  });
});
