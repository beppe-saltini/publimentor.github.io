/**
 * composeAuthorLetter and formatManuscript. The profile is the real iScience
 * profile (its check ids are what check-links.ts maps to); the report is
 * hand-built from a few of its checks so no parser or Claude call is needed.
 */
import mammoth from "mammoth";
import { describe, expect, it } from "vitest";
import type { CheckResult, FormatCheckReport } from "@/lib/format/profile";
import { iscienceProfile } from "@/lib/format/profiles";
import { composeAuthorLetter, formatManuscript, LETTER_NO_ITEMS_LINE, normalizeLetterText, unaddressedFailures } from "../orchestrate";
import { planFormatting } from "../plan";
import { iscienceTarget } from "../target-structures";
import type { FormatPlan } from "../types";
import { buildDocx, STYLES_WITH_HEADINGS } from "./docx-fixture";
import { makeModel } from "./fixtures";

const phraseOf = (id: string) => iscienceProfile.checks.find((c) => c.id === id)!.phrase;

function result(checkId: string, status: CheckResult["status"], summary = ""): CheckResult {
  return { checkId, status, summary, evidence: [], confidence: "high", detector: "rule", letterPhrase: phraseOf(checkId) };
}

function report(results: CheckResult[]): FormatCheckReport {
  return {
    profileId: "iscience",
    profileVersion: iscienceProfile.version,
    checkedAt: "2026-10-09T00:00:00.000Z",
    results,
    summary: { pass: 0, fail: results.length, review: 0, not_applicable: 0, unknown: 0, total: results.length },
    letter: { preamble: iscienceProfile.letterPreamble, items: [], text: "" },
    stats: { wordCount: 1, referenceCount: 0, figureLegendCount: 0, sourceType: "pdf" },
  };
}

/** A minimal plan: one automatic fix (summary heading), one manual item (KRT), one plain action. */
const basePlan: FormatPlan = {
  profileId: "iscience",
  targetStructureVersion: "1.0.0",
  operations: [
    { id: "op-001", kind: "rename_heading", automatic: true, description: 'Renamed "Abstract" to "Summary".', before: "Abstract", after: "Summary", slotId: "summary", checkIds: ["iscience.summary.heading"] },
    { id: "op-002", kind: "prefill_krt", automatic: false, description: "Prefilled the KRT.", slotId: "krt", needsAuthorInput: "Please complete the Key Resources Table.", checkIds: ["iscience.krt.present"] },
    { id: "op-003", kind: "note", automatic: false, description: "No Highlights.", slotId: "highlights", needsAuthorInput: "Please include the Highlights as a separate Word document." },
  ],
  references: [{ index: 1, original: "1. Doe", formatted: "Doe, J. (2021).", doi: "10.1/x", matched: true, confidence: 0.9, fields: { authors: [] } }],
  authorActions: [
    { slotId: "krt", text: "Please complete the Key Resources Table.", checkIds: ["iscience.krt.present"] },
    { slotId: "highlights", text: "Please include the Highlights as a separate Word document." },
  ],
  stats: { automatic: 1, needsAuthor: 2 },
};

describe("composeAuthorLetter", () => {
  const rep = report([
    result("iscience.summary.heading", "fail", "Titled Abstract"), // fixed automatically -> dropped
    result("iscience.krt.present", "fail", "No KRT"), // covered by the engine's own KRT item -> dropped
    result("iscience.summary.framing", "fail", "remains unclear"), // nobody addresses it -> kept
    result("iscience.figures.blot_markers", "fail", "no markers"), // kept
    result("iscience.ethics.vertebrates", "review", "age missing"), // review never enters the letter
    result("iscience.statements.inclusion_diversity", "fail", "missing"), // kept
  ]);

  it("starts with the profile preamble, lists plan actions then unaddressed failing checks in profile order", () => {
    const letter = composeAuthorLetter({ plan: basePlan, report: rep, profile: iscienceProfile, sourceType: "pdf" });
    expect(letter.preamble).toBe(iscienceProfile.letterPreamble);
    expect(letter.items.map((i) => i.origin)).toEqual(["plan", "plan", "check", "check", "check"]);
    expect(letter.items[0].text).toBe("* Please complete the Key Resources Table.");
    expect(letter.items[0].checkIds).toEqual(["iscience.krt.present"]);
    // Profile order: summary.framing (row 6) before figures.blot_markers before statements.inclusion_diversity.
    expect(letter.items.slice(2).map((i) => i.checkIds![0])).toEqual(["iscience.summary.framing", "iscience.figures.blot_markers", "iscience.statements.inclusion_diversity"]);
    for (const item of letter.items) expect(item.text.startsWith("* ")).toBe(true);
    expect(letter.items.some((i) => i.checkIds?.includes("iscience.summary.heading"))).toBe(false);
    expect(letter.items.some((i) => i.checkIds?.includes("iscience.ethics.vertebrates"))).toBe(false);
  });

  it("closes with the automatic-work sentence and assembles the text", () => {
    const letter = composeAuthorLetter({ plan: basePlan, report: rep, profile: iscienceProfile, sourceType: "pdf" });
    expect(letter.closing).toMatch(/^For your convenience we have already renamed and reordered the sections.*rebuilt 1 reference\(s\)/);
    expect(letter.text.startsWith(`${iscienceProfile.letterPreamble}\n\n* Please complete the Key Resources Table.\n* Please include the Highlights`)).toBe(true);
    expect(letter.text.endsWith(letter.closing)).toBe(true);
  });

  it("de-duplicates items by normalized text, ignoring the bullet and spacing", () => {
    const plan: FormatPlan = { ...basePlan, authorActions: [...basePlan.authorActions, { text: "*  please complete the key resources   table." }] };
    const letter = composeAuthorLetter({ plan, report: rep, profile: iscienceProfile, sourceType: "pdf" });
    expect(letter.items.filter((i) => /Key Resources Table\.$/i.test(i.text))).toHaveLength(1);
    expect(normalizeLetterText("*  Please   Fix. ")).toBe("please fix.");
  });

  it("works without a report and falls back to a no-items line", () => {
    const empty: FormatPlan = { ...basePlan, operations: [], references: [], authorActions: [], stats: { automatic: 0, needsAuthor: 0 } };
    const letter = composeAuthorLetter({ plan: empty, profile: iscienceProfile, sourceType: "docx" });
    expect(letter.items).toEqual([]);
    expect(letter.closing).toBe("");
    expect(letter.text).toBe(`${iscienceProfile.letterPreamble}\n\n${LETTER_NO_ITEMS_LINE}`);
    expect(unaddressedFailures(empty, undefined, iscienceProfile)).toEqual([]);
  });

  it("prefers the result's letterPhrase over the check's phrase", () => {
    const custom = report([{ ...result("iscience.summary.framing", "fail"), letterPhrase: "* Custom wording from the editor." }]);
    const letter = composeAuthorLetter({ plan: basePlan, report: custom, profile: iscienceProfile, sourceType: "pdf" });
    expect(letter.items.find((i) => i.origin === "check")!.text).toBe("* Custom wording from the editor.");
  });
});

