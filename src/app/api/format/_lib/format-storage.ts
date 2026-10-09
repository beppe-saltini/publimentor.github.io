/**
 * Object storage for the Journal-Ready Formatter files.
 *
 * Every report keeps its files under one prefix in the manuscripts bucket:
 *
 *   format-reports/{reportId}/source.{pdf|docx}   the file the checks ran on
 *   format-reports/{reportId}/formatted.docx       rebuilt journal-ready document
 *   format-reports/{reportId}/tracked.docx         original with tracked changes (docx sources)
 *
 * src/lib/storage.ts's StorageProvider.upload derives its own path from a
 * manuscript/publisher layout, so it cannot write these keys. This module talks
 * to Supabase Storage directly when STORAGE_PROVIDER is "supabase" and mirrors
 * LocalStorageProvider's on-disk layout otherwise (LOCAL_STORAGE_PATH, else
 * /tmp/uploads on Vercel, else ./uploads), so a local development run and the
 * library's own files share one base directory.
 */

import fs from "fs/promises";
import path from "path";

export const FORMAT_REPORTS_PREFIX = "format-reports";

export type SourceExtension = "pdf" | "docx";

/** Storage keys for one report. */
export function formatReportPaths(reportId: string, sourceExt: SourceExtension) {
  const base = `${FORMAT_REPORTS_PREFIX}/${reportId}`;
  return {
    source: `${base}/source.${sourceExt}`,
    formatted: `${base}/formatted.docx`,
    tracked: `${base}/tracked.docx`,
  };
}

/** The source extension recorded in a stored source path, or null when it is not one of ours. */
export function sourceExtensionOf(sourcePath: string | null | undefined): SourceExtension | null {
  if (!sourcePath) return null;
  const match = /\/source\.(pdf|docx)$/.exec(sourcePath);
  return match ? (match[1] as SourceExtension) : null;
}

/**
 * Only keys of the form format-reports/<id>/<file> are accepted, which rules
 * out path traversal on the local provider and stray writes elsewhere in the
 * bucket. Report ids are cuids (and the routes validate them), file names are
 * fixed by formatReportPaths.
 */
const KEY_PATTERN = /^format-reports\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]+\.[a-z0-9]{1,8}$/;

export function assertFormatReportKey(key: string): void {
  if (!KEY_PATTERN.test(key)) throw new Error(`Invalid format-report storage key: ${key}`);
}

export function isSupabaseStorage(): boolean {
  return (process.env.STORAGE_PROVIDER || "").trim() === "supabase";
}

/** Same resolution as LocalStorageProvider so both providers share a directory. */
export function localStorageBase(): string {
  return process.env.LOCAL_STORAGE_PATH || (process.env.VERCEL ? "/tmp/uploads" : path.join(process.cwd(), "uploads"));
}

async function supabaseBucket() {
  // Dynamic import keeps @supabase/supabase-js out of the local-only bundle.
  const { getSupabaseAdmin, MANUSCRIPTS_BUCKET } = await import("@/lib/supabase");
  return getSupabaseAdmin().storage.from(MANUSCRIPTS_BUCKET);
}

/** Write (or overwrite) one object. Re-formatting a report replaces its files in place. */
export async function putObject(key: string, buffer: Buffer, contentType: string): Promise<void> {
  assertFormatReportKey(key);
  if (isSupabaseStorage()) {
    const bucket = await supabaseBucket();
    const { error } = await bucket.upload(key, buffer, { contentType, upsert: true });
    if (error) throw new Error(`Storage upload failed for ${key}: ${error.message}`);
    return;
  }
  const fullPath = path.join(localStorageBase(), key);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, buffer);
}

/** Thrown when a key has no object behind it; routes answer 404. */
export class ObjectNotFoundError extends Error {
  constructor(key: string) {
    super(`No stored object at ${key}`);
    this.name = "ObjectNotFoundError";
  }
}

/** Read one object as a Buffer. Missing objects surface as ObjectNotFoundError. */
export async function getObject(key: string): Promise<Buffer> {
  assertFormatReportKey(key);
  if (isSupabaseStorage()) {
    const bucket = await supabaseBucket();
    const { data, error } = await bucket.download(key);
    if (error || !data) {
      const status = (error as { statusCode?: string | number } | null)?.statusCode;
      if (status === 404 || status === "404" || /not.?found/i.test(error?.message ?? "")) throw new ObjectNotFoundError(key);
      throw new Error(`Storage download failed for ${key}: ${error?.message ?? "no data"}`);
    }
    return Buffer.from(await data.arrayBuffer());
  }
  try {
    return await fs.readFile(path.join(localStorageBase(), key));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new ObjectNotFoundError(key);
    throw error;
  }
}
