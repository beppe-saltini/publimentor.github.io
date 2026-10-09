/**
 * POST /api/format/reports/[id]/format  { profileId?, repairReferences? }
 * -> same body as GET /api/format/reports/[id] (with a fresh `formatting` block)
 *
 * Re-runs the Journal-Ready Formatter on a stored report: the source file is
 * read back from storage and re-parsed, the stored check results (with the
 * editor's current overrides applied) feed the letter composer, and the
 * formatted/tracked documents, plan, change log and letter are replaced.
 * The checks themselves are not re-run.
 *
 * `profileId` switches the target profile for this and later runs (stored as
 * profileOverride); the stored results keep the check ids of the profile they
 * were produced with, so check-derived letter items only match when the ids
 * are shared. Same rate limit and time budget as the check routes.
 */

import { NextResponse } from "next/server";
import { formatReformatSchema } from "@/lib/api/validation";
import { prisma } from "@/lib/prisma";
import { MIME_FOR_TYPE } from "../../../_lib/file-input";
import { buildManuscriptModel } from "../../../_lib/format-lib";
import { getObject, ObjectNotFoundError, sourceExtensionOf } from "../../../_lib/format-storage";
import { jsonError, requireUserWithinCheckLimit } from "../../../_lib/guards";
import {
  loadAccessibleReport,
  parseOverrides,
  reportDetailFromRow,
  reportFromRow,
  resolveReportProfile,
} from "../../../_lib/report-access";
import { isKnownProfileId } from "../../../_lib/run-check";
import { runFormatting } from "../../../_lib/run-format";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const startedAt = Date.now();
  try {
    const guard = await requireUserWithinCheckLimit();
    if (!guard.ok) return guard.response;

    const { id } = await params;
    if (!ID_PATTERN.test(id)) return jsonError("Invalid report ID", 400);

    // The body is optional; an empty or absent body means "same settings as before".
    let json: unknown = {};
    const raw = await request.text();
    if (raw.trim()) {
      try {
        json = JSON.parse(raw);
      } catch {
        return jsonError("Invalid JSON body", 400);
      }
    }
    const parsed = formatReformatSchema.safeParse(json);
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400);
    const { profileId, repairReferences } = parsed.data;
    if (profileId && !isKnownProfileId(profileId)) return jsonError("Unknown profile id", 400);

    const loaded = await loadAccessibleReport(guard.userId, id);
    if (!loaded.ok) return jsonError(loaded.error, loaded.status);
    const { row } = loaded;

    const fileType = sourceExtensionOf(row.sourcePath);
    if (!row.sourcePath || !fileType) {
      return jsonError("No source file is stored for this report; run the check again to format it", 409);
    }

    let buffer: Buffer;
    try {
      buffer = await getObject(row.sourcePath);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) return jsonError("The source file is no longer in storage; run the check again", 409);
      throw error;
    }

    const profileOverride = profileId ?? row.profileOverride ?? null;
    const resolved = await resolveReportProfile({ ...row, profileOverride });
    const { profile, journal } = resolved;

    let model;
    try {
      model = await buildManuscriptModel({ buffer, fileName: row.fileName ?? `source.${fileType}`, mimeType: MIME_FOR_TYPE[fileType] });
    } catch (error) {
      console.error("[format/reports/:id/format] Parse failed:", error);
      return jsonError("Could not read the stored manuscript file", 422);
    }

    const report = reportFromRow(row, parseOverrides(row.overrides), profile);
    const formatted = await runFormatting({
      reportId: row.id,
      model,
      profile,
      report,
      sourceBuffer: buffer,
      fileType,
      journalName: journal?.name ?? profile.name,
      repairReferences,
      elapsedMs: Date.now() - startedAt,
      // A direct upload stays where it is; the default key would point at nothing.
      sourcePath: row.sourcePath,
    });

    const updated = await prisma.formatCheckReport.update({
      where: { id: row.id },
      data: { ...formatted.data, profileOverride },
    });
    return NextResponse.json(await reportDetailFromRow(updated, resolved));
  } catch (error) {
    console.error("[format/reports/:id/format] Error:", error);
    return jsonError("Failed to format manuscript", 500);
  }
}
