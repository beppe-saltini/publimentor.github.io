/**
 * POST /api/format/check — pre-accept format check of an uploaded file.
 *
 * Two request shapes, one pipeline:
 *
 * multipart/form-data: file (PDF or DOCX, <= 25 MB), journalSlug?, manuscriptId?,
 *                      profileId? (explicit profile override), format? (default true)
 *   Fine for small files; Vercel rejects function bodies over 4.5 MB.
 *
 * application/json:    { sourcePath, fileName, journalSlug?, manuscriptId?, profileId?, format? }
 *   After a direct upload (POST /api/format/upload-init + PUT to the signed
 *   URL). `sourcePath` must be under format-reports/uploads/{userId}/ (403
 *   otherwise); the object is downloaded, validated like a multipart file and
 *   kept in place as the report's source — nothing is copied.
 *
 * -> { reportId, report: FormatCheckReport, manuscript, profile, formatting? }
 *
 * With format=true (the default) the Journal-Ready Formatter runs after the
 * checks and `formatting` carries the plan summary, operations, author letter
 * and download URLs (see _lib/run-format.ts).
 *
 * `manuscriptId` links the report to a library manuscript the user may access
 * (and, when no slug is given, borrows that manuscript's journal); the file
 * itself is always the uploaded one, so an editor can check the authors' final
 * files without re-uploading them to the library.
 */

import { NextResponse } from "next/server";
import { formatCheckDirectSchema, formatCheckUploadSchema } from "@/lib/api/validation";
import { findAccessibleManuscript } from "@/lib/manuscript-access";
import { prisma } from "@/lib/prisma";
import {
  checkManuscriptBytes,
  fileProblemStatus,
  readUploadedManuscript,
  type AcceptedFileType,
} from "../_lib/file-input";
import { formatUploadPrefixFor, getObject, isFormatUploadKey, ObjectNotFoundError, sourceExtensionOf } from "../_lib/format-storage";
import { jsonError, requireUserWithinCheckLimit } from "../_lib/guards";
import { findJournal, isKnownProfileId, ManuscriptParseError, performFormatCheck } from "../_lib/run-check";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** The text fields both request shapes share. */
interface CheckFields {
  journalSlug?: string;
  manuscriptId?: string;
  profileId?: string;
  format: boolean;
}

/** Where the manuscript bytes come from: already in memory, or a direct upload to download. */
type Source =
  | { kind: "multipart"; buffer: Buffer; fileName: string; fileType: AcceptedFileType }
  | { kind: "direct"; sourcePath: string; fileName: string; fileType: AcceptedFileType };

type ParsedRequest = { ok: true; fields: CheckFields; source: Source } | { ok: false; response: NextResponse };

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    const guard = await requireUserWithinCheckLimit();
    if (!guard.ok) return guard.response;
    const { userId } = guard;

    const parsed = isJsonRequest(request) ? await parseDirectRequest(request, userId) : await parseMultipartRequest(request);
    if (!parsed.ok) return parsed.response;
    const { fields, source } = parsed;
    const { journalSlug, manuscriptId, profileId, format } = fields;
    if (profileId && !isKnownProfileId(profileId)) return jsonError("Unknown profile id", 400);

    let manuscript: { id: string; title?: string | null; journalId?: string | null } | null = null;
    if (manuscriptId) {
      const accessible = await findAccessibleManuscript(userId, manuscriptId);
      if (!accessible) return jsonError("Manuscript not found", 404);
      const details = await prisma.manuscript.findUnique({
        where: { id: manuscriptId },
        select: { id: true, title: true, journalId: true },
      });
      manuscript = details ?? { id: manuscriptId };
    }

    const journal = await findJournal({ slug: journalSlug, id: manuscript?.journalId });
    if (journalSlug && !journal) return jsonError("Journal not found", 404);

    // The download comes last so a request that fails validation never touches storage.
    let buffer: Buffer;
    if (source.kind === "direct") {
      try {
        buffer = await getObject(source.sourcePath);
      } catch (error) {
        if (error instanceof ObjectNotFoundError) return jsonError("The uploaded file was not found in storage; upload it again", 404);
        throw error;
      }
      const problem = checkManuscriptBytes(buffer, source.fileType);
      if (problem) return jsonError(problem.message, fileProblemStatus(problem));
    } else {
      buffer = source.buffer;
    }

    const body = await performFormatCheck({
      userId,
      buffer,
      fileName: source.fileName,
      fileType: source.fileType,
      journal,
      manuscript,
      profileId,
      format,
      startedAt,
      sourcePath: source.kind === "direct" ? source.sourcePath : null,
    });
    return NextResponse.json(body);
  } catch (error) {
    if (error instanceof ManuscriptParseError) {
      return jsonError("Could not read the manuscript file. Make sure it is a valid PDF or Word document.", 422);
    }
    console.error("[format/check] Error:", error);
    return jsonError("Failed to check format", 500);
  }
}

function isJsonRequest(request: Request): boolean {
  return (request.headers.get("content-type") ?? "").toLowerCase().includes("application/json");
}

/** multipart/form-data: the file travels in the request. */
async function parseMultipartRequest(request: Request): Promise<ParsedRequest> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return { ok: false, response: jsonError("Expected multipart/form-data with a file field", 400) };
  }

  // Accept the legacy "pdf" field name used by the previous UI as a fallback.
  const upload = await readUploadedManuscript(formData.get("file") ?? formData.get("pdf"));
  if (!upload.ok) return { ok: false, response: jsonError(upload.problem.message, fileProblemStatus(upload.problem)) };

  const fields = formatCheckUploadSchema.safeParse({
    journalSlug: stringField(formData, "journalSlug"),
    manuscriptId: stringField(formData, "manuscriptId"),
    profileId: stringField(formData, "profileId"),
    format: stringField(formData, "format"),
  });
  if (!fields.success) return { ok: false, response: jsonError(fields.error.issues[0].message, 400) };

  return {
    ok: true,
    fields: fields.data,
    source: { kind: "multipart", buffer: upload.buffer, fileName: upload.fileName, fileType: upload.type },
  };
}

/** application/json: the file was uploaded directly; only the caller's own uploads are accepted. */
async function parseDirectRequest(request: Request, userId: string): Promise<ParsedRequest> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return { ok: false, response: jsonError("Invalid JSON body", 400) };
  }
  const parsed = formatCheckDirectSchema.safeParse(json);
  if (!parsed.success) return { ok: false, response: jsonError(parsed.error.issues[0].message, 400) };
  const { sourcePath, fileName, ...fields } = parsed.data;

  if (!sourcePath.startsWith(formatUploadPrefixFor(userId))) {
    return { ok: false, response: jsonError("The uploaded file does not belong to you", 403) };
  }
  const fileType = isFormatUploadKey(sourcePath) ? sourceExtensionOf(sourcePath) : null;
  if (!fileType) return { ok: false, response: jsonError("Invalid sourcePath", 400) };

  return { ok: true, fields, source: { kind: "direct", sourcePath, fileName, fileType } };
}

/** Multipart text field as a trimmed string, or undefined when absent/blank. */
function stringField(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
