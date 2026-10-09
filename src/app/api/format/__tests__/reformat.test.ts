import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OTHER_USER_ID,
  REPORT_ID,
  USER_ID,
  genericProfile,
  jsonRequest,
  makeFormattedRow,
  makeRow,
  params,
  sampleComposedLetter,
  sampleFormatResult,
  sampleJournal,
  sampleLetter,
  sampleModel,
  sampleProfile,
  sampleResults,
} from "./fixtures";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  checkRateLimit: vi.fn(),
  prisma: {
    journal: { findUnique: vi.fn() },
    manuscript: { findUnique: vi.fn() },
    formatCheckReport: { findUnique: vi.fn(), update: vi.fn() },
  },
  findAccessibleManuscript: vi.fn(),
  buildLetter: vi.fn(),
  composeAuthorLetter: vi.fn(),
  formatManuscript: vi.fn(),
  buildManuscriptModel: vi.fn(),
  resolveProfile: vi.fn(),
  getObject: vi.fn(),
  putObject: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/security", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/security")>()),
  checkRateLimit: mocks.checkRateLimit,
}));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/manuscript-access", () => ({ findAccessibleManuscript: mocks.findAccessibleManuscript }));
vi.mock("../_lib/format-lib", () => ({
  buildLetter: mocks.buildLetter,
  composeAuthorLetter: mocks.composeAuthorLetter,
  formatManuscript: mocks.formatManuscript,
  buildManuscriptModel: mocks.buildManuscriptModel,
  resolveProfile: mocks.resolveProfile,
  letterToDocx: vi.fn(),
  runFormatChecks: vi.fn(),
  profiles: { iscience: sampleProfile, generic: genericProfile },
}));
vi.mock("../_lib/format-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../_lib/format-storage")>()),
  getObject: mocks.getObject,
  putObject: mocks.putObject,
}));

import { ObjectNotFoundError } from "../_lib/format-storage";
import { POST, dynamic, maxDuration } from "../reports/[id]/format/route";

const URL = `http://localhost/api/format/reports/${REPORT_ID}/format`;
const post = (body?: unknown) => POST(jsonRequest(URL, "POST", body), params(REPORT_ID));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.auth.mockResolvedValue({ user: { id: USER_ID } });
  mocks.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetIn: 60_000 });
  mocks.prisma.journal.findUnique.mockResolvedValue(sampleJournal);
  mocks.prisma.formatCheckReport.findUnique.mockResolvedValue(makeFormattedRow());
  mocks.prisma.formatCheckReport.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...makeFormattedRow(),
    ...data,
  }));
  mocks.buildLetter.mockReturnValue(sampleLetter);
  mocks.composeAuthorLetter.mockReturnValue(sampleComposedLetter);
  mocks.formatManuscript.mockResolvedValue(sampleFormatResult({ tracked: true }));
  mocks.buildManuscriptModel.mockResolvedValue({ ...sampleModel, sourceType: "docx", fileName: "manuscript.docx" });
  mocks.resolveProfile.mockReturnValue(sampleProfile);
  mocks.getObject.mockResolvedValue(Buffer.from("PK\u0003\u0004source"));
  mocks.putObject.mockResolvedValue(undefined);
});

