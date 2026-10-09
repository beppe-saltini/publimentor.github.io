import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  download: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  MANUSCRIPTS_BUCKET: "manuscripts",
  getSupabaseAdmin: () => ({ storage: { from: () => ({ upload: mocks.upload, download: mocks.download }) } }),
}));

import {
  ObjectNotFoundError,
  assertFormatReportKey,
  formatReportPaths,
  formatUploadPath,
  formatUploadPrefixFor,
  getObject,
  isFormatUploadKey,
  isSupabaseStorage,
  localStorageBase,
  putObject,
  sourceExtensionOf,
} from "../_lib/format-storage";

const REPORT_ID = "crepo000000000000000000001";
const USER_ID = "cuser000000000000000000001";
const UPLOAD_ID = "6f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b";
let tmpDir: string;
const envBackup = { STORAGE_PROVIDER: process.env.STORAGE_PROVIDER, LOCAL_STORAGE_PATH: process.env.LOCAL_STORAGE_PATH, VERCEL: process.env.VERCEL };

beforeEach(async () => {
  vi.clearAllMocks();
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "format-storage-"));
  process.env.LOCAL_STORAGE_PATH = tmpDir;
  delete process.env.STORAGE_PROVIDER;
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(envBackup)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("paths and keys", () => {
  it("lays out one prefix per report", () => {
    expect(formatReportPaths(REPORT_ID, "pdf")).toEqual({
      source: `format-reports/${REPORT_ID}/source.pdf`,
      formatted: `format-reports/${REPORT_ID}/formatted.docx`,
      tracked: `format-reports/${REPORT_ID}/tracked.docx`,
    });
    expect(formatReportPaths(REPORT_ID, "docx").source).toBe(`format-reports/${REPORT_ID}/source.docx`);
  });

  it("reads the source extension back from a stored key", () => {
    expect(sourceExtensionOf(`format-reports/${REPORT_ID}/source.docx`)).toBe("docx");
    expect(sourceExtensionOf(`format-reports/${REPORT_ID}/source.pdf`)).toBe("pdf");
    expect(sourceExtensionOf(`format-reports/${REPORT_ID}/formatted.docx`)).toBeNull();
    expect(sourceExtensionOf(null)).toBeNull();
  });

  it("rejects keys outside the format-reports layout (no traversal)", async () => {
    expect(() => assertFormatReportKey(`format-reports/${REPORT_ID}/source.pdf`)).not.toThrow();
    expect(() => assertFormatReportKey("format-reports/../../etc/passwd")).toThrow(/Invalid/);
    expect(() => assertFormatReportKey("publishers/x/manuscripts/y/file.pdf")).toThrow(/Invalid/);
    expect(() => assertFormatReportKey(`format-reports/${REPORT_ID}/sub/dir.docx`)).toThrow(/Invalid/);
    await expect(putObject("format-reports/../x.pdf", Buffer.from("x"), "application/pdf")).rejects.toThrow(/Invalid/);
    await expect(getObject("format-reports/../x.pdf")).rejects.toThrow(/Invalid/);
  });

  it("accepts direct-upload keys only in their exact per-user layout", () => {
    const key = formatUploadPath(USER_ID, UPLOAD_ID, "docx");
    expect(key).toBe(`format-reports/uploads/${USER_ID}/${UPLOAD_ID}/source.docx`);
    expect(key.startsWith(formatUploadPrefixFor(USER_ID))).toBe(true);
    expect(key.startsWith(formatUploadPrefixFor("cuser000000000000000000002"))).toBe(false);
    expect(sourceExtensionOf(key)).toBe("docx");

    expect(isFormatUploadKey(key)).toBe(true);
    expect(() => assertFormatReportKey(key)).not.toThrow();
    for (const bad of [
      `format-reports/uploads/${USER_ID}/${UPLOAD_ID}/formatted.docx`,
      `format-reports/uploads/${USER_ID}/${UPLOAD_ID}/source.tex`,
      `format-reports/uploads/${USER_ID}/not-a-uuid/source.pdf`,
      `format-reports/uploads/${USER_ID}/../x/${UPLOAD_ID}/source.pdf`,
      `format-reports/uploads/${UPLOAD_ID}/source.pdf`,
      "format-reports/uploads/source.pdf",
    ]) {
      expect(isFormatUploadKey(bad), bad).toBe(false);
      expect(() => assertFormatReportKey(bad), bad).toThrow(/Invalid/);
    }
    // A report id can never be "uploads", so the two layouts cannot collide.
    expect(() => assertFormatReportKey("format-reports/uploads/source.pdf")).toThrow(/Invalid/);
  });
});

describe("local provider (STORAGE_PROVIDER unset)", () => {
  it("mirrors LocalStorageProvider's base directory resolution", () => {
    expect(isSupabaseStorage()).toBe(false);
    expect(localStorageBase()).toBe(tmpDir);
    delete process.env.LOCAL_STORAGE_PATH;
    process.env.VERCEL = "1";
    expect(localStorageBase()).toBe("/tmp/uploads");
    delete process.env.VERCEL;
    expect(localStorageBase()).toBe(path.join(process.cwd(), "uploads"));
  });

  it("round-trips an object under the base directory and overwrites in place", async () => {
    const key = formatReportPaths(REPORT_ID, "docx").formatted;
    await putObject(key, Buffer.from("first"), "application/octet-stream");
    expect((await getObject(key)).toString()).toBe("first");
    await putObject(key, Buffer.from("second"), "application/octet-stream");
    expect((await getObject(key)).toString()).toBe("second");
    await expect(fs.stat(path.join(tmpDir, key))).resolves.toBeTruthy();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("throws ObjectNotFoundError for a missing object", async () => {
    await expect(getObject(formatReportPaths(REPORT_ID, "pdf").source)).rejects.toBeInstanceOf(ObjectNotFoundError);
  });
});

describe("supabase provider (STORAGE_PROVIDER=supabase)", () => {
  beforeEach(() => {
    process.env.STORAGE_PROVIDER = "supabase";
  });

  it("uploads with upsert and the content type", async () => {
    mocks.upload.mockResolvedValue({ error: null });
    const key = formatReportPaths(REPORT_ID, "pdf").source;
    await putObject(key, Buffer.from("%PDF"), "application/pdf");
    expect(mocks.upload).toHaveBeenCalledWith(key, expect.any(Buffer), { contentType: "application/pdf", upsert: true });
  });

  it("surfaces upload errors", async () => {
    mocks.upload.mockResolvedValue({ error: { message: "quota" } });
    await expect(putObject(formatReportPaths(REPORT_ID, "pdf").source, Buffer.from("x"), "application/pdf")).rejects.toThrow(/quota/);
  });

  it("downloads a Blob into a Buffer", async () => {
    mocks.download.mockResolvedValue({ data: new Blob([new TextEncoder().encode("docx-bytes")]), error: null });
    const bytes = await getObject(formatReportPaths(REPORT_ID, "docx").tracked);
    expect(bytes.toString()).toBe("docx-bytes");
  });

  it("maps a not-found download to ObjectNotFoundError and others to a generic error", async () => {
    mocks.download.mockResolvedValue({ data: null, error: { message: "Object not found", statusCode: "404" } });
    await expect(getObject(formatReportPaths(REPORT_ID, "docx").formatted)).rejects.toBeInstanceOf(ObjectNotFoundError);
    mocks.download.mockResolvedValue({ data: null, error: { message: "boom", statusCode: 500 } });
    await expect(getObject(formatReportPaths(REPORT_ID, "docx").formatted)).rejects.toThrow(/boom/);
  });
});
