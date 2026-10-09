/**
 * GET /api/format/reports?manuscriptId=&journalSlug=
 * -> { reports: Array<{ id, checkedAt, profileId, profileVersion, manuscriptId, journalId, fileName, summary }> }
 *
 * Latest 20 reports the user ran or whose manuscript they can access.
 */

import { NextResponse } from "next/server";
import { formatReportsQuerySchema } from "@/lib/api/validation";
import { prisma } from "@/lib/prisma";
import { jsonError, requireUser } from "../_lib/guards";
import { listAccessibleReports } from "../_lib/report-access";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const guard = await requireUser();
    if (!guard.ok) return guard.response;

    const url = new URL(request.url);
    const parsed = formatReportsQuerySchema.safeParse({
      manuscriptId: url.searchParams.get("manuscriptId") || undefined,
      journalSlug: url.searchParams.get("journalSlug") || undefined,
    });
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400);
    const { manuscriptId, journalSlug } = parsed.data;

    let journalId: string | undefined;
    if (journalSlug) {
      const journal = await prisma.journal.findUnique({ where: { slug: journalSlug }, select: { id: true } });
      // Unknown slug: nothing can match, answer with an empty list rather than an error.
      if (!journal) return NextResponse.json({ reports: [] });
      journalId = journal.id;
    }

    const reports = await listAccessibleReports(guard.userId, { manuscriptId, journalId });
    return NextResponse.json({ reports });
  } catch (error) {
    console.error("[format/reports] Error:", error);
    return jsonError("Failed to list format reports", 500);
  }
}
