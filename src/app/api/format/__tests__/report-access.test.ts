import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MANUSCRIPT_ID,
  OTHER_USER_ID,
  USER_ID,
  genericProfile,
  makeFormattedRow,
  makeRow,
  sampleComposedLetter,
  sampleJournal,
  sampleLetter,
  sampleProfile,
  sampleResults,
} from "./fixtures";

const mocks = vi.hoisted(() => ({
  prisma: {
    formatCheckReport: { findMany: vi.fn(), findUnique: vi.fn() },
    journal: { findUnique: vi.fn() },
    manuscript: { findUnique: vi.fn() },
  },
  findAccessibleManuscript: vi.fn(),
  buildLetter: vi.fn(),
  composeAuthorLetter: vi.fn(),
  resolveProfile: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/manuscript-access", () => ({ findAccessibleManuscript: mocks.findAccessibleManuscript }));
vi.mock("../_lib/format-lib", () => ({
  buildLetter: mocks.buildLetter,
  composeAuthorLetter: mocks.composeAuthorLetter,
  letterToDocx: vi.fn(),
  formatManuscript: vi.fn(),
  buildManuscriptModel: vi.fn(),
  runFormatChecks: vi.fn(),
  resolveProfile: mocks.resolveProfile,
  profiles: { iscience: sampleProfile, generic: genericProfile },
}));

import {
  canAccessReport,
  listAccessibleReports,
  mergeOverrides,
  parseOverrides,
  parseResults,
  parseStats,
  regenerateLetterText,
  reportDetailFromRow,
  reportFromRow,
  resolveReportProfile,
  summarize,
} from "../_lib/report-access";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.buildLetter.mockReturnValue(sampleLetter);
  mocks.composeAuthorLetter.mockReturnValue(sampleComposedLetter);
  mocks.resolveProfile.mockReturnValue(sampleProfile);
});

describe("JSON column parsing", () => {
  it("parseResults keeps only objects with a checkId", () => {
    expect(parseResults([...sampleResults, null, "x", { status: "pass" }])).toHaveLength(sampleResults.length);
    expect(parseResults("not an array")).toEqual([]);
  });

  it("parseOverrides drops unknown statuses and empty entries", () => {
    expect(
      parseOverrides({ a: { status: "pass" }, b: { status: "bogus", note: "n" }, c: { status: "bogus" }, d: 5, e: {} })
    ).toEqual({ a: { status: "pass" }, b: { note: "n" } });
    expect(parseOverrides(null)).toEqual({});
    expect(parseOverrides([1])).toEqual({});
  });

  it("parseStats fills defaults from the row", () => {
    expect(parseStats({ wordCount: 10 }, "docx")).toEqual({
      wordCount: 10,
      pageCount: undefined,
      referenceCount: 0,
      figureLegendCount: 0,
      sourceType: "docx",
    });
  });
});

describe("summarize", () => {
  it("counts statuses", () => {
    expect(summarize(sampleResults)).toEqual({ pass: 1, fail: 1, review: 1, not_applicable: 0, unknown: 0, total: 3 });
  });
  it("applies editor overrides before counting", () => {
    expect(summarize(sampleResults, { "file-type": { status: "not_applicable" } })).toMatchObject({
      fail: 0,
      not_applicable: 1,
      total: 3,
    });
  });
});

describe("mergeOverrides", () => {
  it("merges per check and clears entries given as empty objects", () => {
    const merged = mergeOverrides(
      { a: { status: "pass", note: "keep" }, b: { note: "gone" } },
      { a: { note: "new" }, b: {}, c: { status: "fail" } }
    );
    expect(merged).toEqual({ a: { status: "pass", note: "new" }, c: { status: "fail" } });
  });
});

describe("resolveReportProfile", () => {
  it("uses the journal's current profile when the journal exists", async () => {
    mocks.prisma.journal.findUnique.mockResolvedValue(sampleJournal);
    const resolved = await resolveReportProfile(makeRow());
    expect(mocks.resolveProfile).toHaveBeenCalledWith(sampleJournal);
    expect(resolved.journal).toEqual(sampleJournal);
  });

  it("falls back to the stored profile id when the journal is gone", async () => {
    mocks.prisma.journal.findUnique.mockResolvedValue(null);
    const resolved = await resolveReportProfile(makeRow({ profileId: "generic" }));
    expect(resolved.profile.id).toBe("generic");
    expect(resolved.journal).toBeNull();
    expect(mocks.resolveProfile).not.toHaveBeenCalled();
  });

  it("falls back to resolveProfile(null) for an unknown stored profile id", async () => {
    const resolved = await resolveReportProfile(makeRow({ journalId: null, profileId: "retired" }));
    expect(mocks.resolveProfile).toHaveBeenCalledWith(null);
    expect(resolved.profile).toBe(sampleProfile);
  });
});

describe("canAccessReport", () => {
  it("allows the editor who ran the check", async () => {
    expect(await canAccessReport(USER_ID, makeRow())).toBe(true);
    expect(mocks.findAccessibleManuscript).not.toHaveBeenCalled();
  });
  it("denies another user's ad-hoc report", async () => {
    expect(await canAccessReport(OTHER_USER_ID, makeRow())).toBe(false);
  });
  it("allows users who can access the linked manuscript", async () => {
    mocks.findAccessibleManuscript.mockResolvedValue({ id: MANUSCRIPT_ID });
    expect(await canAccessReport(OTHER_USER_ID, makeRow({ manuscriptId: MANUSCRIPT_ID }))).toBe(true);
    expect(mocks.findAccessibleManuscript).toHaveBeenCalledWith(OTHER_USER_ID, MANUSCRIPT_ID);
  });
});

describe("listAccessibleReports", () => {
  it("keeps own reports and reports on accessible manuscripts, newest first, up to the limit", async () => {
    const hidden = "cmanu000000000000000000009";
    mocks.prisma.formatCheckReport.findMany.mockResolvedValue([
      makeRow({ id: "r1", checkedById: USER_ID }),
      makeRow({ id: "r2", checkedById: OTHER_USER_ID, manuscriptId: MANUSCRIPT_ID }),
      makeRow({ id: "r3", checkedById: OTHER_USER_ID, manuscriptId: hidden }),
      makeRow({ id: "r4", checkedById: OTHER_USER_ID, manuscriptId: MANUSCRIPT_ID, overrides: { "file-type": { status: "pass" } } }),
      makeRow({ id: "r5", checkedById: OTHER_USER_ID, manuscriptId: null }),
    ]);
    mocks.findAccessibleManuscript.mockImplementation(async (_u: string, id: string) =>
      id === MANUSCRIPT_ID ? { id } : null
    );

    const reports = await listAccessibleReports(USER_ID, {}, 2);
    expect(reports.map((r) => r.id)).toEqual(["r1", "r2"]);
    // r4's manuscript access is cached; the hidden one was checked once.
    expect(mocks.findAccessibleManuscript).toHaveBeenCalledTimes(1);

    const all = await listAccessibleReports(USER_ID, {});
    expect(all.map((r) => r.id)).toEqual(["r1", "r2", "r4"]);
    expect(all[2].summary).toMatchObject({ fail: 0, pass: 2 });
    expect(all[0].checkedAt).toBe("2026-10-09T10:00:00.000Z");
  });

  it("passes the manuscript/journal filter and the access OR clause to Prisma", async () => {
    mocks.prisma.formatCheckReport.findMany.mockResolvedValue([]);
    await listAccessibleReports(USER_ID, { manuscriptId: MANUSCRIPT_ID, journalId: "j1" });
    const args = mocks.prisma.formatCheckReport.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      manuscriptId: MANUSCRIPT_ID,
      journalId: "j1",
      OR: [{ checkedById: USER_ID }, { manuscriptId: { not: null } }],
    });
    expect(args.orderBy).toEqual({ checkedAt: "desc" });
  });
});

