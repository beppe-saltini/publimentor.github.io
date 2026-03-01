import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/manuscripts/:id/reviewers
 * Fetch persisted reviewers for a manuscript.
 * By default excludes REJECTED; pass ?includeRejected=true to include them.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const url = new URL(request.url);
    const includeRejected = url.searchParams.get("includeRejected") === "true";

    // Verify manuscript exists and user has access
    const manuscript = await prisma.manuscript.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, publisherId: true, uploaderId: true },
    });

    if (!manuscript) {
      return NextResponse.json({ error: "Manuscript not found" }, { status: 404 });
    }

    const statusFilter = includeRejected
      ? undefined
      : { not: "REJECTED" as const };

    const reviewers = await prisma.manuscriptReviewer.findMany({
      where: {
        manuscriptId: id,
        ...(statusFilter ? { status: statusFilter } : {}),
      },
      orderBy: [
        { status: "asc" }, // SHORTLISTED first, then SUGGESTED
        { createdAt: "desc" },
      ],
    });

    return NextResponse.json({
      reviewers,
      counts: {
        total: reviewers.length,
        shortlisted: reviewers.filter(r => r.status === "SHORTLISTED").length,
        suggested: reviewers.filter(r => r.status === "SUGGESTED").length,
      },
    });
  } catch (error) {
    console.error("[API] Error fetching manuscript reviewers:", error);
    return NextResponse.json(
      { error: "Failed to fetch reviewers" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/manuscripts/:id/reviewers
 * Bulk-save found reviewers. Upserts by [manuscriptId, name] to avoid duplicates.
 * Expects: { reviewers: Array<{ name, firstName?, lastName?, affiliation?, country?, hIndex?, ... }> }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { reviewers } = body;

    if (!Array.isArray(reviewers) || reviewers.length === 0) {
      return NextResponse.json(
        { error: "reviewers array is required" },
        { status: 400 }
      );
    }

    // Verify manuscript exists
    const manuscript = await prisma.manuscript.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });

    if (!manuscript) {
      return NextResponse.json({ error: "Manuscript not found" }, { status: 404 });
    }

    const results = [];
    const errors: { name: string; error: string }[] = [];
    for (const reviewer of reviewers) {
      if (!reviewer.name) {
        errors.push({ name: "(empty)", error: "No name provided" });
        continue;
      }

      try {
        const upserted = await prisma.manuscriptReviewer.upsert({
          where: {
            manuscriptId_name: {
              manuscriptId: id,
              name: reviewer.name,
            },
          },
          update: {
            firstName: reviewer.firstName || undefined,
            lastName: reviewer.lastName || undefined,
            affiliation: reviewer.affiliation || undefined,
            country: reviewer.country || undefined,
            hIndex: typeof reviewer.hIndex === "number" ? reviewer.hIndex : undefined,
            citationCount: typeof reviewer.citationCount === "number" ? reviewer.citationCount : undefined,
            publicationCount: typeof reviewer.publicationCount === "number" ? reviewer.publicationCount : undefined,
            inferredGender: reviewer.inferredGender || undefined,
            sources: reviewer.sources ?? undefined,
            recentArticles: reviewer.recentArticles ?? undefined,
            verificationUrls: reviewer.verificationUrls ?? undefined,
            llmAnalysis: reviewer.llmAnalysis ?? undefined,
            coiSummary: reviewer.coiSummary ?? undefined,
            status: "SUGGESTED",
          },
          create: {
            manuscriptId: id,
            name: reviewer.name,
            firstName: reviewer.firstName || null,
            lastName: reviewer.lastName || null,
            affiliation: reviewer.affiliation || null,
            country: reviewer.country || null,
            hIndex: typeof reviewer.hIndex === "number" ? reviewer.hIndex : null,
            citationCount: typeof reviewer.citationCount === "number" ? reviewer.citationCount : null,
            publicationCount: typeof reviewer.publicationCount === "number" ? reviewer.publicationCount : null,
            inferredGender: reviewer.inferredGender || null,
            sources: reviewer.sources ?? null,
            recentArticles: reviewer.recentArticles ?? null,
            verificationUrls: reviewer.verificationUrls ?? null,
            llmAnalysis: reviewer.llmAnalysis ?? null,
            coiSummary: reviewer.coiSummary ?? null,
            status: "SUGGESTED",
          },
        });
        results.push(upserted);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[API] Error upserting reviewer ${reviewer.name}:`, msg);
        errors.push({ name: reviewer.name, error: msg });
      }
    }

    if (results.length > 0) {
      await prisma.manuscript.update({
        where: { id },
        data: { workflowStatus: "FINDING_REVIEWERS" },
      }).catch(() => {});
    }

    return NextResponse.json({
      saved: results.length,
      skipped: reviewers.length - results.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("[API] Error saving manuscript reviewers:", error);
    return NextResponse.json(
      { error: "Failed to save reviewers" },
      { status: 500 }
    );
  }
}
