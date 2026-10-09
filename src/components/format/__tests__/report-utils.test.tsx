/**
 * Unit tests for the pure helpers behind the format-check UI.
 * @vitest-environment jsdom
 */

import { describe, it, expect } from "vitest";
import {
  assembleLetter,
  categoryFromCheckId,
  fileKind,
  groupResults,
  normalizePhrase,
  readJsonResponse,
  requiresWordFile,
  summarize,
} from "../report-utils";
import { SAMPLE_CHECKS, SAMPLE_PREAMBLE, SAMPLE_REPORT, jsonResponse } from "./sample-report";

describe("groupResults", () => {
  it("groups by category in profile order when a catalog is given", () => {
    const groups = groupResults(SAMPLE_REPORT.results, SAMPLE_CHECKS, {});
    expect(groups.map((g) => g.category)).toEqual(["file", "summary", "references", "statements"]);
    expect(groups[0].label).toBe("Main file");
    expect(groups[0].rows[0].definition?.question).toBe("Is the main manuscript file a PDF?");
  });

  it("appends results the catalog does not know under a derived category", () => {
    const extra = { checkId: "figures.scale-bars", status: "pass" as const, summary: "Scale bars present." };
    const groups = groupResults([...SAMPLE_REPORT.results, extra], SAMPLE_CHECKS, {});
    const last = groups[groups.length - 1];
    expect(last.category).toBe("figures");
    expect(last.rows[0].definition).toBeUndefined();
  });

  it("derives categories from check ids and orders them when no catalog exists", () => {
    const groups = groupResults(SAMPLE_REPORT.results, undefined, {});
    expect(groups.map((g) => g.category)).toEqual(["file", "summary", "references", "statements"]);
  });

  it("applies overrides to the effective status and flags the row", () => {
    const groups = groupResults(SAMPLE_REPORT.results, SAMPLE_CHECKS, { "summary.length": { status: "fail" } });
    const row = groups.flatMap((g) => g.rows).find((r) => r.result.checkId === "summary.length");
    expect(row?.status).toBe("fail");
    expect(row?.overridden).toBe(true);
  });
});

describe("categoryFromCheckId", () => {
  it("recognises known category prefixes with several separators", () => {
    expect(categoryFromCheckId("star_methods.krt")).toBe("star_methods");
    expect(categoryFromCheckId("statements-limitations")).toBe("statements");
    expect(categoryFromCheckId("title_page:lead-contact")).toBe("title_page");
    expect(categoryFromCheckId("mystery")).toBe("other");
  });
});

describe("summarize", () => {
  it("counts statuses after overrides and the number of letter items", () => {
    const counts = summarize(SAMPLE_REPORT.results, { "statements.limitations": { status: "fail" } });
    expect(counts).toMatchObject({ total: 4, pass: 1, fail: 3, review: 0, not_applicable: 0, unknown: 0, letterItems: 3 });
  });

  it("returns zeros for a missing result list", () => {
    expect(summarize(undefined, undefined).total).toBe(0);
  });
});

describe("assembleLetter", () => {
  it("joins the preamble with one bullet per failing check in profile order", () => {
    const letter = assembleLetter(SAMPLE_REPORT, SAMPLE_CHECKS, {});
    expect(letter.items.map((i) => i.checkId)).toEqual(["file.word", "references.doi"]);
    expect(letter.text).toBe(
      `${SAMPLE_PREAMBLE}\n\n* Please provide the main document as a modifiable Word file.\n\n* Please add DOIs to all references.`,
    );
  });

  it("reflects overrides: a passing check overridden to fail enters the letter, a fail set to N/A leaves it", () => {
    const letter = assembleLetter(SAMPLE_REPORT, SAMPLE_CHECKS, {
      "summary.length": { status: "fail" },
      "file.word": { status: "not_applicable" },
    });
    expect(letter.items.map((i) => i.checkId)).toEqual(["summary.length", "references.doi"]);
  });

  it("falls back to the result phrase or summary when the catalog lacks a phrase", () => {
    const letter = assembleLetter(SAMPLE_REPORT, undefined, {});
    expect(letter.items[0].text).toBe("Please provide the main document as a modifiable Word file.");
    expect(letter.items[1].text).toBe("0 of 42 references carry a DOI.");
  });

  it("returns only the preamble when nothing fails", () => {
    const letter = assembleLetter(
      SAMPLE_REPORT,
      SAMPLE_CHECKS,
      { "file.word": { status: "pass" }, "references.doi": { status: "pass" } },
    );
    expect(letter.items).toHaveLength(0);
    expect(letter.text).toBe(SAMPLE_PREAMBLE);
  });
});

describe("normalizePhrase", () => {
  it("strips a leading bullet so phrases are not double-bulleted", () => {
    expect(normalizePhrase("* Please fix.")).toBe("Please fix.");
    expect(normalizePhrase("  - Please fix. ")).toBe("Please fix.");
    expect(normalizePhrase("Please fix.")).toBe("Please fix.");
  });
});

describe("readJsonResponse", () => {
  it("parses JSON on success", async () => {
    await expect(readJsonResponse(jsonResponse({ ok: true }))).resolves.toEqual({ ok: true });
  });

  it("surfaces the server error message on a JSON error", async () => {
    await expect(readJsonResponse(jsonResponse({ error: "Unauthorized" }, 401))).rejects.toThrow("Unauthorized");
  });

  it("refuses to parse non-JSON bodies and reports the status", async () => {
    const html = new Response("<html>Sign in</html>", { status: 302, headers: { "content-type": "text/html" } });
    await expect(readJsonResponse(html, "Format check failed")).rejects.toThrow(/Format check failed \(302\)/);
  });
});

describe("file helpers", () => {
  it("detects PDF and Word files by extension or MIME type", () => {
    expect(fileKind(new File([""], "paper.pdf", { type: "application/pdf" }))).toBe("pdf");
    expect(fileKind(new File([""], "paper.docx", { type: "" }))).toBe("docx");
    expect(fileKind(new File([""], "paper.tex", { type: "text/plain" }))).toBe("unknown");
    expect(fileKind(null)).toBe("unknown");
  });

  it("flags iScience as Word-only by slug or profile id", () => {
    expect(requiresWordFile("iscience", undefined)).toBe(true);
    expect(requiresWordFile("cell-reports", "iscience-2026")).toBe(true);
    expect(requiresWordFile("cell-reports", "generic")).toBe(false);
  });
});
