import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/manuscripts/:id/reviewers/:reviewerId
 * Update a reviewer's status and/or assigned expertise.
 * Expects: { status?: "SUGGESTED" | "SHORTLISTED" | "REJECTED", assignedExpertise?: string[] }
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
    const { status, assignedExpertise } = body;

    if (status && !["SUGGESTED", "SHORTLISTED", "REJECTED"].includes(status)) {
      return NextResponse.json(
        { error: "Valid status required: SUGGESTED, SHORTLISTED, or REJECTED" },
        { status: 400 }
      );
    }

    if (assignedExpertise !== undefined && !Array.isArray(assignedExpertise)) {
      return NextResponse.json(
        { error: "assignedExpertise must be a string array" },
        { status: 400 }
      );
    }

    if (!status && assignedExpertise === undefined) {
      return NextResponse.json(
        { error: "Provide status or assignedExpertise" },
        { status: 400 }
      );
    }

    const manuscript = await prisma.manuscript.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });

    if (!manuscript) {
      return NextResponse.json({ error: "Manuscript not found" }, { status: 404 });
    }

    const data: Record<string, unknown> = {};
    if (status) data.status = status;
    if (assignedExpertise !== undefined) data.assignedExpertise = assignedExpertise;

    const updated = await prisma.manuscriptReviewer.update({
      where: { id: reviewerId },
      data,
    });

    return NextResponse.json({ reviewer: updated });
  } catch (error) {
    console.error("[API] Error updating reviewer:", error);
    return NextResponse.json(
      { error: "Failed to update reviewer" },
      { status: 500 }
    );
  }
}
