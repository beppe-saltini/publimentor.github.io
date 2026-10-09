/**
 * GET /api/format/reports/[id]/file?kind=formatted|tracked|change-log|letter[&format=docx|txt]
 *
 * Streams the Journal-Ready Formatter outputs of a report as attachments:
 *   formatted   rebuilt journal-ready .docx (stored object)
 *   tracked     original .docx with tracked changes (stored object; docx sources only)
 *   change-log  engine change log, text/plain (from the row)
 *   letter      author letter, .docx by default or .txt (from the stored letter text)
 *
 * A kind the report does not have answers 404. Every response carries
 * Content-Disposition: attachment and X-Content-Type-Options: nosniff.
 */

import { formatFileKindSchema, formatLetterFileFormatSchema } from "@/lib/api/validation";
import { letterToDocx } from "../../../_lib/format-lib";
import { getObject, ObjectNotFoundError } from "../../../_lib/format-storage";
import { jsonError, requireUser } from "../../../_lib/guards";
import { DOCX_MIME, downloadFileName, fileResponse } from "../../../_lib/letter-download";
import { loadAccessibleReport, reportDetailFromRow } from "../../../_lib/report-access";

export const dynamic = "force-dynamic";

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const TEXT_MIME = "text/plain; charset=utf-8";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireUser();
    if (!guard.ok) return guard.response;

    const { id } = await params;
    if (!ID_PATTERN.test(id)) return jsonError("Invalid report ID", 400);

    const query = new URL(request.url).searchParams;
    const kind = formatFileKindSchema.safeParse(query.get("kind") ?? undefined);
    if (!kind.success) return jsonError("kind must be formatted, tracked, change-log or letter", 400);
    const letterFormat = formatLetterFileFormatSchema.safeParse(query.get("format") ?? undefined);
    if (!letterFormat.success) return jsonError("format must be docx or txt", 400);

    const loaded = await loadAccessibleReport(guard.userId, id);
    if (!loaded.ok) return jsonError(loaded.error, loaded.status);
    const { row } = loaded;

    // The detail gives the manuscript title (file names) and the journal name (letter heading).
    const detail = await reportDetailFromRow(row);
    const title = detail.manuscript.title;

    switch (kind.data) {
      case "formatted":
      case "tracked": {
        const path = kind.data === "formatted" ? row.formattedPath : row.trackedPath;
        if (!path) return jsonError(`No ${kind.data} document is available for this report`, 404);
        const prefix = kind.data === "formatted" ? "journal-ready" : "tracked-changes";
        try {
          const bytes = await getObject(path);
          return fileResponse(new Uint8Array(bytes), DOCX_MIME, `${downloadFileName(prefix, title, id)}.docx`);
        } catch (error) {
          if (error instanceof ObjectNotFoundError) return jsonError(`The ${kind.data} document is no longer in storage`, 404);
          throw error;
        }
      }
      case "change-log": {
        if (!row.changeLogText) return jsonError("No change log is available for this report", 404);
        return fileResponse(new TextEncoder().encode(row.changeLogText), TEXT_MIME, `${downloadFileName("change-log", title, id)}.txt`);
      }
      case "letter": {
        const baseName = downloadFileName("pre-accept-letter", title, id);
        if (letterFormat.data === "txt") {
          return fileResponse(new TextEncoder().encode(detail.letterText), TEXT_MIME, `${baseName}.txt`);
        }
        // letterToDocx lays out letter.text line by line, so the composed (or hand-edited) text is used as stored.
        const docx = await letterToDocx(
          { ...detail.report.letter, text: detail.letterText },
          { manuscriptTitle: title, journalName: detail.profile.name }
        );
        return fileResponse(new Uint8Array(docx), DOCX_MIME, `${baseName}.docx`);
      }
    }
  } catch (error) {
    console.error("[format/reports/:id/file] Error:", error);
    return jsonError("Failed to download file", 500);
  }
}
