import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { findDuplicateManuscripts } from "@/lib/manuscript/find-duplicate-manuscripts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/manuscripts/upload/check-duplicate
 *
 * Check whether an upload likely duplicates an existing manuscript for this user.
 */
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { publisherId, fileHash, fileName, fileSize } = body as {
      publisherId?: string;
      fileHash?: string;
      fileName?: string;
      fileSize?: number;
    };

    if (!publisherId) {
      return NextResponse.json({ error: "publisherId is required" }, { status: 400 });
    }

    const publisherMember = await prisma.publisherMember.findUnique({
      where: {
        userId_publisherId: {
          userId: session.user.id,
          publisherId,
        },
      },
    });

    if (!publisherMember) {
      return NextResponse.json(
        { error: "You don't have access to this publisher" },
        { status: 403 }
      );
    }

    const result = await findDuplicateManuscripts({
      publisherId,
      uploaderId: session.user.id,
      fileHash,
      fileName,
      fileSize,
    });

    return NextResponse.json({
      isDuplicate: result.isDuplicate,
      reason: result.reason,
      matches: result.matches.map((m) => ({
        ...m,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("[CheckDuplicate] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to check duplicate" },
      { status: 500 }
    );
  }
}
