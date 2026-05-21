import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters").max(500).optional(),
  abstract: z.string().max(10000).optional(),
  keywords: z.array(z.string().min(1).max(100)).max(20).default([]),
  publisherId: z.string().min(1, "Publisher ID is required"),
  journalId: z.string().min(1).optional(),
});

function deriveTitle(abstract?: string, keywords?: string[], titleInput?: string): string {
  if (titleInput && titleInput.trim().length >= 3) {
    return titleInput.trim();
  }
  const abstractTrimmed = abstract?.trim() || "";
  if (abstractTrimmed.length >= 3) {
    const line = abstractTrimmed.split(/\n/)[0];
    return line.length > 80 ? `${line.slice(0, 77)}...` : line;
  }
  if (keywords && keywords.length > 0) {
    return "Keyword search";
  }
  return "Untitled manuscript";
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parseResult = requestSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error.issues[0].message },
        { status: 400 }
      );
    }

    const { title: titleInput, abstract, keywords, publisherId, journalId } = parseResult.data;
    const abstractTrimmed = abstract?.trim() || "";
    const hasAbstract = abstractTrimmed.length >= 20;
    const hasKeywords = keywords.length > 0;

    if (!hasAbstract && !hasKeywords && !titleInput) {
      return NextResponse.json(
        { error: "Provide a title, abstract (20+ characters), or at least one keyword" },
        { status: 400 }
      );
    }

    const membership = await prisma.publisherMember.findFirst({
      where: { userId: session.user.id, publisherId },
    });

    if (!membership) {
      return NextResponse.json({ error: "Not a member of this publisher" }, { status: 403 });
    }

    if (journalId) {
      const journalMember = await prisma.journalMember.findFirst({
        where: { userId: session.user.id, journalId },
      });
      if (!journalMember) {
        return NextResponse.json({ error: "Not a member of this journal" }, { status: 403 });
      }
    }

    const title = deriveTitle(abstractTrimmed, keywords, titleInput);

    const manuscript = await prisma.manuscript.create({
      data: {
        title,
        abstract: abstractTrimmed || null,
        extractedText: abstractTrimmed || null,
        keywords,
        publisherId,
        journalId: journalId || null,
        uploaderId: session.user.id,
        assignedEditorId: session.user.id,
        fileName: "manual-entry",
        fileType: "manual",
        fileMimeType: "text/plain",
        fileSize: 0,
        filePath: "",
        status: "READY",
        workflowStatus: "NEW",
      },
    });

    return NextResponse.json({ manuscriptId: manuscript.id, title: manuscript.title });
  } catch (error) {
    console.error("Error creating manual manuscript:", error);
    return NextResponse.json(
      { error: "Failed to create manuscript" },
      { status: 500 }
    );
  }
}