describe("formatManuscript", () => {
  it("plans, renders the rebuilt document, writes the log and letter, and counts the work (PDF source: no tracked file)", async () => {
    const model = makeModel();
    const rep = report([result("iscience.summary.heading", "fail"), result("iscience.figures.blot_markers", "fail"), result("iscience.file.word", "fail")]);
    const out = await formatManuscript({ model, profile: iscienceProfile, report: rep, journalName: "iScience", repairReferences: false });
    expect(out.rebuilt.kind).toBe("rebuilt");
    expect(out.tracked).toBeUndefined();
    expect(out.warnings).toBeUndefined();
    expect(out.changeLog).toContain("# Formatting change log — iscience");
    expect(out.summary).toEqual({ automatic: out.plan.stats.automatic, needsAuthor: out.plan.stats.needsAuthor, referencesMatched: 0, referencesTotal: 3 });
    expect(out.summary.automatic).toBeGreaterThan(0);
    // The rename and the PDF rebuild settle two of the three failures; the blot markers stay in the letter.
    const checkItems = out.letter.items.filter((i) => i.origin === "check").map((i) => i.checkIds![0]);
    expect(checkItems).toEqual(["iscience.figures.blot_markers"]);
    expect(out.letter.items.some((i) => /separate files with high resolution/.test(i.text))).toBe(true);
    const { value: html } = await mammoth.convertToHtml({ buffer: out.rebuilt.buffer });
    expect(html).toContain("Summary");
    expect(html).toContain("Lead contact");
  });

  it("also returns a tracked-changes document for a .docx source with its bytes", async () => {
    const source = await buildDocx(
      [
        { text: "Abstract", style: "Heading1" },
        { text: "Widgets matter." },
        { text: "Introduction", style: "Heading1" },
        { text: "Widgets have long been studied." },
      ],
      { stylesXml: STYLES_WITH_HEADINGS }
    );
    const model = makeModel({ sourceType: "docx", fileName: "widgets.docx" });
    const out = await formatManuscript({ model, profile: iscienceProfile, sourceBuffer: source, journalName: "iScience", repairReferences: false });
    expect(out.tracked?.kind).toBe("tracked");
    expect(out.tracked?.fileName).toBe("widgets-iscience-tracked.docx");
    expect(out.plan.operations.some((o) => o.topic === "pdf_to_docx")).toBe(false);
  });

  it("keeps the rebuilt document when the tracked pass fails on a corrupt source", async () => {
    const model = makeModel({ sourceType: "docx" });
    const out = await formatManuscript({ model, profile: iscienceProfile, sourceBuffer: Buffer.from("not a zip"), journalName: "iScience", repairReferences: false });
    expect(out.rebuilt.buffer.length).toBeGreaterThan(0);
    expect(out.tracked).toBeUndefined();
    expect(out.warnings?.[0]).toMatch(/Tracked-changes document could not be produced/);
  });

  it("produces the same plan as planFormatting with the same options", async () => {
    const model = makeModel();
    const direct = await planFormatting(model, iscienceTarget, { repairReferences: false });
    const out = await formatManuscript({ model, profile: iscienceProfile, journalName: "iScience", repairReferences: false });
    expect(out.plan.operations.map((o) => o.description)).toEqual(direct.operations.map((o) => o.description));
  });
});
