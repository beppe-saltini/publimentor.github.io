import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/manuscripts/:id/status
 * Get processing status for a manuscript (lightweight endpoint for polling)
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

    // Get manuscript status
    const manuscript = await prisma.manuscript.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        statusMessage: true,
        title: true,
        wordCount: true,
        pageCount: true,
        processingStarted: true,
        processingEnded: true,
        uploaderId: true,
        publisherId: true,
        _count: {
          select: {
            authors: true,
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

    // Check access (simplified - just check if uploader or publisher member)
    if (manuscript.uploaderId !== session.user.id) {
      const isMember = await prisma.publisherMember.findUnique({
        where: {
          userId_publisherId: {
            userId: session.user.id,
            publisherId: manuscript.publisherId,
          },
        },
      });

      if (!isMember) {
        return NextResponse.json(
          { error: "Access denied" },
          { status: 403 }
        );
      }
    }

    // Calculate progress based on status
    let progress = 0;
    let stage = "";

    switch (manuscript.status) {
      case "UPLOADED":
        progress = 10;
        stage = "Uploaded, waiting for processing";
        break;
      case "EXTRACTING":
        progress = 25;
        stage = "Extracting text from document";
        break;
      case "EXTRACTED":
        progress = 40;
        stage = "Text extracted, preparing metadata extraction";
        break;
      case "PROCESSING":
        progress = 60;
        stage = "Extracting metadata with AI";
        break;
      case "EMBEDDING":
        progress = 85;
        stage = "Generating document embeddings";
        break;
      case "READY":
        progress = 100;
        stage = "Processing complete";
        break;
      case "ERROR":
        progress = 0;
        stage = manuscript.statusMessage || "Processing failed";
        break;
    }

    // Calculate processing duration
    let processingDuration: number | null = null;
    if (manuscript.processingStarted) {
      const end = manuscript.processingEnded || new Date();
      processingDuration = Math.round(
        (end.getTime() - manuscript.processingStarted.getTime()) / 1000
      );
    }

    return NextResponse.json({
      id: manuscript.id,
      status: manuscript.status,
      statusMessage: manuscript.statusMessage,
      progress,
      stage,
      
      // Summary
      title: manuscript.title,
      wordCount: manuscript.wordCount,
      pageCount: manuscript.pageCount,
      authorCount: manuscript._count.authors,
      referenceCount: manuscript._count.references,
      chunkCount: manuscript._count.chunks,
      
      // Timing
      processingStarted: manuscript.processingStarted,
      processingEnded: manuscript.processingEnded,
      processingDuration,
      
      // Is processing complete?
      isComplete: manuscript.status === "READY",
      hasError: manuscript.status === "ERROR",
    });
  } catch (error) {
    console.error("[Status] Error:", error);
    return NextResponse.json(
      { error: "Failed to get status" },
      { status: 500 }
    );
  }
}
