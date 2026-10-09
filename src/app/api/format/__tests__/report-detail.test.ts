import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MANUSCRIPT_ID,
  OTHER_USER_ID,
  REPORT_ID,
  USER_ID,
  genericProfile,
  jsonRequest,
  makeFormattedRow,
  makeRow,
  params,
  sampleComposedLetter,
  sampleJournal,
  sampleLetter,
  samplePlan,
  sampleProfile,
  sampleResults,
} from "./fixtures";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  prisma: {
    journal: { findUnique: vi.fn() },
    manuscript: { findUnique: vi.fn() },
    formatCheckReport: { findUnique: vi.fn(), update: vi.fn() },
  },
  findAccessibleManuscript: vi.fn(),
  buildLetter: vi.fn(),
  composeAuthorLetter: vi.fn(),
  resolveProfile: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/manuscript-access", () => ({ findAccessibleManuscript: mocks.findAccessibleManuscript }));
vi.mock("../_lib/format-lib", () => ({
  buildLetter: mocks.buildLetter,
  composeAuthorLetter: mocks.composeAuthorLetter,
  resolveProfile: mocks.resolveProfile,
  letterToDocx: vi.fn(),
  formatManuscript: vi.fn(),
  buildManuscriptModel: vi.fn(),
  runFormatChecks: vi.fn(),
  profiles: { iscience: sampleProfile, generic: genericProfile },
}));

import { GET, PATCH } from "../reports/[id]/route";

const URL = `http://localhost/api/format/reports/${REPORT_ID}`;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.auth.mockResolvedValue({ user: { id: USER_ID } });
  mocks.prisma.journal.findUnique.mockResolvedValue(sampleJournal);
  mocks.prisma.formatCheckReport.findUnique.mockResolvedValue(makeRow());
  mocks.prisma.formatCheckReport.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...makeRow(),
    ...data,
  }));
  mocks.buildLetter.mockReturnValue(sampleLetter);
  mocks.composeAuthorLetter.mockReturnValue(sampleComposedLetter);
  mocks.resolveProfile.mockReturnValue(sampleProfile);
});

