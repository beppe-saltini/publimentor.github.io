import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/manuscripts/:id
 * Get manuscript details with processing status
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

    // Get manuscript with all related data (exclude soft-deleted)
    const manuscript = await prisma.manuscript.findFirst({
      where: { id, deletedAt: null },
      include: {
        publisher: {
          select: { id: true, name: true, slug: true },
        },
        journal: {
          select: { id: true, name: true, slug: true },
        },
        uploader: {
          select: { id: true, name: true, email: true },
        },
        authors: {
          orderBy: { authorOrder: "asc" },
        },
        affiliations: {
          orderBy: { affiliationNumber: "asc" },
        },
        references: {
          orderBy: { refNumber: "asc" },
          take: 50, // Limit references returned
        },
        processingJobs: {
          orderBy: { createdAt: "desc" },
          take: 10,
        },
        _count: {
          select: {
            references: true,
            chunks: true,
          },
        },
      },
    });

    if (!manuscript) {
      return NextResponse.json(
        { error: "Manuscript not found" },
        { status: 404 }
      );
    }

    // Check access: must be uploader, have permission, or be publisher/journal member
    const hasAccess = await checkManuscriptAccess(
      session.user.id,
      manuscript.id,
      manuscript.publisherId,
      manuscript.journalId
    );

    if (!hasAccess) {
      return NextResponse.json(
        { error: "You don't have access to this manuscript" },
        { status: 403 }
      );
    }

    return NextResponse.json({
      manuscript: {
        id: manuscript.id,
        title: manuscript.title,
        abstract: manuscript.abstract,
        keywords: manuscript.keywords,
        manuscriptType: manuscript.manuscriptType,
        language: manuscript.language,
        status: manuscript.status,
        statusMessage: manuscript.statusMessage,
        workflowStatus: manuscript.workflowStatus,
        detectedJournal: manuscript.detectedJournal,
        
        // File info
        fileName: manuscript.fileName,
        fileType: manuscript.fileType,
        fileSize: manuscript.fileSize,
        
        // Statistics
        wordCount: manuscript.wordCount,
        pageCount: manuscript.pageCount,
        figureCount: manuscript.figureCount,
        tableCount: manuscript.tableCount,
        referenceCount: manuscript._count.references,
        chunkCount: manuscript._count.chunks,
        
        // Declarations
        declarations: {
          funding: manuscript.fundingStatement,
          conflictOfInterest: manuscript.coiStatement,
          dataAvailability: manuscript.dataAvailability,
          ethics: manuscript.ethicsStatement,
          authorContributions: manuscript.authorContribs,
        },
        
        // Related data
        publisher: manuscript.publisher,
        journal: manuscript.journal,
        uploader: manuscript.uploader,
        authors: manuscript.authors,
        affiliations: manuscript.affiliations,
        references: manuscript.references,
        
        // Processing (strip internal error details from client response)
        processingJobs: manuscript.processingJobs.map((j: Record<string, unknown>) => ({
          id: j.id,
          jobType: j.jobType,
          status: j.status,
          progress: j.progress,
          startedAt: j.startedAt,
          completedAt: j.completedAt,
          createdAt: j.createdAt,
        })),
        processingStarted: manuscript.processingStarted,
        processingEnded: manuscript.processingEnded,
        
        // Version
        version: manuscript.version,
        
        // Timestamps
        createdAt: manuscript.createdAt,
        updatedAt: manuscript.updatedAt,
      },
    });
  } catch (error) {
    console.error("[Manuscript] Error getting manuscript:", error);
    return NextResponse.json(
      { error: "Failed to get manuscript" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/manuscripts/:id
 * Delete a manuscript (only by uploader or admin)
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const manuscript = await prisma.manuscript.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        uploaderId: true,
        publisherId: true,
        filePath: true,
        status: true,
      },
    });

    if (!manuscript) {
      return NextResponse.json(
        { error: "Manuscript not found" },
        { status: 404 }
      );
    }

    // Check if user is uploader or publisher admin
    const isUploader = manuscript.uploaderId === session.user.id;
    
    const isPublisherAdmin = await prisma.publisherMember.findFirst({
      where: {
        userId: session.user.id,
        publisherId: manuscript.publisherId,
        role: { in: ["OWNER", "ADMIN"] },
      },
    });

    if (!isUploader && !isPublisherAdmin) {
      return NextResponse.json(
        { error: "Only the uploader or publisher admin can delete this manuscript" },
        { status: 403 }
      );
    }

    // Check if manuscript is actively processing (Finding 12)
    const activeStatuses = ["EXTRACTING", "PROCESSING", "EMBEDDING"];
    if (activeStatuses.includes(manuscript.status as string)) {
      return NextResponse.json(
        { error: "Cannot delete a manuscript that is currently being processed. Wait for processing to complete." },
        { status: 409 }
      );
    }

    // Soft delete (compliance: retain records for audit trail)
    await prisma.manuscript.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        deletedBy: session.user.id,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Manuscript deleted successfully",
    });
  } catch (error) {
    console.error("[Manuscript] Error deleting manuscript:", error);
    return NextResponse.json(
      { error: "Failed to delete manuscript" },
      { status: 500 }
    );
  }
}

/**
 * Check if user has access to a manuscript
 */
async function checkManuscriptAccess(
  userId: string,
  manuscriptId: string,
  publisherId: string,
  journalId: string | null
): Promise<boolean> {
  // Check if user is the uploader
  const manuscript = await prisma.manuscript.findFirst({
    where: {
      id: manuscriptId,
      uploaderId: userId,
    },
  });

  if (manuscript) return true;

  // Check if user has explicit permission
  const permission = await prisma.manuscriptPermission.findUnique({
    where: {
      manuscriptId_userId: {
        manuscriptId,
        userId,
      },
    },
  });

  if (permission) {
    // Check if permission hasn't expired
    if (!permission.expiresAt || permission.expiresAt > new Date()) {
      return true;
    }
  }

  // Check if user is publisher member
  const publisherMember = await prisma.publisherMember.findUnique({
    where: {
      userId_publisherId: {
        userId,
        publisherId,
      },
    },
  });

  if (publisherMember) return true;

  // Check if user is journal member (editor/admin)
  if (journalId) {
    const journalMember = await prisma.journalMember.findFirst({
      where: {
        userId,
        journalId,
        role: { in: ["ADMIN", "EDITOR"] },
      },
    });

    if (journalMember) return true;
  }

  return false;
}