describe("POST /api/format/reports/[id]/format", () => {
  it("declares the Next.js route config", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(maxDuration).toBe(300);
  });

  it("guards: 401, 429, 400 id, 400 body, 400 unknown profile, 404, 403", async () => {
    mocks.auth.mockResolvedValueOnce(null);
    expect((await post()).status).toBe(401);
    mocks.checkRateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, resetIn: 10_000 });
    expect((await post()).status).toBe(429);
    expect((await POST(jsonRequest(URL, "POST"), params("bad id"))).status).toBe(400);
    expect((await POST(new Request(URL, { method: "POST", body: "{not json" }), params(REPORT_ID))).status).toBe(400);
    expect((await post({ profileId: "nope" })).status).toBe(400);
    expect((await post({ repairReferences: "yes" })).status).toBe(400);
    mocks.prisma.formatCheckReport.findUnique.mockResolvedValueOnce(null);
    expect((await post()).status).toBe(404);
    mocks.auth.mockResolvedValueOnce({ user: { id: OTHER_USER_ID } });
    expect((await post()).status).toBe(403);
    expect(mocks.formatManuscript).not.toHaveBeenCalled();
  });

  it("answers 409 when no source is stored or the stored object is gone", async () => {
    mocks.prisma.formatCheckReport.findUnique.mockResolvedValueOnce(makeRow());
    const noSource = await post();
    expect(noSource.status).toBe(409);
    expect((await noSource.json()).error).toMatch(/No source file/);

    mocks.getObject.mockRejectedValueOnce(new ObjectNotFoundError("k"));
    expect((await post()).status).toBe(409);
    expect(mocks.formatManuscript).not.toHaveBeenCalled();
  });

  it("answers 422 when the stored source cannot be parsed", async () => {
    mocks.buildManuscriptModel.mockRejectedValueOnce(new Error("bad zip"));
    expect((await post()).status).toBe(422);
    expect(mocks.prisma.formatCheckReport.update).not.toHaveBeenCalled();
  });

  it("re-parses the stored source, re-runs the engine with overrides applied and replaces the stored output", async () => {
    mocks.prisma.formatCheckReport.findUnique.mockResolvedValue(
      makeFormattedRow({ overrides: { "file-type": { status: "not_applicable" } }, letterText: "old letter" })
    );
    // Empty body: same settings as before.
    const response = await POST(new Request(URL, { method: "POST" }), params(REPORT_ID));
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(mocks.getObject).toHaveBeenCalledWith(`format-reports/${REPORT_ID}/source.docx`);
    expect(mocks.buildManuscriptModel).toHaveBeenCalledWith({
      buffer: expect.any(Buffer),
      fileName: "manuscript.docx",
      mimeType: expect.stringContaining("wordprocessingml"),
    });

    // The engine sees the stored results with the editor's override applied, and the docx bytes for tracking.
    const engineArgs = mocks.formatManuscript.mock.calls[0][0];
    expect(engineArgs.profile).toBe(sampleProfile);
    expect(engineArgs.journalName).toBe("iScience");
    expect(engineArgs.sourceBuffer).toBeInstanceOf(Buffer);
    expect(engineArgs.repairReferences).toBe(true);
    const fileType = engineArgs.report.results.find((r: { checkId: string }) => r.checkId === "file-type");
    expect(fileType.status).toBe("not_applicable");
    expect(engineArgs.report.results).toHaveLength(sampleResults.length);

    // Files replaced in place, row updated with the new plan, paths, change log and letter.
    expect(mocks.putObject).toHaveBeenCalledWith(`format-reports/${REPORT_ID}/formatted.docx`, expect.any(Buffer), expect.any(String));
    expect(mocks.putObject).toHaveBeenCalledWith(`format-reports/${REPORT_ID}/tracked.docx`, expect.any(Buffer), expect.any(String));
    const update = mocks.prisma.formatCheckReport.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: REPORT_ID });
    expect(update.data).toMatchObject({
      formattedPath: `format-reports/${REPORT_ID}/formatted.docx`,
      trackedPath: `format-reports/${REPORT_ID}/tracked.docx`,
      letterText: sampleComposedLetter.text,
      profileOverride: null,
    });
    expect(update.data.formatPlan).not.toHaveProperty("layout");
    expect(update.data.formattedAt).toBeInstanceOf(Date);

    // Response is the report detail with the fresh formatting block.
    expect(body.report.id).toBe(REPORT_ID);
    expect(body.formatting.summary).toEqual({ automatic: 1, needsAuthor: 1, referencesMatched: 1, referencesTotal: 2 });
    expect(body.formatting.downloads.tracked).toBe(`/api/format/reports/${REPORT_ID}/file?kind=tracked`);
    expect(body.letterText).toBe(sampleComposedLetter.text);
    expect(body.canFormat).toBe(true);
  });

  it("switches to an explicit profile, stores it as profileOverride and honours repairReferences=false", async () => {
    const response = await post({ profileId: "generic", repairReferences: false });
    expect(response.status).toBe(200);
    expect(mocks.formatManuscript.mock.calls[0][0].profile).toBe(genericProfile);
    expect(mocks.formatManuscript.mock.calls[0][0].repairReferences).toBe(false);
    expect(mocks.prisma.formatCheckReport.update.mock.calls[0][0].data.profileOverride).toBe("generic");
    expect((await response.json()).profile.id).toBe("generic");
  });

  it("keeps a previously stored profileOverride when the body does not name one", async () => {
    mocks.prisma.formatCheckReport.findUnique.mockResolvedValue(makeFormattedRow({ profileOverride: "generic" }));
    await post();
    expect(mocks.formatManuscript.mock.calls[0][0].profile).toBe(genericProfile);
    expect(mocks.prisma.formatCheckReport.update.mock.calls[0][0].data.profileOverride).toBe("generic");
  });

  it("returns 500 without leaking details when the engine fails", async () => {
    mocks.formatManuscript.mockRejectedValueOnce(new Error("engine"));
    const response = await post();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to format manuscript" });
    expect(mocks.prisma.formatCheckReport.update).not.toHaveBeenCalled();
  });
});