describe("GET /api/format/reports/[id]", () => {
  it("returns 401 without a session", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await GET(new Request(URL), params(REPORT_ID))).status).toBe(401);
  });

  it("returns 400 for a malformed id", async () => {
    expect((await GET(new Request(URL), params("../etc"))).status).toBe(400);
  });

  it("returns 404 when the report does not exist", async () => {
    mocks.prisma.formatCheckReport.findUnique.mockResolvedValue(null);
    expect((await GET(new Request(URL), params(REPORT_ID))).status).toBe(404);
  });

  it("returns 403 for another user's ad-hoc report", async () => {
    mocks.auth.mockResolvedValue({ user: { id: OTHER_USER_ID } });
    expect((await GET(new Request(URL), params(REPORT_ID))).status).toBe(403);
  });

  it("allows a user who can access the linked manuscript", async () => {
    mocks.auth.mockResolvedValue({ user: { id: OTHER_USER_ID } });
    mocks.prisma.formatCheckReport.findUnique.mockResolvedValue(makeRow({ manuscriptId: MANUSCRIPT_ID }));
    mocks.findAccessibleManuscript.mockResolvedValue({ id: MANUSCRIPT_ID });
    mocks.prisma.manuscript.findUnique.mockResolvedValue({ title: "T", fileName: "f.pdf" });
    const response = await GET(new Request(URL), params(REPORT_ID));
    expect(response.status).toBe(200);
    expect((await response.json()).manuscript.title).toBe("T");
  });

  it("returns the stored report with letter, overrides and profile", async () => {
    const response = await GET(new Request(URL), params(REPORT_ID));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.report.id).toBe(REPORT_ID);
    expect(body.report.results).toEqual(sampleResults);
    expect(body.report.letter.text).toBe(sampleLetter.text);
    expect(body.overrides).toEqual({});
    expect(body.letterText).toBe(sampleLetter.text);
    expect(body.profile).toMatchObject({ id: "iscience", name: "iScience", version: "2026-10" });
    expect(body.manuscript).toMatchObject({ wordCount: 5200, sourceType: "pdf" });
    // Not formatted yet, and no stored source to format from.
    expect(body.formatting).toBeNull();
    expect(body.canFormat).toBe(false);
    expect(mocks.composeAuthorLetter).not.toHaveBeenCalled();
  });

  it("returns the formatting block for a formatted report", async () => {
    mocks.prisma.formatCheckReport.findUnique.mockResolvedValue(makeFormattedRow({ overrides: { "file-type": { status: "pass" } } }));
    const response = await GET(new Request(URL), params(REPORT_ID));
    expect(response.status).toBe(200);
    const body = await response.json();

    const { layout: _layout, ...storedPlan } = samplePlan;
    void _layout;
    // The letter is recomposed from the stored plan and the results with overrides applied.
    expect(mocks.composeAuthorLetter).toHaveBeenCalledWith({
      plan: storedPlan,
      report: expect.objectContaining({ results: expect.arrayContaining([expect.objectContaining({ checkId: "file-type", status: "pass" })]) }),
      profile: sampleProfile,
      sourceType: "docx",
    });
    expect(body.formatting).toEqual({
      summary: { automatic: 1, needsAuthor: 1, referencesMatched: 1, referencesTotal: 2 },
      operations: storedPlan.operations,
      authorActions: [{ slotId: "lead_contact", text: "Please name a lead contact.", origin: "plan" }],
      letter: sampleComposedLetter,
      downloads: {
        formatted: `/api/format/reports/${REPORT_ID}/file?kind=formatted`,
        tracked: `/api/format/reports/${REPORT_ID}/file?kind=tracked`,
        changeLog: `/api/format/reports/${REPORT_ID}/file?kind=change-log`,
        letter: `/api/format/reports/${REPORT_ID}/file?kind=letter`,
      },
      formattedAt: "2026-10-09T10:05:00.000Z",
    });
    expect(body.canFormat).toBe(true);
    expect(body.report.letter.text).toBe(sampleComposedLetter.text);
  });

  it("lets a hand-edited letter win over the recomposed text in the formatting block", async () => {
    mocks.prisma.formatCheckReport.findUnique.mockResolvedValue(makeFormattedRow({ letterText: "Hand edited" }));
    const body = await (await GET(new Request(URL), params(REPORT_ID))).json();
    expect(body.formatting.letter.text).toBe("Hand edited");
    expect(body.formatting.letter.items).toEqual(sampleComposedLetter.items);
  });

  it("honours a stored profileOverride when resolving the profile", async () => {
    mocks.prisma.formatCheckReport.findUnique.mockResolvedValue(makeRow({ profileOverride: "generic" }));
    const body = await (await GET(new Request(URL), params(REPORT_ID))).json();
    expect(body.profile.id).toBe("generic");
    expect(mocks.resolveProfile).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/format/reports/[id]", () => {
  it("returns 400 when neither overrides nor letterText is given", async () => {
    expect((await PATCH(jsonRequest(URL, "PATCH", {}), params(REPORT_ID))).status).toBe(400);
    expect((await PATCH(jsonRequest(URL, "PATCH", { overrides: { x: { status: "nope" } } }), params(REPORT_ID))).status).toBe(400);
  });

  it("returns 403 for a report the user cannot access", async () => {
    mocks.auth.mockResolvedValue({ user: { id: OTHER_USER_ID } });
    const response = await PATCH(jsonRequest(URL, "PATCH", { letterText: "x" }), params(REPORT_ID));
    expect(response.status).toBe(403);
    expect(mocks.prisma.formatCheckReport.update).not.toHaveBeenCalled();
  });

  it("merges overrides, regenerates the letter from stored results and persists both", async () => {
    mocks.prisma.formatCheckReport.findUnique.mockResolvedValue(
      makeRow({ overrides: { "file-type": { note: "keep this note" } } })
    );
    const regenerated = { ...sampleLetter, text: "Regenerated letter" };
    mocks.buildLetter.mockReturnValue(regenerated);

    const response = await PATCH(
      jsonRequest(URL, "PATCH", { overrides: { "file-type": { status: "not_applicable" }, "summary-heading": { status: "pass" } } }),
      params(REPORT_ID)
    );
    expect(response.status).toBe(200);
    const body = await response.json();

    const expectedOverrides = {
      "file-type": { note: "keep this note", status: "not_applicable" },
      "summary-heading": { status: "pass" },
    };
    // Letter rebuilt against the journal's resolved profile with the merged overrides.
    expect(mocks.resolveProfile).toHaveBeenCalledWith(sampleJournal);
    expect(mocks.buildLetter).toHaveBeenCalledWith(sampleProfile, sampleResults, expectedOverrides);
    expect(mocks.prisma.formatCheckReport.update).toHaveBeenCalledWith({
      where: { id: REPORT_ID },
      data: { overrides: expectedOverrides, letterText: "Regenerated letter" },
    });
    expect(body.overrides).toEqual(expectedOverrides);
    expect(body.letterText).toBe("Regenerated letter");
    expect(body.report.letter.text).toBe("Regenerated letter");
    expect(body.report.summary).toMatchObject({ fail: 0, not_applicable: 1, pass: 2, review: 0, total: 3 });
  });

  it("stores a hand-edited letterText verbatim without regenerating", async () => {
    const response = await PATCH(jsonRequest(URL, "PATCH", { letterText: "Dear authors, custom text." }), params(REPORT_ID));
    expect(response.status).toBe(200);
    const data = mocks.prisma.formatCheckReport.update.mock.calls[0][0].data;
    expect(data.letterText).toBe("Dear authors, custom text.");
    expect(data.overrides).toEqual({});
    expect((await response.json()).letterText).toBe("Dear authors, custom text.");
  });

  it("lets an explicit letterText win over regeneration when both are sent", async () => {
    mocks.buildLetter.mockReturnValue({ ...sampleLetter, text: "Regenerated" });
    const response = await PATCH(
      jsonRequest(URL, "PATCH", { overrides: { "file-type": { status: "pass" } }, letterText: "Edited" }),
      params(REPORT_ID)
    );
    expect(response.status).toBe(200);
    expect(mocks.prisma.formatCheckReport.update.mock.calls[0][0].data.letterText).toBe("Edited");
  });
});

describe("PATCH /api/format/reports/[id] on a formatted report", () => {
  it("recomposes the letter with the stored plan when overrides change", async () => {
    mocks.prisma.formatCheckReport.findUnique.mockResolvedValue(makeFormattedRow());
    mocks.prisma.formatCheckReport.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...makeFormattedRow(),
      ...data,
    }));
    mocks.composeAuthorLetter.mockReturnValue({ ...sampleComposedLetter, text: "Recomposed with plan" });

    const response = await PATCH(jsonRequest(URL, "PATCH", { overrides: { "file-type": { status: "pass" } } }), params(REPORT_ID));
    expect(response.status).toBe(200);
    expect(mocks.prisma.formatCheckReport.update.mock.calls[0][0].data.letterText).toBe("Recomposed with plan");
    // The composer saw the override applied to the stored results.
    const report = mocks.composeAuthorLetter.mock.calls[0][0].report;
    expect(report.results.find((r: { checkId: string }) => r.checkId === "file-type").status).toBe("pass");
    const body = await response.json();
    expect(body.letterText).toBe("Recomposed with plan");
    expect(body.formatting.letter.text).toBe("Recomposed with plan");
  });
});