describe("reportDetailFromRow", () => {
  it("rebuilds the report with the stored letter text and override-aware summary", async () => {
    mocks.prisma.journal.findUnique.mockResolvedValue(sampleJournal);
    mocks.prisma.manuscript.findUnique.mockResolvedValue({ title: "DB title", fileName: "db.pdf" });
    const row = makeRow({
      manuscriptId: MANUSCRIPT_ID,
      overrides: { "summary-heading": { status: "pass", note: "ok" } },
      letterText: "Hand-edited letter",
    });

    const detail = await reportDetailFromRow(row);

    expect(mocks.buildLetter).toHaveBeenCalledWith(sampleProfile, sampleResults, {
      "summary-heading": { status: "pass", note: "ok" },
    });
    expect(detail.report.id).toBe(row.id);
    expect(detail.report.letter.items).toEqual(sampleLetter.items);
    expect(detail.report.letter.text).toBe("Hand-edited letter");
    expect(detail.letterText).toBe("Hand-edited letter");
    expect(detail.report.summary).toMatchObject({ pass: 2, review: 0 });
    expect(detail.overrides).toEqual({ "summary-heading": { status: "pass", note: "ok" } });
    expect(detail.manuscript).toEqual({ title: "DB title", wordCount: 5200, pageCount: 40, sourceType: "pdf", fileName: "manuscript.pdf" });
    expect(detail.profile).toMatchObject({ id: "iscience", name: "iScience", version: "2026-10" });
  });

  it("works for ad-hoc reports without a manuscript", async () => {
    mocks.prisma.journal.findUnique.mockResolvedValue(null);
    const detail = await reportDetailFromRow(makeRow({ journalId: null }));
    expect(mocks.prisma.manuscript.findUnique).not.toHaveBeenCalled();
    expect(detail.manuscript.title).toBeUndefined();
    expect(detail.manuscript.fileName).toBe("manuscript.pdf");
  });
});

