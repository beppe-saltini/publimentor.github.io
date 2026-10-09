/**
 * GET /api/format/reports/[id]/letter?format=docx|txt — download the
 * author-facing letter. `txt` (default) streams the stored letter text;
 * `docx` renders it with letterToDocx. Both set Content-Disposition so the
 * browser saves a file named after the manuscript (or the report id).
 */

import { formatLetterFormatSchema } from "@/lib/api/validation";
import { letterToDocx } from "../../../_lib/format-lib";
import { jsonError, requireUser } from "../../../_lib/guards";
import { DOCX_MIME, fileResponse, letterFileName } from "../../../_lib/letter-download";
import { loadAccessibleReport, reportDetailFromRow } from "../../../_lib/report-access";

export const dynamic = "force-dynamic";

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireUser();
    if (!guard.ok) return guard.response;

    const { id } = await params;
    if (!ID_PATTERN.test(id)) return jsonError("Invalid report ID", 400);

    const format = formatLetterFormatSchema.safeParse(new URL(request.url).searchParams.get("format") ?? undefined);
    if (!format.success) return jsonError("format must be docx or txt", 400);

    const loaded = await loadAccessibleReport(guard.userId, id);
    if (!loaded.ok) return jsonError(loaded.error, loaded.status);

    const detail = await reportDetailFromRow(loaded.row);
    const baseName = letterFileName(detail.manuscript.title, detail.report.id);

    if (format.data === "docx") {
      const docx = await letterToDocx(detail.report.letter, {
        manuscriptTitle: detail.manuscript.title,
        journalName: detail.profile.name,
      });
      return fileResponse(new Uint8Array(docx), DOCX_MIME, `${baseName}.docx`);
    }

    return fileResponse(new TextEncoder().encode(detail.letterText), "text/plain; charset=utf-8", `${baseName}.txt`);
  } catch (error) {
    console.error("[format/reports/:id/letter] Error:", error);
    return jsonError("Failed to build letter", 500);
  }
}
