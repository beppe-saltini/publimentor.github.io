import { describe, expect, it } from "vitest";
import { buildAuthorLetter, buildChangeLog } from "../change-log";
import type { FormatPlan } from "../types";

const plan: FormatPlan = {
  profileId: "iscience",
  targetStructureVersion: "1.0.0",
  operations: [
    { id: "op-001", kind: "rename_heading", automatic: true, description: 'Renamed "Abstract" to "Summary".', before: "Abstract", after: "Summary", slotId: "summary" },
    { id: "op-002", kind: "insert_section", automatic: false, description: 'Inserted the missing "Limitations of the Study" section.', slotId: "limitations", needsAuthorInput: "Please include a paragraph entitled Limitations of the study.", checkIds: ["limitations"] },
    { id: "op-003", kind: "add_doi", automatic: true, description: "Reference 1: rebuilt and added the DOI.", before: "1. Doe...", after: "Doe, J. (2021)..." },
    { id: "op-004", kind: "note", automatic: false, description: "Summary too long.", slotId: "summary", needsAuthorInput: "Please shorten the Summary to 150 words or fewer." },
  ],
  references: [
    { index: 1, original: "1. Doe...", formatted: "Doe, J. (2021). ...", doi: "10.1000/x", matched: true, confidence: 0.95, fields: { authors: [] } },
    { index: 2, original: "2. Roe...", formatted: "2. Roe...", matched: false, confidence: 0, fields: { authors: [] } },
  ],
  authorActions: [
    { slotId: "limitations", text: "Please include a paragraph entitled Limitations of the study.", checkIds: ["limitations"] },
    { slotId: "summary", text: "Please shorten the Summary to 150 words or fewer." },
  ],
  stats: { automatic: 2, needsAuthor: 2 },
};

describe("buildChangeLog", () => {
  it("groups operations by automatic vs needs-author and reports reference stats", () => {
    const log = buildChangeLog(plan);
    expect(log).toContain("# Formatting change log — iscience");
    expect(log).toContain("2 change(s) applied automatically; 2 item(s) need the authors.");
    expect(log).toContain("References: 1 of 2 matched on Crossref");
    const autoIdx = log.indexOf("## Applied automatically");
    const manualIdx = log.indexOf("## Needs the authors");
    expect(autoIdx).toBeGreaterThan(-1);
    expect(manualIdx).toBeGreaterThan(autoIdx);
    expect(log.slice(autoIdx, manualIdx)).toContain("### Renamed headings (1)");
    expect(log.slice(autoIdx, manualIdx)).toContain("before: Abstract");
    expect(log.slice(manualIdx)).toContain("### Inserted sections (1)");
    expect(log.slice(manualIdx)).toContain("checks: limitations");
  });

  it("handles an empty plan", () => {
    const log = buildChangeLog({ ...plan, operations: [], references: [], authorActions: [] });
    expect(log).toContain("References: none found.");
    expect(log.match(/- \(nothing\)/g)).toHaveLength(2);
  });
});

describe("buildAuthorLetter", () => {
  it("lists only author actions as * items and closes with the automatic summary", () => {
    const letter = buildAuthorLetter(plan, "Dear authors,\nBefore we can proceed we need the following:");
    expect(letter.startsWith("Dear authors,")).toBe(true);
    const items = letter.split("\n").filter((l) => l.startsWith("* "));
    expect(items).toHaveLength(2);
    expect(letter).not.toContain('Renamed "Abstract"');
    expect(letter).toMatch(/For your convenience we have already renamed and reordered the sections.*rebuilt 1 reference\(s\)/);
  });

  it("says nothing is required when there are no author actions", () => {
    const letter = buildAuthorLetter({ ...plan, authorActions: [], operations: [], references: [] }, "Preamble");
    expect(letter).toContain("* No further information is required");
  });
});
