/**
 * POST /api/format/check-manuscript — pre-accept format check of a manuscript
 * already in the library.
 *
 * JSON: { manuscriptId, journalSlug?, profileId?, format? }
 * -> { reportId, report: FormatCheckReport, manuscript, profile, formatting? }
 *
 * profileId overrides the journal's profile; format (default true) also runs
 * the Journal-Ready Formatter and adds the `formatting` block.
 *
 * Access follows the manuscript rules (findAccessibleManuscript), so journal
 * editors and publisher members can check files they did not upload. The
 * stored file must be a PDF or DOCX; LaTeX sources are rejected with 400.
 */

import { NextResponse } from "next/server";
import { formatCheckManuscriptSchema } from "@/lib/api/validation";
import { findAccessibleManuscript } from "@/lib/manuscript-access";
import { prisma } from "@/lib/prisma";
import { getStorage } from "@/lib/storage";
import { MAX_FORMAT_CHECK_BYTES, resolveAcceptedFileType } from "../_lib/file-input";
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

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return jsonError("Invalid JSON body", 400);
    }
    const parsed = formatCheckManuscriptSchema.safeParse(json);
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400);
    const { manuscriptId, journalSlug, profileId, format } = parsed.data;
    if (profileId && !isKnownProfileId(profileId)) return jsonError("Unknown profile id", 400);

    const accessible = await findAccessibleManuscript(userId, manuscriptId);
    if (!accessible) return jsonError("Manuscript not found", 404);

    const manuscript = await prisma.manuscript.findUnique({
      where: { id: manuscriptId },
      select: {
        id: true,
        title: true,
        fileName: true,
        fileType: true,
        fileMimeType: true,
        fileSize: true,
        filePath: true,
        storagePath: true,
        journalId: true,
      },
    });
    if (!manuscript) return jsonError("Manuscript not found", 404);

    const fileType = resolveAcceptedFileType({
      fileType: manuscript.fileType,
      mimeType: manuscript.fileMimeType,
      fileName: manuscript.fileName,
    });
    if (!fileType) return jsonError("Format check is only available for PDF and Word (.docx) manuscripts", 400);
    if (manuscript.fileSize > MAX_FORMAT_CHECK_BYTES) return jsonError("File exceeds the 25 MB limit", 413);

    const journal = await findJournal({ slug: journalSlug, id: manuscript.journalId });
    if (journalSlug && !journal) return jsonError("Journal not found", 404);

    let buffer: Buffer;
    try {
      buffer = await getStorage().download(manuscript.storagePath || manuscript.filePath);
    } catch (error) {
      console.error("[format/check-manuscript] Download failed:", error);
      return jsonError("File not found in storage", 404);
    }

    const body = await performFormatCheck({
      userId,
      buffer,
      fileName: manuscript.fileName,
      fileType,
      journal,
      manuscript: { id: manuscript.id, title: manuscript.title },
      profileId,
      format,
      startedAt,
    });
    return NextResponse.json(body);
  } catch (error) {
    if (error instanceof ManuscriptParseError) {
      return jsonError("Could not read the manuscript file. It may be corrupted.", 422);
    }
    console.error("[format/check-manuscript] Error:", error);
    return jsonError("Failed to check format", 500);
  }
}
