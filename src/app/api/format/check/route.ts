/**
 * POST /api/format/check — pre-accept format check of an uploaded file.
 *
 * multipart/form-data: file (PDF or DOCX, <= 25 MB), journalSlug?, manuscriptId?,
 *                      profileId? (explicit profile override), format? (default true)
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
import { formatCheckUploadSchema } from "@/lib/api/validation";
import { findAccessibleManuscript } from "@/lib/manuscript-access";
import { prisma } from "@/lib/prisma";
import { fileProblemStatus, readUploadedManuscript } from "../_lib/file-input";
import { jsonError, requireUserWithinCheckLimit } from "../_lib/guards";
import { findJournal, isKnownProfileId, ManuscriptParseError, performFormatCheck } from "../_lib/run-check";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    const guard = await requireUserWithinCheckLimit();
    if (!guard.ok) return guard.response;
    const { userId } = guard;

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return jsonError("Expected multipart/form-data with a file field", 400);
    }

    // Accept the legacy "pdf" field name used by the previous UI as a fallback.
    const upload = await readUploadedManuscript(formData.get("file") ?? formData.get("pdf"));
    if (!upload.ok) return jsonError(upload.problem.message, fileProblemStatus(upload.problem));

    const fields = formatCheckUploadSchema.safeParse({
      journalSlug: stringField(formData, "journalSlug"),
      manuscriptId: stringField(formData, "manuscriptId"),
      profileId: stringField(formData, "profileId"),
      format: stringField(formData, "format"),
    });
    if (!fields.success) return jsonError(fields.error.issues[0].message, 400);
    const { journalSlug, manuscriptId, profileId, format } = fields.data;
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

    const body = await performFormatCheck({
      userId,
      buffer: upload.buffer,
      fileName: upload.fileName,
      fileType: upload.type,
      journal,
      manuscript,
      profileId,
      format,
      startedAt,
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

/** Multipart text field as a trimmed string, or undefined when absent/blank. */
function stringField(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
