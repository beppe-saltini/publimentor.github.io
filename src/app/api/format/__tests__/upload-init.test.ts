import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DOCX_MIME_TYPE, USER_ID, jsonRequest } from "./fixtures";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  checkRateLimit: vi.fn(),
  createSignedUploadUrl: vi.fn(),
  isSupabaseConfigured: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/security", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/security")>()),
  checkRateLimit: mocks.checkRateLimit,
}));
vi.mock("@/lib/supabase", () => ({
  MANUSCRIPTS_BUCKET: "manuscripts",
  createSignedUploadUrl: mocks.createSignedUploadUrl,
  isSupabaseConfigured: mocks.isSupabaseConfigured,
}));

import { POST, dynamic, runtime } from "../upload-init/route";

const URL = "http://localhost/api/format/upload-init";
const UUID_RE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const providerBackup = process.env.STORAGE_PROVIDER;

const post = (body: unknown) => POST(jsonRequest(URL, "POST", body));
const pdfBody = (overrides: Record<string, unknown> = {}) => ({
  fileName: "paper.pdf",
  mimeType: "application/pdf",
  size: 7 * 1024 * 1024,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.env.STORAGE_PROVIDER = "supabase";
  mocks.auth.mockResolvedValue({ user: { id: USER_ID } });
  mocks.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 19, resetIn: 60_000 });
  mocks.isSupabaseConfigured.mockReturnValue(true);
  mocks.createSignedUploadUrl.mockResolvedValue({ signedUrl: "https://supabase.test/upload/signed?token=abc", token: "abc" });
});

afterEach(() => {
  if (providerBackup === undefined) delete process.env.STORAGE_PROVIDER;
  else process.env.STORAGE_PROVIDER = providerBackup;
});

describe("POST /api/format/upload-init", () => {
  it("declares the Next.js route config", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(runtime).toBe("nodejs");
  });

  it("returns 401 without a session", async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await post(pdfBody());
    expect(response.status).toBe(401);
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("returns 429 with Retry-After under its own 20/min key", async () => {
    mocks.checkRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetIn: 15_000 });
    const response = await post(pdfBody());
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("15");
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(`format-upload:${USER_ID}`, { windowMs: 60_000, maxRequests: 20 });
  });

  it("returns 400 for a non-JSON body and for a body missing fields", async () => {
    const raw = new Request(URL, { method: "POST", body: "not json", headers: { "content-type": "application/json" } });
    expect((await POST(raw)).status).toBe(400);
    expect((await post({ fileName: "paper.pdf" })).status).toBe(400);
    expect((await post({ fileName: "", size: 10 })).status).toBe(400);
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("returns 400 for a file that is neither PDF nor DOCX by MIME type or extension", async () => {
    const response = await post({ fileName: "main.tex", mimeType: "text/x-tex", size: 1024 });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/PDF and Word/);
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("accepts a .docx whose browser MIME type is octet-stream (extension decides)", async () => {
    const response = await post({ fileName: "paper.docx", mimeType: "application/octet-stream", size: 1024 });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.uploadPath).toMatch(new RegExp(`^format-reports/uploads/${USER_ID}/${UUID_RE}/source\\.docx$`));
    expect(body.headers["Content-Type"]).toBe(DOCX_MIME_TYPE);
  });

  it("rejects sizes above the caps: 400 over 50 MB (schema), 413 over the 25 MB check limit", async () => {
    const over50 = await post(pdfBody({ size: 51 * 1024 * 1024 }));
    expect(over50.status).toBe(400);
    expect((await over50.json()).error).toMatch(/50 MB/);

    const over25 = await post(pdfBody({ size: 25 * 1024 * 1024 + 1 }));
    expect(over25.status).toBe(413);
    expect((await over25.json()).error).toMatch(/25 MB/);

    expect((await post(pdfBody({ size: 0 }))).status).toBe(400);
    expect((await post(pdfBody({ size: "big" }))).status).toBe(400);
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("returns 400 when storage is not Supabase so the client falls back to multipart", async () => {
    delete process.env.STORAGE_PROVIDER;
    const response = await post(pdfBody());
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("direct upload needs Supabase storage");
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("returns 503 when the provider is Supabase but the credentials are missing", async () => {
    mocks.isSupabaseConfigured.mockReturnValue(false);
    expect((await post(pdfBody())).status).toBe(503);
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("creates a signed upload URL under the caller's prefix and returns what the client needs", async () => {
    const response = await post(pdfBody());
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.uploadPath).toMatch(new RegExp(`^format-reports/uploads/${USER_ID}/${UUID_RE}/source\\.pdf$`));
    expect(mocks.createSignedUploadUrl).toHaveBeenCalledWith(body.uploadPath);
    expect(body).toEqual({
      uploadPath: body.uploadPath,
      signedUrl: "https://supabase.test/upload/signed?token=abc",
      token: "abc",
      headers: { "Content-Type": "application/pdf", "x-upsert": "false" },
    });

    // Every call reserves a fresh key.
    const second = await (await post(pdfBody())).json();
    expect(second.uploadPath).not.toBe(body.uploadPath);
  });

  it("returns 500 without details when the signed URL cannot be created", async () => {
    mocks.createSignedUploadUrl.mockRejectedValue(new Error("bucket exploded"));
    const response = await post(pdfBody());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to initialize upload" });
  });
});
