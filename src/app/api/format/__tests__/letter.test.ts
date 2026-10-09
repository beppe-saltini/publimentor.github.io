import { beforeEach, describe, expect, it, vi } from "vitest";
import { MANUSCRIPT_ID, OTHER_USER_ID, REPORT_ID, USER_ID, makeRow, params, sampleJournal, sampleLetter, sampleProfile } from "./fixtures";

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
  resolveProfile: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/manuscript-access", () => ({ findAccessibleManuscript: mocks.findAccessibleManuscript }));
vi.mock("../_lib/format-lib", () => ({
  buildLetter: mocks.buildLetter,
  letterToDocx: mocks.letterToDocx,
  resolveProfile: mocks.resolveProfile,
  buildManuscriptModel: vi.fn(),
  runFormatChecks: vi.fn(),
  formatManuscript: vi.fn(),
  composeAuthorLetter: vi.fn(),
  profiles: { iscience: sampleProfile },
}));

import { GET } from "../reports/[id]/letter/route";

const url = (query = "") => new Request(`http://localhost/api/format/reports/${REPORT_ID}/letter${query}`);
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.auth.mockResolvedValue({ user: { id: USER_ID } });
  mocks.prisma.journal.findUnique.mockResolvedValue(sampleJournal);
  mocks.prisma.formatCheckReport.findUnique.mockResolvedValue(makeRow({ letterText: "Dear authors,\n\n- Fix the title." }));
  mocks.buildLetter.mockReturnValue(sampleLetter);
  mocks.resolveProfile.mockReturnValue(sampleProfile);
  mocks.letterToDocx.mockResolvedValue(Buffer.from("PK\u0003\u0004docx-bytes"));
});

describe("GET /api/format/reports/[id]/letter", () => {
  it("returns 401 without a session", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await GET(url(), params(REPORT_ID))).status).toBe(401);
  });

  it("returns 400 for an unknown format", async () => {
    expect((await GET(url("?format=pdf"), params(REPORT_ID))).status).toBe(400);
  });

  it("returns 403 for a report the user cannot access", async () => {
    mocks.auth.mockResolvedValue({ user: { id: OTHER_USER_ID } });
    mocks.findAccessibleManuscript.mockResolvedValue(null);
    expect((await GET(url(), params(REPORT_ID))).status).toBe(403);
  });

  it("downloads the stored letter as text by default", async () => {
    const response = await GET(url(), params(REPORT_ID));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe(`attachment; filename="pre-accept-letter-${REPORT_ID}.txt"`);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await response.text()).toBe("Dear authors,\n\n- Fix the title.");
    expect(mocks.letterToDocx).not.toHaveBeenCalled();
  });

  it("renders a .docx named after the manuscript title", async () => {
    mocks.prisma.formatCheckReport.findUnique.mockResolvedValue(makeRow({ manuscriptId: MANUSCRIPT_ID, letterText: "Edited text" }));
    mocks.prisma.manuscript.findUnique.mockResolvedValue({ title: "A Synthetic Title", fileName: "x.pdf" });

    const response = await GET(url("?format=docx"), params(REPORT_ID));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(DOCX_MIME);
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="pre-accept-letter-a-synthetic-title.docx"');
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("PK\u0003\u0004docx-bytes");

    // The docx is built from the letter structure plus the stored (possibly edited) text.
    expect(mocks.letterToDocx).toHaveBeenCalledWith(
      { ...sampleLetter, text: "Edited text" },
      { manuscriptTitle: "A Synthetic Title", journalName: "iScience" }
    );
  });
});
