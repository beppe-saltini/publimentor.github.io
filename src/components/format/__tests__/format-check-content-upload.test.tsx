/**
 * Direct upload of a chosen file: POST /api/format/upload-init -> XHR PUT to
 * the signed URL (with an "Uploading file" stage) -> POST /api/format/check as
 * JSON with the storage key; multipart fallback when upload-init answers 400;
 * upload and init failures surfacing as run errors.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { FormatCheckContent } from "../format-check-content";
import { SAMPLE_RUN_RESPONSE, jsonResponse } from "./sample-report";
import {
  SIGNED_URL,
  UPLOAD_PATH,
  calls,
  installFetch,
  installXhr,
  jsonBody,
  multipartBody,
  pdfFile,
  profileSelect,
  runWithUpload,
  uploadInitResponse,
  xhrRequests,
} from "./content-harness";

const { mockToast } = vi.hoisted(() => ({
  mockToast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: mockToast }));

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

describe("FormatCheckContent direct upload", () => {
  it("uploads the file to the signed URL and posts the check as JSON with the storage key", async () => {
    const user = userEvent.setup();
    installFetch({ uploadInit: () => uploadInitResponse(), check: () => jsonResponse(SAMPLE_RUN_RESPONSE) });
    installXhr();
    render(<FormatCheckContent journalSlug="sample-journal" />);
    await waitFor(() => expect(screen.getByRole("option", { name: /Other Journal/ })).toBeInTheDocument());
    await user.selectOptions(profileSelect(), "other-journal");
    await user.click(screen.getByRole("button", { name: /Pick manuscript/ }));

    await runWithUpload(user);

    // 1. Metadata only to upload-init.
    expect(jsonBody("/api/format/upload-init")).toEqual({
      fileName: "sample-manuscript.pdf",
      mimeType: "application/pdf",
      size: 8,
    });

    // 2. The bytes go straight to storage with the file's type and no overwrite.
    expect(xhrRequests).toHaveLength(1);
    const put = xhrRequests[0];
    expect(put.method).toBe("PUT");
    expect(put.url).toBe(SIGNED_URL);
    expect(put.headers).toEqual({ "Content-Type": "application/pdf", "x-upsert": "false" });
    expect(put.body).toBeInstanceOf(File);
    expect((put.body as File).name).toBe("sample-manuscript.pdf");

    // 3. The check is a small JSON request naming the uploaded object.
    const check = calls.find((c) => c.url === "/api/format/check");
    expect(check?.init?.headers).toEqual({ "Content-Type": "application/json" });
    expect(check?.init?.body).not.toBeInstanceOf(FormData);
    expect(jsonBody("/api/format/check")).toEqual({
      sourcePath: UPLOAD_PATH,
      fileName: "sample-manuscript.pdf",
      journalSlug: "sample-journal",
      manuscriptId: "ms_42",
      profileId: "other-journal",
      format: true,
    });
    // Order: init, PUT, check.
    const order = calls.map((c) => c.url).filter((u) => u.startsWith("/api/format/upload-init") || u === "/api/format/check");
    expect(order).toEqual(["/api/format/upload-init", "/api/format/check"]);
    expect(screen.getByTestId("summary-bar")).toHaveTextContent("5,200 words");
  });

  it("shows the upload stage with live progress before the check stages", async () => {
    const user = userEvent.setup();
    installFetch({ uploadInit: () => uploadInitResponse(), check: () => jsonResponse(SAMPLE_RUN_RESPONSE) });
    const release = installXhr({ hold: true });
    render(<FormatCheckContent journalSlug="sample-journal" />);
    await user.upload(screen.getByTestId("format-file-input"), pdfFile());
    await user.click(screen.getByRole("button", { name: "Check only" }));

    const progress = await screen.findByTestId("run-progress");
    await waitFor(() => expect(progress).toHaveTextContent("Uploading file (50%)"));
    const uploading = progress.querySelector('[data-state="active"]');
    expect(uploading).toHaveTextContent("Uploading file");
    expect(progress.querySelector('li:nth-child(2)')).toHaveAttribute("data-state", "pending");
    expect(progress).toHaveTextContent("Parsing manuscript");
    // No check request while the bytes are still in flight.
    expect(calls.some((c) => c.url === "/api/format/check")).toBe(false);

    release();
    await screen.findByTestId("summary-bar");
    expect(jsonBody("/api/format/check").format).toBe(false);
  });

  it("falls back to the multipart request when upload-init answers 400 (no direct-upload storage)", async () => {
    const user = userEvent.setup();
    installFetch({ check: () => jsonResponse(SAMPLE_RUN_RESPONSE) }); // default uploadInit: 400
    installXhr();
    render(<FormatCheckContent journalSlug="sample-journal" />);
    await runWithUpload(user);

    expect(calls.some((c) => c.url === "/api/format/upload-init")).toBe(true);
    expect(xhrRequests).toHaveLength(0);
    const body = multipartBody();
    expect((body.get("file") as File).name).toBe("sample-manuscript.pdf");
    expect(body.get("format")).toBe("true");
  });

  it("reports a failed PUT and does not run the check", async () => {
    const user = userEvent.setup();
    installFetch({ uploadInit: () => uploadInitResponse(), check: () => jsonResponse(SAMPLE_RUN_RESPONSE) });
    installXhr({ status: 413 });
    render(<FormatCheckContent journalSlug="sample-journal" />);
    await user.upload(screen.getByTestId("format-file-input"), pdfFile());
    await user.click(screen.getByRole("button", { name: "Check & format" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Upload failed (HTTP 413)");
    expect(calls.some((c) => c.url === "/api/format/check")).toBe(false);
    expect(screen.queryByTestId("summary-bar")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check & format" })).toBeEnabled();
  });

  it("reports a network error during the PUT", async () => {
    const user = userEvent.setup();
    installFetch({ uploadInit: () => uploadInitResponse() });
    installXhr({ networkError: true });
    render(<FormatCheckContent journalSlug="sample-journal" />);
    await user.upload(screen.getByTestId("format-file-input"), pdfFile());
    await user.click(screen.getByRole("button", { name: "Check only" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Network error during upload");
    expect(calls.some((c) => c.url === "/api/format/check")).toBe(false);
  });

  it("surfaces an upload-init failure other than 400 instead of falling back", async () => {
    const user = userEvent.setup();
    installFetch({
      uploadInit: () => jsonResponse({ error: "Too many requests. Please try again later." }, 429),
      check: () => jsonResponse(SAMPLE_RUN_RESPONSE),
    });
    installXhr();
    render(<FormatCheckContent journalSlug="sample-journal" />);
    await user.upload(screen.getByTestId("format-file-input"), pdfFile());
    await user.click(screen.getByRole("button", { name: "Check & format" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Too many requests");
    expect(xhrRequests).toHaveLength(0);
    expect(calls.some((c) => c.url === "/api/format/check")).toBe(false);
  });

  it("shows the check's own error after a successful upload", async () => {
    const user = userEvent.setup();
    installFetch({
      uploadInit: () => uploadInitResponse(),
      check: () => jsonResponse({ error: "The uploaded file does not belong to you" }, 403),
    });
    installXhr();
    render(<FormatCheckContent journalSlug="sample-journal" />);
    await user.upload(screen.getByTestId("format-file-input"), pdfFile());
    await user.click(screen.getByRole("button", { name: "Check & format" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("does not belong to you");
    expect(xhrRequests).toHaveLength(1);
  });
});
