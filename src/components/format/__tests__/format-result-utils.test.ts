/**
 * Pure helpers behind the "Formatted manuscript" panel: grouping operations,
 * labelling kinds, letter download URLs and defensive parsing of the
 * `formatting` block.
 */

import { describe, it, expect } from "vitest";
import {
  clipSnippet,
  groupOperations,
  letterFileHref,
  normalizeFormatting,
  operationKindLabel,
  summaryChipLabels,
} from "../format-result-utils";
import { SAMPLE_FORMATTING } from "./sample-report";

describe("groupOperations", () => {
  it("groups by kind in display order and counts automatic vs author items", () => {
    const groups = groupOperations(SAMPLE_FORMATTING.operations);
    expect(groups.map((g) => g.kind)).toEqual(["rename_heading", "insert_section", "add_doi"]);
    expect(groups[0].label).toBe("Renamed headings");
    expect(groups[0].operations.map((op) => op.id)).toEqual(["op-001", "op-002"]);
    expect(groups[0].automatic).toBe(2);
    expect(groups[1].needsAuthor).toBe(1);
  });

  it("places unknown kinds last with a readable label", () => {
    const groups = groupOperations([
      { id: "a", kind: "future_thing", automatic: true, description: "x" },
      { id: "b", kind: "note", automatic: true, description: "y" },
    ]);
    expect(groups.map((g) => g.kind)).toEqual(["note", "future_thing"]);
    expect(operationKindLabel("future_thing")).toBe("Future thing");
  });

  it("returns an empty list for missing operations", () => {
    expect(groupOperations(undefined)).toEqual([]);
  });
});

describe("clipSnippet", () => {
  it("collapses whitespace and truncates with an ellipsis", () => {
    expect(clipSnippet("a  b\n\nc")).toBe("a b c");
    expect(clipSnippet("x".repeat(300), 20)).toHaveLength(20);
    expect(clipSnippet("x".repeat(300), 20).endsWith("…")).toBe(true);
    expect(clipSnippet(undefined)).toBe("");
  });
});

describe("letterFileHref", () => {
  it("appends format to a URL with or without an existing query string", () => {
    expect(letterFileHref("/api/format/reports/r1/file?kind=letter", "txt")).toBe(
      "/api/format/reports/r1/file?kind=letter&format=txt",
    );
    expect(letterFileHref("/api/format/reports/r1/letter", "docx")).toBe("/api/format/reports/r1/letter?format=docx");
  });

  it("replaces an existing format parameter", () => {
    expect(letterFileHref("/x/file?kind=letter&format=docx", "txt")).toBe("/x/file?kind=letter&format=txt");
  });
});

describe("summaryChipLabels", () => {
  it("pluralises correctly", () => {
    expect(summaryChipLabels({ automatic: 1, needsAuthor: 2, referencesMatched: 3, referencesTotal: 4 })).toEqual({
      automatic: "1 change applied automatically",
      needsAuthor: "2 items for the authors",
      references: "References matched 3/4",
    });
  });
});

describe("normalizeFormatting", () => {
  it("accepts the block itself and a { formatting } wrapper", () => {
    expect(normalizeFormatting(SAMPLE_FORMATTING)).toEqual(SAMPLE_FORMATTING);
    expect(normalizeFormatting({ formatting: SAMPLE_FORMATTING })).toEqual(SAMPLE_FORMATTING);
  });

  it("keeps non-empty string notes and omits the field otherwise", () => {
    expect(normalizeFormatting({ ...SAMPLE_FORMATTING, notes: ["Crossref skipped", "", 42, "  "] })?.notes).toEqual(["Crossref skipped"]);
    expect(normalizeFormatting({ ...SAMPLE_FORMATTING, notes: [] })).not.toHaveProperty("notes");
    expect(normalizeFormatting({ ...SAMPLE_FORMATTING, notes: "nope" })).not.toHaveProperty("notes");
  });

  it("returns null without downloads or for non-objects", () => {
    expect(normalizeFormatting(null)).toBeNull();
    expect(normalizeFormatting(undefined)).toBeNull();
    expect(normalizeFormatting({ summary: {} })).toBeNull();
    expect(normalizeFormatting({ downloads: {} })).toBeNull();
    expect(normalizeFormatting("text")).toBeNull();
  });

  it("fills missing arrays and derives counts from the operations", () => {
    const block = normalizeFormatting({
      downloads: { formatted: "/f" },
      operations: [
        { id: "a", kind: "note", automatic: true, description: "done" },
        { kind: "insert_section", automatic: false, description: "todo" },
        "garbage",
      ],
      authorActions: [{ text: "Please do X" }, { text: "" }],
    });
    expect(block).not.toBeNull();
    expect(block!.operations).toHaveLength(2);
    expect(block!.operations[1].id).toBe("op-2");
    expect(block!.authorActions).toEqual([{ text: "Please do X", checkIds: undefined, origin: "plan" }]);
    expect(block!.summary).toEqual({ automatic: 1, needsAuthor: 1, referencesMatched: 0, referencesTotal: 0 });
    expect(block!.letter.items).toEqual(block!.authorActions);
    expect(block!.letter.text).toBe("");
    expect(block!.downloads.tracked).toBeUndefined();
  });
});
