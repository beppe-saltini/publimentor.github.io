import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  REPORT_ID,
  sampleComposedLetter,
  sampleFormatResult,
  sampleModel,
  samplePlan,
  sampleProfile,
  sampleReport,
} from "./fixtures";

const mocks = vi.hoisted(() => ({
  formatManuscript: vi.fn(),
  composeAuthorLetter: vi.fn(),
  putObject: vi.fn(),
}));

vi.mock("../_lib/format-lib", () => ({
  formatManuscript: mocks.formatManuscript,
  composeAuthorLetter: mocks.composeAuthorLetter,
  buildLetter: vi.fn(),
  letterToDocx: vi.fn(),
  buildManuscriptModel: vi.fn(),
  runFormatChecks: vi.fn(),
  resolveProfile: vi.fn(),
  profiles: {},
}));
vi.mock("../_lib/format-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../_lib/format-storage")>()),
  putObject: mocks.putObject,
}));

import {
  MIN_REPAIR_BUDGET_MS,
  REFERENCE_LOOKUP_CAP,
  ROUTE_BUDGET_MS,
  downloadsFor,
  formattingBlockFromPlan,
  parseStoredPlan,
  repairDecision,
  runFormatting,
  storeSource,
  stripLayout,
  summaryFromPlan,
} from "../_lib/run-format";

const modelWithRefs = (count: number) =>
  ({ ...sampleModel, references: { entries: Array.from({ length: count }, (_, i) => ({ index: i + 1, raw: `Ref ${i + 1}` })) } }) as typeof sampleModel;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.putObject.mockResolvedValue(undefined);
  mocks.formatManuscript.mockResolvedValue(sampleFormatResult());
  mocks.composeAuthorLetter.mockReturnValue(sampleComposedLetter);
});

describe("pure helpers", () => {
  it("downloadsFor builds the file-route URLs and only lists tracked when present", () => {
    expect(downloadsFor(REPORT_ID, false)).toEqual({
      formatted: `/api/format/reports/${REPORT_ID}/file?kind=formatted`,
      changeLog: `/api/format/reports/${REPORT_ID}/file?kind=change-log`,
      letter: `/api/format/reports/${REPORT_ID}/file?kind=letter`,
    });
    expect(downloadsFor(REPORT_ID, true).tracked).toBe(`/api/format/reports/${REPORT_ID}/file?kind=tracked`);
  });

  it("summaryFromPlan counts operations and matched references", () => {
    expect(summaryFromPlan(samplePlan)).toEqual({ automatic: 1, needsAuthor: 1, referencesMatched: 1, referencesTotal: 2 });
    const noStats = { ...samplePlan, stats: undefined } as unknown as typeof samplePlan;
    expect(summaryFromPlan(noStats)).toMatchObject({ automatic: 1, needsAuthor: 1 });
  });

  it("stripLayout drops the layout and keeps everything else", () => {
    const stripped = stripLayout(samplePlan);
    expect(stripped).not.toHaveProperty("layout");
    expect(stripped.operations).toBe(samplePlan.operations);
  });

  it("parseStoredPlan accepts a stored plan and rejects garbage", () => {
    const stored = JSON.parse(JSON.stringify(stripLayout(samplePlan)));
    expect(parseStoredPlan(stored)).toEqual(stored);
    expect(parseStoredPlan(null)).toBeNull();
    expect(parseStoredPlan("plan")).toBeNull();
    expect(parseStoredPlan({ profileId: "x" })).toBeNull();
    expect(parseStoredPlan({ profileId: "x", operations: [] })).toMatchObject({ references: [], authorActions: [], stats: { automatic: 0, needsAuthor: 0 } });
  });

  it("repairDecision honours the explicit flag, the reference cap and the time budget", () => {
    expect(repairDecision({ model: modelWithRefs(10) })).toEqual({ repair: true });
    expect(repairDecision({ model: modelWithRefs(10), repairReferences: false })).toEqual({ repair: false });
    const capped = repairDecision({ model: modelWithRefs(REFERENCE_LOOKUP_CAP + 1) });
    expect(capped.repair).toBe(false);
    expect(capped.note).toMatch(new RegExp(`${REFERENCE_LOOKUP_CAP}-entry`));
    const late = repairDecision({ model: modelWithRefs(10), elapsedMs: ROUTE_BUDGET_MS - MIN_REPAIR_BUDGET_MS + 1 });
    expect(late.repair).toBe(false);
    expect(late.note).toMatch(/not enough time/);
    expect(repairDecision({ model: { ...sampleModel, references: undefined } as unknown as typeof sampleModel })).toEqual({ repair: true });
  });
});