describe("profile override and formatting helpers", () => {
  it("resolveReportProfile prefers a stored profileOverride that still exists", async () => {
    mocks.prisma.journal.findUnique.mockResolvedValue(sampleJournal);
    const withOverride = await resolveReportProfile({ journalId: sampleJournal.id, profileId: "iscience", profileOverride: "generic" });
    expect(withOverride.profile).toBe(genericProfile);
    expect(withOverride.journal).toEqual(sampleJournal);
    expect(mocks.resolveProfile).not.toHaveBeenCalled();

    // An override that no longer exists in the registry falls back to the journal's profile.
    const stale = await resolveReportProfile({ journalId: sampleJournal.id, profileId: "iscience", profileOverride: "retired" });
    expect(stale.profile).toBe(sampleProfile);
    expect(mocks.resolveProfile).toHaveBeenCalledWith(sampleJournal);
  });

  it("reportFromRow applies override statuses and recomputes the summary", () => {
    const row = makeRow({ letterText: "stored" });
    const report = reportFromRow(row, { "file-type": { status: "not_applicable" }, "title-length": { note: "no status" } }, sampleProfile);
    expect(report.results.find((r) => r.checkId === "file-type")?.status).toBe("not_applicable");
    expect(report.results.find((r) => r.checkId === "title-length")?.status).toBe("pass");
    expect(report.summary).toMatchObject({ fail: 0, not_applicable: 1, pass: 1, review: 1, total: 3 });
    expect(report.letter.text).toBe("stored");
    expect(report.checkedAt).toBe("2026-10-09T10:00:00.000Z");
    expect(report.stats.wordCount).toBe(5200);
  });

  it("regenerateLetterText uses the plain check letter without a plan and the composer with one", () => {
    mocks.buildLetter.mockReturnValue({ ...sampleLetter, text: "check letter" });
    expect(regenerateLetterText(makeRow(), sampleProfile, {})).toBe("check letter");
    expect(mocks.composeAuthorLetter).not.toHaveBeenCalled();

    mocks.composeAuthorLetter.mockReturnValue({ ...sampleComposedLetter, text: "composed" });
    expect(regenerateLetterText(makeFormattedRow(), sampleProfile, { "file-type": { status: "pass" } })).toBe("composed");
    const args = mocks.composeAuthorLetter.mock.calls[0][0];
    expect(args.plan).not.toHaveProperty("layout");
    expect(args.sourceType).toBe("docx");
    expect(args.report.results.find((r: { checkId: string }) => r.checkId === "file-type").status).toBe("pass");
  });
});
