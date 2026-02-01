import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkFormat, defaultGuidelines, type FormatGuidelines } from "@/lib/format-checker";
import { prisma } from "@/lib/prisma";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { manuscriptId, journalSlug } = body;

    if (!manuscriptId) {
      return NextResponse.json({ error: "Manuscript ID is required" }, { status: 400 });
    }

    // Fetch manuscript from database
    const manuscript = await prisma.manuscript.findUnique({
      where: { id: manuscriptId },
      select: {
        id: true,
        filePath: true,
        fileType: true,
        uploaderId: true,
      },
    });

    if (!manuscript) {
      return NextResponse.json({ error: "Manuscript not found" }, { status: 404 });
    }

    // Check access (user must own the manuscript or be admin)
    if (manuscript.uploaderId !== session.user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Only PDF files can be format checked
    if (manuscript.fileType !== "pdf") {
      return NextResponse.json(
        { error: "Format check is only available for PDF files" },
        { status: 400 }
      );
    }

    // Get journal-specific guidelines if available
    let guidelines: FormatGuidelines = defaultGuidelines;

    if (journalSlug) {
      const journalGuidelines = await prisma.formatGuideline.findFirst({
        where: {
          journal: { slug: journalSlug },
        },
      });

      if (journalGuidelines) {
        guidelines = journalGuidelines.rules as FormatGuidelines;
      }
    }

    // Download file from storage
    const storage = getStorage();
    const fileBuffer = await storage.download(manuscript.filePath);

    // Parse PDF
    const { parsePDFBuffer } = await import("@/lib/pdf-parser");
    const content = await parsePDFBuffer(fileBuffer);

    // Check format
    const result = checkFormat(content, guidelines);

    return NextResponse.json({
      result,
      pdfInfo: {
        title: content.info.title,
        author: content.info.author,
        pages: content.numPages,
        wordCount: content.wordCount,
      },
    });
  } catch (error) {
    console.error("Error checking manuscript format:", error);
    return NextResponse.json(
      { error: "Failed to check format. The file may be corrupted or inaccessible." },
      { status: 500 }
    );
  }
}
