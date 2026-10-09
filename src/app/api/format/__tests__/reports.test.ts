import { beforeEach, describe, expect, it, vi } from "vitest";
import { JOURNAL_ID, MANUSCRIPT_ID, OTHER_USER_ID, USER_ID, makeRow, sampleProfile } from "./fixtures";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  prisma: {
    journal: { findUnique: vi.fn() },
    formatCheckReport: { findMany: vi.fn() },
  },
  findAccessibleManuscript: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/manuscript-access", () => ({ findAccessibleManuscript: mocks.findAccessibleManuscript }));
vi.mock("../_lib/format-lib", () => ({
  buildLetter: vi.fn(),
  letterToDocx: vi.fn(),
  buildManuscriptModel: vi.fn(),
  runFormatChecks: vi.fn(),
  formatManuscript: vi.fn(),
  composeAuthorLetter: vi.fn(),
  resolveProfile: vi.fn(() => sampleProfile),
  profiles: {},
}));

import { GET } from "../reports/route";

const url = (query = "") => new Request(`http://localhost/api/format/reports${query}`);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.auth.mockResolvedValue({ user: { id: USER_ID } });
  mocks.prisma.formatCheckReport.findMany.mockResolvedValue([]);
});

describe("GET /api/format/reports", () => {
  it("returns 401 without a session", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await GET(url())).status).toBe(401);
  });

  it("returns 400 for a malformed manuscriptId", async () => {
    expect((await GET(url("?manuscriptId=bad"))).status).toBe(400);
  });

  it("returns an empty list for an unknown journal slug", async () => {
    mocks.prisma.journal.findUnique.mockResolvedValue(null);
    const response = await GET(url("?journalSlug=nope"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reports: [] });
    expect(mocks.prisma.formatCheckReport.findMany).not.toHaveBeenCalled();
  });

  it("filters by manuscript and journal and hides reports the user may not see", async () => {
    mocks.prisma.journal.findUnique.mockResolvedValue({ id: JOURNAL_ID });
    const foreign = "cmanu000000000000000000777";
    mocks.prisma.formatCheckReport.findMany.mockResolvedValue([
      makeRow({ id: "own", checkedById: USER_ID }),
      makeRow({ id: "shared", checkedById: OTHER_USER_ID, manuscriptId: MANUSCRIPT_ID }),
      makeRow({ id: "foreign", checkedById: OTHER_USER_ID, manuscriptId: foreign }),
    ]);
    mocks.findAccessibleManuscript.mockImplementation(async (_u: string, id: string) =>
      id === MANUSCRIPT_ID ? { id } : null
    );

    const response = await GET(url(`?manuscriptId=${MANUSCRIPT_ID}&journalSlug=iscience`));
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.reports.map((r: { id: string }) => r.id)).toEqual(["own", "shared"]);
    expect(body.reports[0]).toMatchObject({
      checkedAt: "2026-10-09T10:00:00.000Z",
      profileId: "iscience",
      summary: { pass: 1, fail: 1, review: 1, total: 3 },
    });
    expect(mocks.prisma.formatCheckReport.findMany.mock.calls[0][0]).toMatchObject({
      where: { manuscriptId: MANUSCRIPT_ID, journalId: JOURNAL_ID },
      take: 60,
    });
  });
});