describe("formattingBlockFromPlan", () => {
  it("recomposes the letter with the stored plan and keeps the hand-edited text", () => {
    const block = formattingBlockFromPlan({
      reportId: REPORT_ID,
      plan: stripLayout(samplePlan),
      report: sampleReport,
      profile: sampleProfile,
      sourceType: "docx",
      hasTracked: true,
      letterText: "Edited by the editor",
      formattedAt: new Date("2026-10-09T10:05:00.000Z"),
    });
    expect(mocks.composeAuthorLetter).toHaveBeenCalledWith({ plan: stripLayout(samplePlan), report: sampleReport, profile: sampleProfile, sourceType: "docx" });
    expect(block.letter).toEqual({ ...sampleComposedLetter, text: "Edited by the editor" });
    expect(block.summary).toEqual({ automatic: 1, needsAuthor: 1, referencesMatched: 1, referencesTotal: 2 });
    expect(block.operations).toEqual(samplePlan.operations);
    // Plan actions carry their origin; this one matches a "plan" letter item.
    expect(block.authorActions).toEqual([{ slotId: "lead_contact", text: "Please name a lead contact.", origin: "plan" }]);
    expect(block.downloads.tracked).toBeDefined();
    expect(block.formattedAt).toBe("2026-10-09T10:05:00.000Z");
    expect(block.notes).toBeUndefined();
  });

  it("uses the composed text when no stored letter is given", () => {
    const block = formattingBlockFromPlan({ reportId: REPORT_ID, plan: samplePlan, report: sampleReport, profile: sampleProfile, sourceType: "pdf", hasTracked: false, notes: ["n"] });
    expect(block.letter.text).toBe(sampleComposedLetter.text);
    expect(block.notes).toEqual(["n"]);
    expect(block.downloads.tracked).toBeUndefined();
  });
});

describe("storeSource / runFormatting", () => {
  it("stores the source under format-reports/{id}/source.{ext} with its MIME type", async () => {
    const key = await storeSource(REPORT_ID, Buffer.from("%PDF"), "pdf");
    expect(key).toBe(`format-reports/${REPORT_ID}/source.pdf`);
    expect(mocks.putObject).toHaveBeenCalledWith(key, expect.any(Buffer), "application/pdf");
  });

  it("runs the engine for a PDF source (no tracked output) and returns block + row data", async () => {
    const result = await runFormatting({
      reportId: REPORT_ID,
      model: modelWithRefs(2),
      profile: sampleProfile,
      report: sampleReport,
      sourceBuffer: Buffer.from("%PDF"),
      fileType: "pdf",
      journalName: "iScience",
      elapsedMs: 1000,
    });

    expect(mocks.formatManuscript).toHaveBeenCalledWith({
      model: modelWithRefs(2),
      profile: sampleProfile,
      report: sampleReport,
      sourceBuffer: undefined,
      journalName: "iScience",
      repairReferences: true,
    });
    expect(mocks.putObject).toHaveBeenCalledTimes(1);
    expect(mocks.putObject).toHaveBeenCalledWith(`format-reports/${REPORT_ID}/formatted.docx`, expect.any(Buffer), expect.stringContaining("wordprocessingml"));

    expect(result.block.summary).toEqual({ automatic: 1, needsAuthor: 1, referencesMatched: 1, referencesTotal: 2 });
    expect(result.block.letter).toEqual(sampleComposedLetter);
    expect(result.block.downloads.tracked).toBeUndefined();
    expect(result.block.authorActions[0]).toMatchObject({ origin: "plan" });
    expect(result.block.formattedAt).toBeDefined();

    expect(result.data).toMatchObject({
      sourcePath: `format-reports/${REPORT_ID}/source.pdf`,
      formattedPath: `format-reports/${REPORT_ID}/formatted.docx`,
      trackedPath: null,
      changeLogText: expect.stringContaining("change log"),
      letterText: sampleComposedLetter.text,
    });
    expect(result.data.formattedAt).toBeInstanceOf(Date);
    // The persisted plan has no layout and survives the Json round trip.
    expect(result.data.formatPlan).not.toHaveProperty("layout");
    expect((result.data.formatPlan as { operations: unknown[] }).operations).toHaveLength(2);
  });

  it("passes the original bytes for a docx source and stores the tracked document", async () => {
    mocks.formatManuscript.mockResolvedValue(sampleFormatResult({ tracked: true }));
    const source = Buffer.from("PK\u0003\u0004original");
    const result = await runFormatting({
      reportId: REPORT_ID,
      model: { ...modelWithRefs(2), sourceType: "docx" },
      profile: sampleProfile,
      report: sampleReport,
      sourceBuffer: source,
      fileType: "docx",
      journalName: "iScience",
    });
    expect(mocks.formatManuscript.mock.calls[0][0].sourceBuffer).toBe(source);
    expect(mocks.putObject).toHaveBeenCalledWith(`format-reports/${REPORT_ID}/tracked.docx`, expect.any(Buffer), expect.any(String));
    expect(result.data.trackedPath).toBe(`format-reports/${REPORT_ID}/tracked.docx`);
    expect(result.block.downloads.tracked).toBe(`/api/format/reports/${REPORT_ID}/file?kind=tracked`);
  });

  it("formats references offline above the lookup cap and says so in notes", async () => {
    const result = await runFormatting({
      reportId: REPORT_ID,
      model: modelWithRefs(REFERENCE_LOOKUP_CAP + 5),
      profile: sampleProfile,
      report: sampleReport,
      sourceBuffer: Buffer.from("%PDF"),
      fileType: "pdf",
      journalName: "iScience",
    });
    expect(mocks.formatManuscript.mock.calls[0][0].repairReferences).toBe(false);
    expect(result.block.notes?.[0]).toMatch(/Crossref lookup cap/);
  });

  it("propagates engine failures (the caller decides how to report them)", async () => {
    mocks.formatManuscript.mockRejectedValue(new Error("engine down"));
    await expect(
      runFormatting({ reportId: REPORT_ID, model: sampleModel, profile: sampleProfile, report: sampleReport, sourceBuffer: Buffer.from("x"), fileType: "pdf", journalName: "J" })
    ).rejects.toThrow("engine down");
    expect(mocks.putObject).not.toHaveBeenCalled();
  });
});
