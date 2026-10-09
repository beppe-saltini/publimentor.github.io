import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DOCX_MIME_TYPE,
  MANUSCRIPT_ID,
  OTHER_USER_ID,
  REPORT_ID,
  USER_ID,
  makeFormattedRow,
  makeRow,
  params,
  sampleComposedLetter,
  sampleJournal,
  sampleLetter,
  sampleProfile,
} from "./fixtures";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  prisma: {
    journal: { findUnique: vi.fn() },
    manuscript: { findUnique: vi.fn() },
    formatCheckReport: { findUnique: vi.fn() },
  },
  findAccessibleManuscript: vi.fn(),
  buildLetter: vi.fn(),
  letterToDocx: vi.fn(),
  composeAuthorLetter: vi.fn(),
  resolveProfile: vi.fn(),
  getObject: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/manuscript-access", () => ({ findAccessibleManuscript: mocks.findAccessibleManuscript }));
vi.mock("../_lib/format-lib", () => ({
  buildLetter: mocks.buildLetter,
  letterToDocx: mocks.letterToDocx,
  composeAuthorLetter: mocks.composeAuthorLetter,
  formatManuscript: vi.fn(),
  resolveProfile: mocks.resolveProfile,
  buildManuscriptModel: vi.fn(),
  runFormatChecks: vi.fn(),
  profiles: { iscience: sampleProfile },
}));
vi.mock("../_lib/format-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../_lib/format-storage")>()),
  getObject: mocks.getObject,
}));

import { ObjectNotFoundError } from "../_lib/format-storage";
import { GET } from "../reports/[id]/file/route";

const url = (query: string) => new Request(`http://localhost/api/format/reports/${REPORT_ID}/file${query}`);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.auth.mockResolvedValue({ user: { id: USER_ID } });
  mocks.prisma.journal.findUnique.mockResolvedValue(sampleJournal);
  mocks.prisma.formatCheckReport.findUnique.mockResolvedValue(makeFormattedRow());
  mocks.buildLetter.mockReturnValue(sampleLetter);
  mocks.composeAuthorLetter.mockReturnValue(sampleComposedLetter);
  mocks.resolveProfile.mockReturnValue(sampleProfile);
  mocks.letterToDocx.mockResolvedValue(Buffer.from("PK\u0003\u0004letter"));
  mocks.getObject.mockImplementation(async (key: string) => Buffer.from(`bytes-of:${key}`));
});

describe("GET /api/format/reports/[id]/file", () => {
  it("guards: 401, 400 (id, kind, format), 404, 403", async () => {
    mocks.auth.mockResolvedValueOnce(null);
    expect((await GET(url("?kind=formatted"), params(REPORT_ID))).status).toBe(401);
    expect((await GET(url("?kind=formatted"), params("../x"))).status).toBe(400);
    expect((await GET(url(""), params(REPORT_ID))).status).toBe(400);
    expect((await GET(url("?kind=pdf"), params(REPORT_ID))).status).toBe(400);
    expect((await GET(url("?kind=letter&format=pdf"), params(REPORT_ID))).status).toBe(400);
    mocks.prisma.formatCheckReport.findUnique.mockResolvedValueOnce(null);
    expect((await GET(url("?kind=formatted"), params(REPORT_ID))).status).toBe(404);
    mocks.auth.mockResolvedValueOnce({ user: { id: OTHER_USER_ID } });
    expect((await GET(url("?kind=formatted"), params(REPORT_ID))).status).toBe(403);
    expect(mocks.getObject).not.toHaveBeenCalled();
  });

  it("streams the formatted document as an attachment", async () => {
    const response = await GET(url("?kind=formatted"), params(REPORT_ID));
    expect(response.status).toBe(200);
    expect(mocks.getObject).toHaveBeenCalledWith(`format-reports/${REPORT_ID}/formatted.docx`);
    expect(response.headers.get("Content-Type")).toBe(DOCX_MIME_TYPE);
    expect(response.headers.get("Content-Disposition")).toBe(`attachment; filename="journal-ready-${REPORT_ID}.docx"`);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe(`bytes-of:format-reports/${REPORT_ID}/formatted.docx`);
  });

  it("streams the tracked document, named after the manuscript title", async () => {
    mocks.prisma.formatCheckReport.findUnique.mockResolvedValue(makeFormattedRow({ manuscriptId: MANUSCRIPT_ID }));
    mocks.prisma.manuscript.findUnique.mockResolvedValue({ title: "A Synthetic Title", fileName: "x.docx" });
    const response = await GET(url("?kind=tracked"), params(REPORT_ID));
    expect(response.status).toBe(200);
    expect(mocks.getObject).toHaveBeenCalledWith(`format-reports/${REPORT_ID}/tracked.docx`);
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="tracked-changes-a-synthetic-title.docx"');
  });

  it("serves the change log as text", async () => {
    const response = await GET(url("?kind=change-log"), params(REPORT_ID));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe(`attachment; filename="change-log-${REPORT_ID}.txt"`);
    expect(await response.text()).toBe("# Formatting change log\n");
  });

  it("renders the letter as docx by default and as txt on request", async () => {
    const docx = await GET(url("?kind=letter"), params(REPORT_ID));
    expect(docx.status).toBe(200);
    expect(docx.headers.get("Content-Type")).toBe(DOCX_MIME_TYPE);
    expect(docx.headers.get("Content-Disposition")).toBe(`attachment; filename="pre-accept-letter-${REPORT_ID}.docx"`);
    expect(mocks.letterToDocx).toHaveBeenCalledWith(
      expect.objectContaining({ text: sampleComposedLetter.text }),
      { manuscriptTitle: undefined, journalName: "iScience" }
    );

    const txt = await GET(url("?kind=letter&format=txt"), params(REPORT_ID));
    expect(txt.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(await txt.text()).toBe(sampleComposedLetter.text);
  });

  it("answers 404 for kinds the report does not have", async () => {
    mocks.prisma.formatCheckReport.findUnique.mockResolvedValue(makeRow());
    expect((await GET(url("?kind=formatted"), params(REPORT_ID))).status).toBe(404);
    expect((await GET(url("?kind=tracked"), params(REPORT_ID))).status).toBe(404);
    expect((await GET(url("?kind=change-log"), params(REPORT_ID))).status).toBe(404);
    // The letter always exists (the check letter), even before formatting.
    expect((await GET(url("?kind=letter&format=txt"), params(REPORT_ID))).status).toBe(200);
    expect(mocks.getObject).not.toHaveBeenCalled();
  });

  it("answers 404 when a tracked path is recorded but the PDF report never produced one", async () => {
    mocks.prisma.formatCheckReport.findUnique.mockResolvedValue(makeFormattedRow({ trackedPath: null }));
    expect((await GET(url("?kind=tracked"), params(REPORT_ID))).status).toBe(404);
  });

  it("answers 404 when the stored object has disappeared and 500 on other storage errors", async () => {
    mocks.getObject.mockRejectedValueOnce(new ObjectNotFoundError("k"));
    expect((await GET(url("?kind=formatted"), params(REPORT_ID))).status).toBe(404);
    mocks.getObject.mockRejectedValueOnce(new Error("network"));
    const response = await GET(url("?kind=formatted"), params(REPORT_ID));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to download file" });
  });
});
