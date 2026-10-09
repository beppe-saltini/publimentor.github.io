import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DOCX_BYTES,
  DOCX_MIME_TYPE,
  JOURNAL_ID,
  MANUSCRIPT_ID,
  OTHER_USER_ID,
  PDF_BYTES,
  REPORT_ID,
  USER_ID,
  genericProfile,
  jsonRequest,
  makeFile,
  multipartRequest,
  sampleComposedLetter,
  sampleFormatResult,
  sampleJournal,
  sampleModel,
  sampleProfile,
  sampleReport,
} from "./fixtures";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  checkRateLimit: vi.fn(),
  prisma: {
    journal: { findUnique: vi.fn() },
    manuscript: { findUnique: vi.fn() },
    formatCheckReport: { create: vi.fn(), update: vi.fn() },
  },
  findAccessibleManuscript: vi.fn(),
  auditLog: vi.fn(),
  buildManuscriptModel: vi.fn(),
  runFormatChecks: vi.fn(),
  resolveProfile: vi.fn(),
  formatManuscript: vi.fn(),
  composeAuthorLetter: vi.fn(),
  putObject: vi.fn(),
  getObject: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/security", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/security")>()),
  checkRateLimit: mocks.checkRateLimit,
}));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/manuscript-access", () => ({ findAccessibleManuscript: mocks.findAccessibleManuscript }));
vi.mock("@/lib/audit", () => ({ auditLogger: { log: mocks.auditLog } }));
vi.mock("../_lib/format-lib", () => ({
  buildManuscriptModel: mocks.buildManuscriptModel,
  runFormatChecks: mocks.runFormatChecks,
  resolveProfile: mocks.resolveProfile,
  formatManuscript: mocks.formatManuscript,
  composeAuthorLetter: mocks.composeAuthorLetter,
  buildLetter: vi.fn(),
  letterToDocx: vi.fn(),
  profiles: { iscience: sampleProfile, generic: genericProfile },
}));
vi.mock("../_lib/format-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../_lib/format-storage")>()),
  putObject: mocks.putObject,
  getObject: mocks.getObject,
}));

import { ObjectNotFoundError } from "../_lib/format-storage";
import { POST, dynamic, maxDuration } from "../check/route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.auth.mockResolvedValue({ user: { id: USER_ID } });
  mocks.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetIn: 60_000 });
  mocks.prisma.journal.findUnique.mockResolvedValue(sampleJournal);
  mocks.prisma.formatCheckReport.create.mockResolvedValue({ id: REPORT_ID });
  mocks.prisma.formatCheckReport.update.mockResolvedValue({ id: REPORT_ID });
  mocks.buildManuscriptModel.mockResolvedValue(sampleModel);
  mocks.runFormatChecks.mockResolvedValue(sampleReport);
  mocks.resolveProfile.mockReturnValue(sampleProfile);
  mocks.formatManuscript.mockResolvedValue(sampleFormatResult());
  mocks.composeAuthorLetter.mockReturnValue(sampleComposedLetter);
  mocks.putObject.mockResolvedValue(undefined);
  mocks.getObject.mockResolvedValue(Buffer.from(PDF_BYTES));
});

