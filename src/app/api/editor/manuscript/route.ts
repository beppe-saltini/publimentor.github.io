import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { getEditorContext } from "@/lib/editor-context";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  title: z.string().min(3).max(500).optional(),
  abstract: z.string().max(10000).optional(),
  keywords: z.array(z.string().min(1).max(100)).max(20).default([]),
});

function deriveTitle(abstract?: string, keywords?: string[]): string {
  if (abstract && abstract.trim().length >= 3) {
    const line = abstract.trim().split(/\n/)[0];
    return line.length > 80 ? `${line.slice(0, 77)}...` : line;
  }
  if (keywords && keywords.length > 0) {
    return "Keyword search";
  }
  return "Untitled manuscript";
}

/**
 * POST /api/editor/manuscript
 * Creates a manual manuscript with server-injected journalId (no journal name exposed).
 */
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ctx = await getEditorContext(session.user.id);
    if (!ctx.hasJournal || !ctx.journalId || !ctx.publisherId) {
      return NextResponse.json(
        { error: "No journal assigned to your account" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const parseResult = requestSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error.issues[0].message },
        { status: 400 }
      );
    }

    const { title: titleInput, abstract, keywords } = parseResult.data;
    const abstractTrimmed = abstract?.trim() || "";
    const hasAbstract = abstractTrimmed.length >= 20;
    const hasKeywords = keywords.length > 0;

    if (!hasAbstract && !hasKeywords) {
      return NextResponse.json(
        { error: "Provide an abstract (at least 20 characters) or at least one keyword" },
        { status: 400 }
      );
    }

    const membership = await prisma.publisherMember.findFirst({
      where: { userId: session.user.id, publisherId: ctx.publisherId },
    });
    if (!membership) {
      return NextResponse.json(
        { error: "You don't have access to upload for this organization" },
        { status: 403 }
      );
    }

    const title = titleInput?.trim() || deriveTitle(abstractTrimmed, keywords);

    const manuscript = await prisma.manuscript.create({
      data: {
        title,
        abstract: abstractTrimmed || null,
        extractedText: abstractTrimmed || null,
        keywords,
        publisherId: ctx.publisherId,
        journalId: ctx.journalId,
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

    await prisma.user.update({
      where: { id: session.user.id },
      data: { lastVisitedJournalId: ctx.journalId },
    }).catch(() => {});

    return NextResponse.json({
      manuscriptId: manuscript.id,
      title: manuscript.title,
    });
  } catch (error) {
    console.error("[EditorManuscript] Error:", error);
    return NextResponse.json(
      { error: "Failed to create manuscript" },
      { status: 500 }
    );
  }
}
