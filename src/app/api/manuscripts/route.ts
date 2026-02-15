import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/manuscripts
 * List manuscripts for the current user
 * Filtered by publisher and optionally by journal
 */
export async function GET(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const publisherId = searchParams.get("publisherId");
    const journalId = searchParams.get("journalId");
    const status = searchParams.get("status");
    
    // SECURITY: Validate and constrain pagination parameters
    const rawPage = parseInt(searchParams.get("page") || "1");
    const rawLimit = parseInt(searchParams.get("limit") || "20");
    
    // Constrain to safe ranges
    const page = Math.max(1, Math.min(1000, isNaN(rawPage) ? 1 : rawPage));
    const limit = Math.max(1, Math.min(100, isNaN(rawLimit) ? 20 : rawLimit)); // Max 100 per page
    const skip = (page - 1) * limit;

    // Build where clause
    const where: {
      OR?: { uploaderId: string }[];
      publisherId?: string;
      journalId?: string | null;
      status?: string;
    } = {};

    // User can see:
    // 1. Their own manuscripts
    // 2. Manuscripts from publishers they're a member of
    // 3. Manuscripts they have explicit permission for

    // Get user's publisher memberships
    const publisherMemberships = await prisma.publisherMember.findMany({
      where: { userId: session.user.id },
      select: { publisherId: true },
    });

    const publisherIds = publisherMemberships.map((m) => m.publisherId);

    // Get manuscripts user has permission for
    const permissions = await prisma.manuscriptPermission.findMany({
      where: {
        userId: session.user.id,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      select: { manuscriptId: true },
    });

    const permittedIds = permissions.map((p) => p.manuscriptId);

    // Build OR conditions
    where.OR = [
      { uploaderId: session.user.id },
    ];

    // Add publisher filter if specified
    if (publisherId) {
      // Verify user has access to this publisher
      if (!publisherIds.includes(publisherId)) {
        return NextResponse.json(
          { error: "You don't have access to this publisher" },
          { status: 403 }
        );
      }
      where.publisherId = publisherId;
    }

    // Add journal filter if specified
    if (journalId) {
      where.journalId = journalId;
    }

    // Add status filter if specified
    if (status) {
      where.status = status;
    }

    // Get manuscripts (exclude soft-deleted)
    const [manuscripts, total] = await Promise.all([
      prisma.manuscript.findMany({
        where: {
          AND: [
            { deletedAt: null },
            {
              OR: [
                { uploaderId: session.user.id },
                { publisherId: { in: publisherIds } },
                { id: { in: permittedIds } },
              ],
            },
            where.publisherId ? { publisherId: where.publisherId } : {},
            where.journalId ? { journalId: where.journalId } : {},
            where.status ? { status: where.status as any } : {},
          ],
        },
        include: {
          publisher: {
            select: { id: true, name: true, slug: true },
          },
          journal: {
            select: { id: true, name: true, slug: true },
          },
          uploader: {
            select: { id: true, name: true },
          },
          _count: {
            select: {
              authors: true,
              references: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.manuscript.count({
        where: {
          AND: [
            { deletedAt: null },
            {
              OR: [
                { uploaderId: session.user.id },
                { publisherId: { in: publisherIds } },
                { id: { in: permittedIds } },
              ],
            },
            where.publisherId ? { publisherId: where.publisherId } : {},
            where.journalId ? { journalId: where.journalId } : {},
            where.status ? { status: where.status as any } : {},
          ],
        },
      }),
    ]);

    return NextResponse.json({
      manuscripts: manuscripts.map((m) => ({
        id: m.id,
        title: m.title || "Untitled",
        status: m.status,
        statusMessage: m.statusMessage,
        fileName: m.fileName,
        fileType: m.fileType,
        fileSize: m.fileSize,
        wordCount: m.wordCount,
        pageCount: m.pageCount,
        authorCount: m._count.authors,
        referenceCount: m._count.references,
        publisher: m.publisher,
        journal: m.journal,
        uploader: m.uploader,
        isOwner: m.uploaderId === session.user.id,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("[Manuscripts] Error listing manuscripts:", error);
    return NextResponse.json(
      { error: "Failed to list manuscripts" },
      { status: 500 }
    );
  }
}
