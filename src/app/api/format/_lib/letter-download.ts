/**
 * Helpers for the download routes (letter, formatted/tracked documents, change
 * log). Kept outside route.ts because Next.js only allows route handlers and
 * config fields to be exported from route files.
 */

import { NextResponse } from "next/server";

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** "<prefix>-<slugged title or id>" with only header-safe ASCII characters. */
export function downloadFileName(prefix: string, title: string | undefined, reportId: string): string {
  const slug = (title ?? "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .toLowerCase();
  return `${prefix}-${slug || reportId}`;
}

/** "pre-accept-letter-<slugged title or id>". */
export function letterFileName(title: string | undefined, reportId: string): string {
  return downloadFileName("pre-accept-letter", title, reportId);
}

/** Binary/text attachment response with download headers. */
export function fileResponse(body: Uint8Array, contentType: string, fileName: string): NextResponse {
  // Copy into a plain ArrayBuffer-backed view: Buffer/SharedArrayBuffer-backed
  // views are not accepted as BodyInit by the Fetch typings.
  const bytes = new Uint8Array(body.byteLength);
  bytes.set(body);
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": bytes.byteLength.toString(),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
