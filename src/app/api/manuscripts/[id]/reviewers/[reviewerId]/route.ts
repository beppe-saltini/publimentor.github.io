import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/manuscripts/:id/reviewers/:reviewerId
 * Update a reviewer's status (thumbs up = SHORTLISTED, thumbs down = REJECTED)
 * Expects: { status: "SUGGESTED" | "SHORTLISTED" | "REJECTED" }
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; reviewerId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, reviewerId } = await params;
    const body = await request.json();
    const { status } = body;

    if (!status || !["SUGGESTED", "SHORTLISTED", "REJECTED"].includes(status)) {
      return NextResponse.json(
        { error: "Valid status required: SUGGESTED, SHORTLISTED, or REJECTED" },
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

    // Update the reviewer status
    const updated = await prisma.manuscriptReviewer.update({
      where: { id: reviewerId },
      data: { status },
    });

    return NextResponse.json({ reviewer: updated });
  } catch (error) {
    console.error("[API] Error updating reviewer status:", error);
    return NextResponse.json(
      { error: "Failed to update reviewer" },
      { status: 500 }
    );
  }
}