const pdfFile = () => makeFile("paper.pdf", PDF_BYTES, "application/pdf");
const docxFile = () => makeFile("paper.docx", DOCX_BYTES, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");

describe("POST /api/format/check", () => {
  it("declares the Next.js route config", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(maxDuration).toBe(300);
  });

  it("returns 401 without a session", async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await POST(multipartRequest({ file: pdfFile() }));
    expect(response.status).toBe(401);
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
  });

  it("returns 429 with Retry-After when the per-user limit is hit", async () => {
    mocks.checkRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetIn: 30_000 });
    const response = await POST(multipartRequest({ file: pdfFile() }));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(`format:${USER_ID}`, { windowMs: 60_000, maxRequests: 10 });
  });

  it("returns 400 when the file is missing", async () => {
    const response = await POST(multipartRequest({ journalSlug: "iscience" }));
    expect(response.status).toBe(400);
  });

  it("returns 400 for an unsupported file type", async () => {
    const response = await POST(multipartRequest({ file: makeFile("main.tex", Buffer.from("\\documentclass"), "text/x-tex") }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/PDF and Word/);
    expect(mocks.buildManuscriptModel).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-multipart body", async () => {
    const response = await POST(new Request("http://localhost/api/format/check", { method: "POST", body: "{}" }));
    expect(response.status).toBe(400);
  });

  it("returns 404 for an unknown journal slug", async () => {
    mocks.prisma.journal.findUnique.mockResolvedValue(null);
    const response = await POST(multipartRequest({ file: pdfFile(), journalSlug: "nope" }));
    expect(response.status).toBe(404);
  });

  it("runs the check, persists the report, audits, and returns the contract shape", async () => {
    const response = await POST(multipartRequest({ file: pdfFile(), journalSlug: "iscience" }));
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.reportId).toBe(REPORT_ID);
    // With formatting on (default) the letter text is the composed one; everything else is the check report.
    expect(body.report).toEqual({ ...sampleReport, letter: { ...sampleReport.letter, text: sampleComposedLetter.text } });
    expect(body.manuscript).toEqual({
      title: sampleModel.title,
      wordCount: 5200,
      pageCount: 40,
      sourceType: "pdf",
      fileName: "manuscript.pdf",
    });
    expect(body.profile).toMatchObject({ id: "iscience", name: "iScience", version: "2026-10" });

    expect(mocks.prisma.journal.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { slug: "iscience" } }));
    expect(mocks.resolveProfile).toHaveBeenCalledWith(sampleJournal);
    expect(mocks.buildManuscriptModel).toHaveBeenCalledWith({
      buffer: expect.any(Buffer),
      fileName: "paper.pdf",
      mimeType: "application/pdf",
    });
    expect(mocks.runFormatChecks).toHaveBeenCalledWith(sampleModel, sampleProfile, { llm: true });

    const created = mocks.prisma.formatCheckReport.create.mock.calls[0][0].data;
    expect(created).toMatchObject({
      manuscriptId: null,
      journalId: JOURNAL_ID,
      profileId: "iscience",
      profileVersion: "2026-10",
      sourceType: "pdf",
      fileName: "paper.pdf",
      letterText: sampleReport.letter.text,
      checkedById: USER_ID,
      profileOverride: null,
    });
    expect(created.results).toEqual(sampleReport.results);
    expect(created.stats).toEqual(sampleReport.stats);

    expect(mocks.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "INTEGRITY_CHECK_PERFORMED",
        category: "COMPLIANCE",
        actorType: "user",
        actorId: USER_ID,
        entityType: "FormatCheckReport",
        entityId: REPORT_ID,
        metadata: expect.objectContaining({ profileId: "iscience", summary: sampleReport.summary }),
      })
    );
  });

  it("falls back to the generic profile when no journal is given", async () => {
    const response = await POST(multipartRequest({ file: pdfFile() }));
    expect(response.status).toBe(200);
    expect(mocks.prisma.journal.findUnique).not.toHaveBeenCalled();
    expect(mocks.resolveProfile).toHaveBeenCalledWith(null);
  });

  it("links the report to an accessible manuscript and borrows its journal", async () => {
    mocks.findAccessibleManuscript.mockResolvedValue({ id: MANUSCRIPT_ID });
    mocks.prisma.manuscript.findUnique.mockResolvedValue({ id: MANUSCRIPT_ID, title: "Library title", journalId: JOURNAL_ID });
    mocks.buildManuscriptModel.mockResolvedValue({ ...sampleModel, title: undefined });

    const response = await POST(multipartRequest({ file: pdfFile(), manuscriptId: MANUSCRIPT_ID }));
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(mocks.findAccessibleManuscript).toHaveBeenCalledWith(USER_ID, MANUSCRIPT_ID);
    expect(mocks.prisma.journal.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: JOURNAL_ID } }));
    expect(mocks.prisma.formatCheckReport.create.mock.calls[0][0].data.manuscriptId).toBe(MANUSCRIPT_ID);
    expect(body.manuscript.title).toBe("Library title");
    expect(mocks.auditLog).toHaveBeenCalledWith(expect.objectContaining({ entityType: "Manuscript", entityId: MANUSCRIPT_ID }));
  });

  it("returns 404 when the linked manuscript is not accessible", async () => {
    mocks.findAccessibleManuscript.mockResolvedValue(null);
    const response = await POST(multipartRequest({ file: pdfFile(), manuscriptId: MANUSCRIPT_ID }));
    expect(response.status).toBe(404);
    expect(mocks.buildManuscriptModel).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed manuscriptId", async () => {
    const response = await POST(multipartRequest({ file: pdfFile(), manuscriptId: "not a cuid" }));
    expect(response.status).toBe(400);
  });

  it("returns 422 when the parser cannot read the file", async () => {
    mocks.buildManuscriptModel.mockRejectedValue(new Error("bad xref"));
    const response = await POST(multipartRequest({ file: pdfFile() }));
    expect(response.status).toBe(422);
    expect(mocks.prisma.formatCheckReport.create).not.toHaveBeenCalled();
  });

  it("returns 500 on unexpected failures without leaking details", async () => {
    mocks.runFormatChecks.mockRejectedValue(new Error("boom"));
    const response = await POST(multipartRequest({ file: pdfFile() }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to check format" });
  });
});

