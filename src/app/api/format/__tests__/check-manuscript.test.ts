import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  JOURNAL_ID,
  MANUSCRIPT_ID,
  PDF_BYTES,
  REPORT_ID,
  USER_ID,
  jsonRequest,
  genericProfile,
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
  download: vi.fn(),
  auditLog: vi.fn(),
  buildManuscriptModel: vi.fn(),
  runFormatChecks: vi.fn(),
  resolveProfile: vi.fn(),
  formatManuscript: vi.fn(),
  composeAuthorLetter: vi.fn(),
  putObject: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/security", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/security")>()),
  checkRateLimit: mocks.checkRateLimit,
}));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/manuscript-access", () => ({ findAccessibleManuscript: mocks.findAccessibleManuscript }));
vi.mock("@/lib/storage", () => ({ getStorage: () => ({ download: mocks.download }) }));
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
}));

import { POST, dynamic, maxDuration } from "../check-manuscript/route";

const URL = "http://localhost/api/format/check-manuscript";

const manuscriptRow = {
  id: MANUSCRIPT_ID,
  title: "Library title",
  fileName: "final.pdf",
  fileType: "pdf",
  fileMimeType: "application/pdf",
  fileSize: 1024,
  filePath: "legacy/final.pdf",
  storagePath: "manuscripts/final.pdf",
  journalId: JOURNAL_ID,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.auth.mockResolvedValue({ user: { id: USER_ID } });
  mocks.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetIn: 60_000 });
  mocks.findAccessibleManuscript.mockResolvedValue({ id: MANUSCRIPT_ID });
  mocks.prisma.manuscript.findUnique.mockResolvedValue(manuscriptRow);
  mocks.prisma.journal.findUnique.mockResolvedValue(sampleJournal);
  mocks.prisma.formatCheckReport.create.mockResolvedValue({ id: REPORT_ID });
  mocks.prisma.formatCheckReport.update.mockResolvedValue({ id: REPORT_ID });
  mocks.download.mockResolvedValue(PDF_BYTES);
  mocks.formatManuscript.mockResolvedValue(sampleFormatResult());
  mocks.composeAuthorLetter.mockReturnValue(sampleComposedLetter);
  mocks.putObject.mockResolvedValue(undefined);
  mocks.buildManuscriptModel.mockResolvedValue({ ...sampleModel, title: undefined, fileName: "final.pdf" });
  mocks.runFormatChecks.mockResolvedValue(sampleReport);
  mocks.resolveProfile.mockReturnValue(sampleProfile);
});

