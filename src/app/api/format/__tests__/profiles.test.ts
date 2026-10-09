import { beforeEach, describe, expect, it, vi } from "vitest";
import { USER_ID, genericProfile, sampleProfile } from "./fixtures";

const mocks = vi.hoisted(() => ({ auth: vi.fn() }));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("../_lib/format-lib", () => ({
  profiles: { iscience: { ...sampleProfile, family: "cell-press" }, generic: genericProfile },
  buildLetter: vi.fn(),
  letterToDocx: vi.fn(),
  buildManuscriptModel: vi.fn(),
  runFormatChecks: vi.fn(),
  resolveProfile: vi.fn(),
  formatManuscript: vi.fn(),
  composeAuthorLetter: vi.fn(),
}));

import { GET, dynamic } from "../profiles/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: USER_ID } });
});

describe("GET /api/format/profiles", () => {
  it("is dynamic and requires a session", async () => {
    expect(dynamic).toBe("force-dynamic");
    mocks.auth.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });

  it("lists the registry with id, name, version and optional family", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      profiles: [
        { id: "iscience", name: "iScience", version: "2026-10", family: "cell-press" },
        { id: "generic", name: "Generic", version: "1" },
      ],
    });
  });
});