describe("POST /api/format/check — profile override and formatting", () => {
  it("returns 400 for a profileId that is not in the registry, before parsing the file", async () => {
    const response = await POST(multipartRequest({ file: pdfFile(), profileId: "nature" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Unknown profile id");
    expect(mocks.buildManuscriptModel).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed profileId", async () => {
    expect((await POST(multipartRequest({ file: pdfFile(), profileId: "../x" }))).status).toBe(400);
  });

  it("uses the explicit profile instead of the journal's and records the override", async () => {
    const response = await POST(multipartRequest({ file: pdfFile(), journalSlug: "iscience", profileId: "generic" }));
    expect(response.status).toBe(200);
    expect(mocks.resolveProfile).not.toHaveBeenCalled();
    expect(mocks.runFormatChecks).toHaveBeenCalledWith(sampleModel, genericProfile, { llm: true });
    expect(mocks.prisma.formatCheckReport.create.mock.calls[0][0].data.profileOverride).toBe("generic");
    expect((await response.json()).profile.id).toBe("generic");
  });

  it("stores the source, runs the formatter after the checks and returns the formatting block", async () => {
    const response = await POST(multipartRequest({ file: pdfFile(), journalSlug: "iscience" }));
    expect(response.status).toBe(200);
    const body = await response.json();

    // Source stored first (so the report can be re-formatted later), then the engine's files.
    expect(mocks.putObject.mock.calls.map((c) => c[0])).toEqual([
      `format-reports/${REPORT_ID}/source.pdf`,
      `format-reports/${REPORT_ID}/formatted.docx`,
    ]);
    expect(mocks.putObject.mock.calls[0][2]).toBe("application/pdf");

    expect(mocks.formatManuscript).toHaveBeenCalledWith({
      model: sampleModel,
      profile: sampleProfile,
      report: sampleReport,
      sourceBuffer: undefined,
      journalName: "iScience",
      repairReferences: true,
    });
    expect(mocks.formatManuscript.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.runFormatChecks.mock.invocationCallOrder[0]);

    expect(body.formatting).toMatchObject({
      summary: { automatic: 1, needsAuthor: 1, referencesMatched: 1, referencesTotal: 2 },
      operations: sampleFormatResult().plan.operations,
      authorActions: [{ slotId: "lead_contact", text: "Please name a lead contact.", origin: "plan" }],
      letter: sampleComposedLetter,
      downloads: {
        formatted: `/api/format/reports/${REPORT_ID}/file?kind=formatted`,
        changeLog: `/api/format/reports/${REPORT_ID}/file?kind=change-log`,
        letter: `/api/format/reports/${REPORT_ID}/file?kind=letter`,
      },
    });
    expect(body.formatting.downloads.tracked).toBeUndefined();
    expect(body.formattingError).toBeUndefined();

    // Persistence: source path first, then plan/paths/change log/letter.
    const updates = mocks.prisma.formatCheckReport.update.mock.calls.map((c) => c[0]);
    expect(updates[0]).toEqual({ where: { id: REPORT_ID }, data: { sourcePath: `format-reports/${REPORT_ID}/source.pdf` } });
    expect(updates[1].where).toEqual({ id: REPORT_ID });
    expect(updates[1].data).toMatchObject({
      sourcePath: `format-reports/${REPORT_ID}/source.pdf`,
      formattedPath: `format-reports/${REPORT_ID}/formatted.docx`,
      trackedPath: null,
      changeLogText: expect.stringContaining("change log"),
      letterText: sampleComposedLetter.text,
    });
    expect(updates[1].data.formatPlan).not.toHaveProperty("layout");
    expect(updates[1].data.formattedAt).toBeInstanceOf(Date);
  });

  it("hands the original bytes to the engine for a .docx upload and exposes the tracked download", async () => {
    mocks.buildManuscriptModel.mockResolvedValue({ ...sampleModel, sourceType: "docx", fileName: "paper.docx" });
    mocks.formatManuscript.mockResolvedValue(sampleFormatResult({ tracked: true }));
    const response = await POST(multipartRequest({ file: docxFile() }));
    expect(response.status).toBe(200);
    expect(mocks.formatManuscript.mock.calls[0][0].sourceBuffer).toBeInstanceOf(Buffer);
    expect(mocks.putObject.mock.calls.map((c) => c[0])).toContain(`format-reports/${REPORT_ID}/tracked.docx`);
    expect((await response.json()).formatting.downloads.tracked).toBe(`/api/format/reports/${REPORT_ID}/file?kind=tracked`);
  });

  it("skips formatting (but still stores the source) when format=false", async () => {
    const response = await POST(multipartRequest({ file: pdfFile(), format: "false" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(mocks.formatManuscript).not.toHaveBeenCalled();
    expect(body.formatting).toBeUndefined();
    expect(body.formattingError).toBeUndefined();
    expect(body.report).toEqual(sampleReport);
    expect(mocks.putObject).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.formatCheckReport.update).toHaveBeenCalledTimes(1);
  });

  it("rejects an unparseable format flag", async () => {
    expect((await POST(multipartRequest({ file: pdfFile(), format: "maybe" }))).status).toBe(400);
  });

  it("keeps the check result and reports formattingError when the engine fails", async () => {
    mocks.formatManuscript.mockRejectedValue(new Error("engine down"));
    const response = await POST(multipartRequest({ file: pdfFile() }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.report).toEqual(sampleReport);
    expect(body.formatting).toBeUndefined();
    expect(body.formattingError).toMatch(/could not be generated/);
    expect(mocks.prisma.formatCheckReport.update).toHaveBeenCalledTimes(1); // only the sourcePath update
  });

  it("keeps the check result and reports formattingError when the source cannot be stored", async () => {
    mocks.putObject.mockRejectedValue(new Error("bucket missing"));
    const response = await POST(multipartRequest({ file: pdfFile() }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(mocks.formatManuscript).not.toHaveBeenCalled();
    expect(body.formattingError).toMatch(/could not be stored/);
    expect(mocks.prisma.formatCheckReport.update).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------
// JSON path: the browser uploaded the file straight to storage (upload-init)
// ------------------------------------------------------------------

const UPLOAD_ID = "6f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b";
const ownUpload = (ext = "pdf") => `format-reports/uploads/${USER_ID}/${UPLOAD_ID}/source.${ext}`;
const otherUpload = `format-reports/uploads/${OTHER_USER_ID}/${UPLOAD_ID}/source.pdf`;
const directRequest = (body: Record<string, unknown>) => jsonRequest("http://localhost/api/format/check", "POST", body);

describe("POST /api/format/check — JSON body after a direct upload", () => {
  it("returns 401 and 429 before reading the body", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await POST(directRequest({ sourcePath: ownUpload(), fileName: "paper.pdf" }))).status).toBe(401);
    mocks.auth.mockResolvedValue({ user: { id: USER_ID } });
    mocks.checkRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetIn: 30_000 });
    expect((await POST(directRequest({ sourcePath: ownUpload(), fileName: "paper.pdf" }))).status).toBe(429);
    expect(mocks.getObject).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed JSON or a body without sourcePath/fileName", async () => {
    const raw = new Request("http://localhost/api/format/check", { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
    expect((await POST(raw)).status).toBe(400);
    expect((await POST(directRequest({ fileName: "paper.pdf" }))).status).toBe(400);
    expect((await POST(directRequest({ sourcePath: ownUpload() }))).status).toBe(400);
    expect(mocks.getObject).not.toHaveBeenCalled();
  });

  it("returns 403 for an upload under another user's prefix, without touching storage", async () => {
    const response = await POST(directRequest({ sourcePath: otherUpload, fileName: "paper.pdf" }));
    expect(response.status).toBe(403);
    expect(mocks.getObject).not.toHaveBeenCalled();
    expect(mocks.prisma.formatCheckReport.create).not.toHaveBeenCalled();
  });

  it("returns 400 for a key that is not a well-formed direct upload (no traversal, no report keys)", async () => {
    for (const sourcePath of [
      `format-reports/uploads/${USER_ID}/../${OTHER_USER_ID}/${UPLOAD_ID}/source.pdf`,
      `format-reports/uploads/${USER_ID}/${UPLOAD_ID}/source.tex`,
      `format-reports/uploads/${USER_ID}/not-a-uuid/source.pdf`,
      `format-reports/uploads/${USER_ID}/${UPLOAD_ID}/formatted.docx`,
    ]) {
      const response = await POST(directRequest({ sourcePath, fileName: "paper.pdf" }));
      expect(response.status, sourcePath).toBe(400);
    }
    expect(mocks.getObject).not.toHaveBeenCalled();
  });

  it("validates profile, manuscript and journal before downloading the upload", async () => {
    expect((await POST(directRequest({ sourcePath: ownUpload(), fileName: "paper.pdf", profileId: "nature" }))).status).toBe(400);
    mocks.prisma.journal.findUnique.mockResolvedValue(null);
    expect((await POST(directRequest({ sourcePath: ownUpload(), fileName: "paper.pdf", journalSlug: "nope" }))).status).toBe(404);
    mocks.findAccessibleManuscript.mockResolvedValue(null);
    expect((await POST(directRequest({ sourcePath: ownUpload(), fileName: "paper.pdf", manuscriptId: MANUSCRIPT_ID }))).status).toBe(404);
    expect(mocks.getObject).not.toHaveBeenCalled();
  });

  it("returns 404 when the uploaded object is gone from storage", async () => {
    mocks.getObject.mockRejectedValue(new ObjectNotFoundError(ownUpload()));
    const response = await POST(directRequest({ sourcePath: ownUpload(), fileName: "paper.pdf" }));
    expect(response.status).toBe(404);
    expect(mocks.buildManuscriptModel).not.toHaveBeenCalled();
  });

  it("rejects downloaded bytes that do not match the declared type (400) or exceed 25 MB (413)", async () => {
    mocks.getObject.mockResolvedValue(Buffer.from("not a pdf at all"));
    const corrupt = await POST(directRequest({ sourcePath: ownUpload(), fileName: "paper.pdf" }));
    expect(corrupt.status).toBe(400);
    expect((await corrupt.json()).error).toMatch(/valid PDF/);

    mocks.getObject.mockResolvedValue(Buffer.concat([PDF_BYTES, Buffer.alloc(25 * 1024 * 1024)]));
    expect((await POST(directRequest({ sourcePath: ownUpload(), fileName: "paper.pdf" }))).status).toBe(413);
    expect(mocks.buildManuscriptModel).not.toHaveBeenCalled();
  });

  it("downloads the upload, runs the pipeline and reuses the object as the report source in place", async () => {
    const response = await POST(directRequest({ sourcePath: ownUpload(), fileName: "paper.pdf", journalSlug: "iscience" }));
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(mocks.getObject).toHaveBeenCalledWith(ownUpload());
    expect(mocks.buildManuscriptModel).toHaveBeenCalledWith({ buffer: expect.any(Buffer), fileName: "paper.pdf", mimeType: "application/pdf" });
    expect(mocks.runFormatChecks).toHaveBeenCalledWith(sampleModel, sampleProfile, { llm: true });
    expect(body.reportId).toBe(REPORT_ID);
    expect(body.report).toEqual({ ...sampleReport, letter: { ...sampleReport.letter, text: sampleComposedLetter.text } });
    expect(body.formatting.downloads.formatted).toBe(`/api/format/reports/${REPORT_ID}/file?kind=formatted`);

    // The source is recorded at creation and never re-uploaded: only the engine's output is written.
    expect(mocks.prisma.formatCheckReport.create.mock.calls[0][0].data).toMatchObject({
      journalId: JOURNAL_ID,
      fileName: "paper.pdf",
      sourcePath: ownUpload(),
    });
    expect(mocks.putObject.mock.calls.map((c) => c[0])).toEqual([`format-reports/${REPORT_ID}/formatted.docx`]);
    const updates = mocks.prisma.formatCheckReport.update.mock.calls.map((c) => c[0]);
    expect(updates).toHaveLength(1);
    expect(updates[0].data).toMatchObject({ sourcePath: ownUpload(), formattedPath: `format-reports/${REPORT_ID}/formatted.docx` });
  });

  it("hands a .docx upload's bytes to the engine, honours format=false and links a manuscript", async () => {
    mocks.getObject.mockResolvedValue(Buffer.from(DOCX_BYTES));
    mocks.buildManuscriptModel.mockResolvedValue({ ...sampleModel, sourceType: "docx", fileName: "paper.docx" });
    mocks.findAccessibleManuscript.mockResolvedValue({ id: MANUSCRIPT_ID });
    mocks.prisma.manuscript.findUnique.mockResolvedValue({ id: MANUSCRIPT_ID, title: "Library title", journalId: JOURNAL_ID });

    const response = await POST(directRequest({ sourcePath: ownUpload("docx"), fileName: "paper.docx", manuscriptId: MANUSCRIPT_ID, format: false }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(mocks.buildManuscriptModel.mock.calls[0][0].mimeType).toBe(DOCX_MIME_TYPE);
    expect(mocks.formatManuscript).not.toHaveBeenCalled();
    expect(mocks.putObject).not.toHaveBeenCalled();
    expect(mocks.prisma.formatCheckReport.update).not.toHaveBeenCalled();
    expect(mocks.prisma.formatCheckReport.create.mock.calls[0][0].data).toMatchObject({ manuscriptId: MANUSCRIPT_ID, sourcePath: ownUpload("docx") });
    expect(body.manuscript.title).toBe(sampleModel.title);
    expect(body.formatting).toBeUndefined();
    expect(body.formattingError).toBeUndefined();
  });

  it("returns 422 when the downloaded file cannot be parsed", async () => {
    mocks.buildManuscriptModel.mockRejectedValue(new Error("bad xref"));
    expect((await POST(directRequest({ sourcePath: ownUpload(), fileName: "paper.pdf" }))).status).toBe(422);
  });
});
