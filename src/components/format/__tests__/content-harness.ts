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
