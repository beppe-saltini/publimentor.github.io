/**
 * Shared fetch harness for the FormatCheckContent tests: a route table over a
 * stubbed global fetch, request recording, and small DOM helpers. The module
 * mocks (sonner, ManuscriptSelector) stay in each test file because vi.mock
 * is hoisted per file.
 */

import { expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";
import { SAMPLE_PROFILES, jsonResponse } from "./sample-report";

export type FetchCall = { url: string; init?: RequestInit };

/** Every request made since the last installFetch, in order. */
export const calls: FetchCall[] = [];

export interface RouteTable {
  check?: (init?: RequestInit) => Response;
  checkManuscript?: (init?: RequestInit) => Response;
  /**
   * POST /api/format/upload-init. Defaults to the "no Supabase storage" 400,
   * which makes the client post the file as multipart (the path most tests
   * assert on); return UPLOAD_INIT_RESPONSE to exercise the direct upload.
   */
  uploadInit?: (init?: RequestInit) => Response;
  reports?: (url: string) => Response;
  report?: (id: string, init?: RequestInit) => Response;
  /** POST /api/format/reports/[id]/format */
  format?: (id: string, init?: RequestInit) => Response;
  /** GET /api/format/profiles; defaults to SAMPLE_PROFILES. */
  profiles?: () => Response;
}

/** Routes whose response must wait until the test releases them. */
const held = new Map<string, Promise<void>>();

/**
 * Keep the response of `url` pending until the returned function is called,
 * so in-flight UI (progress stages, disabled buttons) can be asserted.
 */
export function holdRoute(url: string): () => void {
  let release: () => void = () => {};
  held.set(
    url,
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  return () => {
    release();
    held.delete(url);
  };
}

export function installFetch(routes: RouteTable) {
  calls.length = 0;
  held.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, init });
      const gate = held.get(url);
      if (gate) await gate;
      if (url.startsWith("/api/journals/")) return jsonResponse({ journal: { name: "Sample Journal" } });
      if (url === "/api/format/profiles") return routes.profiles?.() ?? jsonResponse({ profiles: SAMPLE_PROFILES });
      if (url === "/api/format/upload-init") {
        return routes.uploadInit?.(init) ?? jsonResponse({ error: "direct upload needs Supabase storage" }, 400);
      }
      if (url === "/api/format/check") return routes.check?.(init) ?? jsonResponse({ error: "no route" }, 500);
      if (url === "/api/format/check-manuscript") {
        return routes.checkManuscript?.(init) ?? jsonResponse({ error: "no route" }, 500);
      }
      if (url.startsWith("/api/format/reports?")) return routes.reports?.(url) ?? jsonResponse({ reports: [] });
      const formatMatch = url.match(/^\/api\/format\/reports\/([^/?]+)\/format$/);
      if (formatMatch) return routes.format?.(formatMatch[1], init) ?? jsonResponse({ error: "no route" }, 500);
      const match = url.match(/^\/api\/format\/reports\/([^/?]+)$/);
      if (match) return routes.report?.(match[1], init) ?? jsonResponse({ error: "not found" }, 404);
      return jsonResponse({ error: `unexpected ${url}` }, 500);
    }),
  );
}

export function pdfFile(name = "sample-manuscript.pdf") {
  return new File(["%PDF-1.4"], name, { type: "application/pdf" });
}

export function docxFile(name = "sample.docx") {
  return new File(["PK"], name, {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

export const RUN_LABEL = { format: "Check & format", check: "Check only" } as const;

type User = ReturnType<typeof userEvent.setup>;

/** Upload a PDF, press the run button for `mode` and wait for the report. */
export async function runWithUpload(user: User, mode: keyof typeof RUN_LABEL = "format") {
  await user.upload(screen.getByTestId("format-file-input"), pdfFile());
  expect(screen.getByTestId("selected-file")).toHaveTextContent("sample-manuscript.pdf");
  await user.click(screen.getByRole("button", { name: RUN_LABEL[mode] }));
  await screen.findByTestId("summary-bar");
}

/** The multipart body of the last POST /api/format/check. */
export function multipartBody(): FormData {
  const post = [...calls].reverse().find((c) => c.url === "/api/format/check");
  expect(post?.init?.method).toBe("POST");
  const body = post?.init?.body as FormData;
  expect(body).toBeInstanceOf(FormData);
  return body;
}

export function letterBox(): HTMLTextAreaElement {
  return screen.getByLabelText("Letter text") as HTMLTextAreaElement;
}

export function profileSelect(): HTMLSelectElement {
  return screen.getByLabelText("Journal requirements") as HTMLSelectElement;
}

// ------------------------------------------------------------------
// Direct upload (POST /api/format/upload-init + XHR PUT to the signed URL)
// ------------------------------------------------------------------

export const UPLOAD_PATH = "format-reports/uploads/user_1/6f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b/source.pdf";
export const SIGNED_URL = "https://storage.test/upload/sign/manuscripts/source.pdf?token=t0k";

/** A successful upload-init answer for a PDF. */
export function uploadInitResponse() {
  return jsonResponse({
    uploadPath: UPLOAD_PATH,
    signedUrl: SIGNED_URL,
    token: "t0k",
    headers: { "Content-Type": "application/pdf", "x-upsert": "false" },
  });
}

export interface XhrRecord {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Every XHR sent since the last installXhr, in order. */
export const xhrRequests: XhrRecord[] = [];

export interface XhrOptions {
  /** Final HTTP status reported by onload (default 200). */
  status?: number;
  /** Fire onerror instead of onload. */
  networkError?: boolean;
  /** Report 50 % progress right away but wait for the returned release() before finishing. */
  hold?: boolean;
}

/**
 * Replace XMLHttpRequest with a recorder that reports progress (50 %, then
 * 100 %) and completes with `status`. Returns the release function for
 * `hold: true` (a no-op otherwise).
 */
export function installXhr(options: XhrOptions = {}): () => void {
  xhrRequests.length = 0;
  let release: () => void = () => {};
  const gate = options.hold ? new Promise<void>((resolve) => (release = resolve)) : Promise.resolve();

  class FakeXMLHttpRequest {
    status = 0;
    upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    private record: XhrRecord = { method: "", url: "", headers: {}, body: undefined };

    open(method: string, url: string) {
      this.record.method = method;
      this.record.url = url;
    }

    setRequestHeader(name: string, value: string) {
      this.record.headers[name] = value;
    }

    send(body: unknown) {
      this.record.body = body;
      xhrRequests.push(this.record);
      const progress = (loaded: number) =>
        this.upload.onprogress?.({ lengthComputable: true, loaded, total: 100 } as ProgressEvent);
      void Promise.resolve()
        .then(() => progress(50))
        .then(() => gate)
        .then(() => {
          progress(100);
          if (options.networkError) {
            this.onerror?.();
            return;
          }
          this.status = options.status ?? 200;
          this.onload?.();
        });
    }
  }

  vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
  return () => release();
}

/** The parsed JSON body of the last request to `url`. */
export function jsonBody(url: string): Record<string, unknown> {
  const post = [...calls].reverse().find((c) => c.url === url);
  expect(post?.init?.method).toBe("POST");
  expect(post?.init?.body).toEqual(expect.any(String));
  return JSON.parse(post?.init?.body as string) as Record<string, unknown>;
}