describe("POST /api/format/check-manuscript", () => {
  it("declares the Next.js route config", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(maxDuration).toBe(300);
  });

  it("returns 401 without a session", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await POST(jsonRequest(URL, "POST", { manuscriptId: MANUSCRIPT_ID }))).status).toBe(401);
  });

  it("returns 429 when rate limited", async () => {
    mocks.checkRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetIn: 5000 });
    expect((await POST(jsonRequest(URL, "POST", { manuscriptId: MANUSCRIPT_ID }))).status).toBe(429);
  });

  it("returns 400 for invalid bodies", async () => {
    expect((await POST(jsonRequest(URL, "POST", {}))).status).toBe(400);
    expect((await POST(new Request(URL, { method: "POST", body: "not json" }))).status).toBe(400);
  });

  it("returns 404 when the manuscript is missing or not accessible", async () => {
    mocks.findAccessibleManuscript.mockResolvedValue(null);
    const response = await POST(jsonRequest(URL, "POST", { manuscriptId: MANUSCRIPT_ID }));
    expect(response.status).toBe(404);
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("returns 400 for a LaTeX manuscript", async () => {
    mocks.prisma.manuscript.findUnique.mockResolvedValue({ ...manuscriptRow, fileType: "tex", fileMimeType: "text/x-tex", fileName: "main.tex" });
    const response = await POST(jsonRequest(URL, "POST", { manuscriptId: MANUSCRIPT_ID }));
    expect(response.status).toBe(400);
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("returns 404 when the stored file cannot be downloaded", async () => {
    mocks.download.mockRejectedValue(new Error("missing"));
    expect((await POST(jsonRequest(URL, "POST", { manuscriptId: MANUSCRIPT_ID }))).status).toBe(404);
  });

  it("downloads from storagePath, checks, persists and audits against the manuscript", async () => {
    const response = await POST(jsonRequest(URL, "POST", { manuscriptId: MANUSCRIPT_ID }));
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(mocks.download).toHaveBeenCalledWith("manuscripts/final.pdf");
    // No slug given: the manuscript's own journal is used for the profile.
    expect(mocks.prisma.journal.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: JOURNAL_ID } }));
    expect(mocks.buildManuscriptModel).toHaveBeenCalledWith({ buffer: PDF_BYTES, fileName: "final.pdf", mimeType: "application/pdf" });
    expect(mocks.runFormatChecks).toHaveBeenCalledWith(expect.anything(), sampleProfile, { llm: true });

    expect(mocks.prisma.formatCheckReport.create.mock.calls[0][0].data).toMatchObject({
      manuscriptId: MANUSCRIPT_ID,
      journalId: JOURNAL_ID,
      fileName: "final.pdf",
      checkedById: USER_ID,
    });
    expect(body.reportId).toBe(REPORT_ID);
    expect(body.manuscript.title).toBe("Library title"); // model had no title -> DB title
    expect(mocks.auditLog).toHaveBeenCalledWith(expect.objectContaining({ entityType: "Manuscript", entityId: MANUSCRIPT_ID }));
  });

  it("prefers an explicit journalSlug and falls back to filePath when storagePath is empty", async () => {
    mocks.prisma.manuscript.findUnique.mockResolvedValue({ ...manuscriptRow, storagePath: null });
    const response = await POST(jsonRequest(URL, "POST", { manuscriptId: MANUSCRIPT_ID, journalSlug: "iscience" }));
    expect(response.status).toBe(200);
    expect(mocks.download).toHaveBeenCalledWith("legacy/final.pdf");
    expect(mocks.prisma.journal.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { slug: "iscience" } }));
  });

  it("returns 422 when the parser fails", async () => {
    mocks.buildManuscriptModel.mockRejectedValue(new Error("corrupt"));
    expect((await POST(jsonRequest(URL, "POST", { manuscriptId: MANUSCRIPT_ID }))).status).toBe(422);
  });
});

describe("POST /api/format/check-manuscript — profile override and formatting", () => {
  it("returns 400 for an unknown or malformed profileId", async () => {
    const unknown = await POST(jsonRequest(URL, "POST", { manuscriptId: MANUSCRIPT_ID, profileId: "nature" }));
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).error).toBe("Unknown profile id");
    expect((await POST(jsonRequest(URL, "POST", { manuscriptId: MANUSCRIPT_ID, profileId: "bad id!" }))).status).toBe(400);
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-boolean format flag", async () => {
    // "true"/"false"-like strings are accepted (multipart fields arrive as strings); anything else is not.
    expect((await POST(jsonRequest(URL, "POST", { manuscriptId: MANUSCRIPT_ID, format: "maybe" }))).status).toBe(400);
    expect((await POST(jsonRequest(URL, "POST", { manuscriptId: MANUSCRIPT_ID, format: 5 }))).status).toBe(400);
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("applies the profile override, stores the source and returns the formatting block", async () => {
    const response = await POST(jsonRequest(URL, "POST", { manuscriptId: MANUSCRIPT_ID, profileId: "generic" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(mocks.runFormatChecks).toHaveBeenCalledWith(expect.anything(), genericProfile, { llm: true });
    expect(mocks.prisma.formatCheckReport.create.mock.calls[0][0].data.profileOverride).toBe("generic");
    expect(mocks.putObject.mock.calls[0][0]).toBe(`format-reports/${REPORT_ID}/source.pdf`);
    expect(mocks.formatManuscript).toHaveBeenCalledWith(expect.objectContaining({ profile: genericProfile, journalName: "iScience" }));
    expect(body.formatting.letter).toEqual(sampleComposedLetter);
    expect(body.formatting.downloads.formatted).toBe(`/api/format/reports/${REPORT_ID}/file?kind=formatted`);
    expect(body.report.letter.text).toBe(sampleComposedLetter.text);
  });

  it("skips the formatter when format is false", async () => {
    const response = await POST(jsonRequest(URL, "POST", { manuscriptId: MANUSCRIPT_ID, format: false }));
    expect(response.status).toBe(200);
    expect(mocks.formatManuscript).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body.formatting).toBeUndefined();
    expect(body.report.letter.text).toBe(sampleReport.letter.text);
  });
});
