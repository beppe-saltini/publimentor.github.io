/**
 * GET   /api/format/reports/[id]  -> { report, overrides, letterText, manuscript, profile, formatting, canFormat }
 * PATCH /api/format/reports/[id]  { overrides?, letterText? } -> same shape
 *
 * `formatting` is the Journal-Ready Formatter block (null until the report has
 * been formatted); see _lib/run-format.ts for its shape.
 *
 * PATCH semantics: incoming overrides are merged into the stored ones (an empty
 * object for a checkId clears it). When overrides change and no letterText is
 * supplied, the letter is regenerated from the stored results with the merged
 * overrides (recomposed with the stored plan when the report was formatted).
 * A supplied letterText is stored verbatim (the editor's hand edit wins over
 * regeneration).
 */

import { NextResponse } from "next/server";
import { formatReportPatchSchema } from "@/lib/api/validation";
import { prisma } from "@/lib/prisma";
import { jsonError, requireUser } from "../../_lib/guards";
import {
  loadAccessibleReport,
  mergeOverrides,
  parseOverrides,
  regenerateLetterText,
  reportDetailFromRow,
  resolveReportProfile,
  type Overrides,
} from "../../_lib/report-access";
import { toJson } from "../../_lib/run-check";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

export async function GET(_request: Request, { params }: Params) {
  try {
    const guard = await requireUser();
    if (!guard.ok) return guard.response;

    const { id } = await params;
    if (!ID_PATTERN.test(id)) return jsonError("Invalid report ID", 400);

    const loaded = await loadAccessibleReport(guard.userId, id);
    if (!loaded.ok) return jsonError(loaded.error, loaded.status);

    return NextResponse.json(await reportDetailFromRow(loaded.row));
  } catch (error) {
    console.error("[format/reports/:id] GET error:", error);
    return jsonError("Failed to load format report", 500);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const guard = await requireUser();
    if (!guard.ok) return guard.response;

    const { id } = await params;
    if (!ID_PATTERN.test(id)) return jsonError("Invalid report ID", 400);

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return jsonError("Invalid JSON body", 400);
    }
    const parsed = formatReportPatchSchema.safeParse(json);
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400);

    const loaded = await loadAccessibleReport(guard.userId, id);
    if (!loaded.ok) return jsonError(loaded.error, loaded.status);
    const { row } = loaded;

    const resolved = await resolveReportProfile(row);
    const overrides: Overrides = parsed.data.overrides
      ? mergeOverrides(parseOverrides(row.overrides), parsed.data.overrides as Overrides)
      : parseOverrides(row.overrides);

    const letterText =
      parsed.data.letterText !== undefined
        ? parsed.data.letterText
        : parsed.data.overrides
          ? regenerateLetterText(row, resolved.profile, overrides)
          : row.letterText;

    const updated = await prisma.formatCheckReport.update({
      where: { id: row.id },
      data: { overrides: toJson(overrides), letterText },
    });

    return NextResponse.json(await reportDetailFromRow(updated, resolved));
  } catch (error) {
    console.error("[format/reports/:id] PATCH error:", error);
    return jsonError("Failed to update format report", 500);
  }
}
