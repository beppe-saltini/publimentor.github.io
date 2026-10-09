/**
 * POST /api/format/upload-init — step 1 of a direct upload for the format check.
 *
 * JSON: { fileName, mimeType?, size }
 * -> { uploadPath, signedUrl, token, headers }
 *
 * Vercel functions reject request bodies over 4.5 MB, so the browser cannot
 * send a large manuscript to POST /api/format/check as multipart. Instead it
 * asks here for a signed Supabase upload URL (same mechanism as
 * /api/manuscripts/upload/init), PUTs the file to it with the returned
 * `headers`, then posts { sourcePath: uploadPath, fileName, ... } as JSON to
 * POST /api/format/check, which downloads the object server side.
 *
 * The key is format-reports/uploads/{userId}/{uuid}/source.{pdf|docx}; the
 * check route only accepts keys under the caller's own prefix. When storage is
 * not Supabase (local development) the route answers 400 and the client falls
 * back to the multipart upload.
 */

import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { formatUploadInitSchema } from "@/lib/api/validation";
import { createSignedUploadUrl, isSupabaseConfigured } from "@/lib/supabase";
import {
  FILE_TOO_LARGE_MESSAGE,
  MAX_FORMAT_CHECK_BYTES,
  MIME_FOR_TYPE,
  resolveAcceptedFileType,
} from "../_lib/file-input";
import { formatUploadPath, isSupabaseStorage } from "../_lib/format-storage";
import { jsonError, requireUserWithinUploadLimit } from "../_lib/guards";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const guard = await requireUserWithinUploadLimit();
    if (!guard.ok) return guard.response;
    const { userId } = guard;

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return jsonError("Invalid JSON body", 400);
    }
    const parsed = formatUploadInitSchema.safeParse(json);
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400);
    const { fileName, mimeType, size } = parsed.data;

    const type = resolveAcceptedFileType({ mimeType, fileName });
    if (!type) return jsonError("Only PDF and Word (.docx) files can be checked", 400);
    // The check itself parses at most 25 MB; refuse before the bytes travel.
    if (size > MAX_FORMAT_CHECK_BYTES) return jsonError(FILE_TOO_LARGE_MESSAGE, 413);

    if (!isSupabaseStorage()) return jsonError("direct upload needs Supabase storage", 400);
    if (!isSupabaseConfigured()) return jsonError("File storage is not configured on the server", 503);

    const uploadPath = formatUploadPath(userId, randomUUID(), type);
    const { signedUrl, token } = await createSignedUploadUrl(uploadPath);

    return NextResponse.json({
      uploadPath,
      signedUrl,
      token,
      headers: { "Content-Type": MIME_FOR_TYPE[type], "x-upsert": "false" },
    });
  } catch (error) {
    console.error("[format/upload-init] Error:", error);
    return jsonError("Failed to initialize upload", 500);
  }
}
