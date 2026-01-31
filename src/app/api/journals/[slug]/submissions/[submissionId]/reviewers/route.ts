import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const assignReviewerSchema = z.object({
  reviewerId: z.string().min(1, "Reviewer ID is required"),
  coiCleared: z.boolean().optional(),
  coiReport: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; submissionId: string }> }
) {
  try {
    const session = await auth();
    const { slug, submissionId } = await params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const journal = await prisma.journal.findUnique({
      where: { slug },
      include: {
        members: {
          where: { userId: session.user.id },
        },
      },
    });

    if (!journal || journal.members.length === 0) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const assignments = await prisma.reviewAssignment.findMany({
      where: { submissionId },
      include: {
        reviewer: {
          select: {
            id: true,
            name: true,
            email: true,
            institution: true,
            orcid: true,
          },
        },
      },
    });

    return NextResponse.json({ assignments });
  } catch (error) {
    console.error("Error fetching review assignments:", error);
    return NextResponse.json(
      { error: "Failed to fetch assignments" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string; submissionId: string }> }
) {
  try {
    const session = await auth();
    const { slug, submissionId } = await params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check editor/admin access
    const membership = await prisma.journalMember.findFirst({
      where: {
        journal: { slug },
        userId: session.user.id,
        role: { in: ["ADMIN", "EDITOR"] },
      },
    });

    if (!membership) {
      return NextResponse.json({ error: "Editor access required" }, { status: 403 });
    }

    const body = await request.json();
    const result = assignReviewerSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error.issues[0].message },
        { status: 400 }
      );
    }

    const { reviewerId, coiCleared = false, coiReport } = result.data;

    // Check if submission exists
    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
    });

    if (!submission) {
      return NextResponse.json({ error: "Submission not found" }, { status: 404 });
    }

    // Check if reviewer exists
    const reviewer = await prisma.user.findUnique({
      where: { id: reviewerId },
    });

    if (!reviewer) {
      return NextResponse.json({ error: "Reviewer not found" }, { status: 404 });
    }

    // Check if already assigned
    const existingAssignment = await prisma.reviewAssignment.findUnique({
      where: {
        reviewerId_submissionId: {
          reviewerId,
          submissionId,
        },
      },
    });

    if (existingAssignment) {
      return NextResponse.json(
        { error: "Reviewer already assigned to this submission" },
        { status: 400 }
      );
    }

    const assignment = await prisma.reviewAssignment.create({
      data: {
        reviewerId,
        submissionId,
        coiCleared,
        coiReport: coiReport ? JSON.parse(JSON.stringify(coiReport)) : undefined,
        status: "PENDING",
      },
      include: {
        reviewer: {
          select: {
            id: true,
            name: true,
            email: true,
            institution: true,
          },
        },
      },
    });

    return NextResponse.json({ assignment }, { status: 201 });
  } catch (error) {
    console.error("Error assigning reviewer:", error);
    return NextResponse.json(
      { error: "Failed to assign reviewer" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string; submissionId: string }> }
) {
  try {
    const session = await auth();
    const { slug, submissionId } = await params;
    const { searchParams } = new URL(request.url);
    const assignmentId = searchParams.get("assignmentId");

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!assignmentId) {
      return NextResponse.json({ error: "Assignment ID required" }, { status: 400 });
    }

    // Check editor/admin access
    const membership = await prisma.journalMember.findFirst({
      where: {
        journal: { slug },
        userId: session.user.id,
        role: { in: ["ADMIN", "EDITOR"] },
      },
    });

    if (!membership) {
      return NextResponse.json({ error: "Editor access required" }, { status: 403 });
    }

    await prisma.reviewAssignment.delete({
      where: { id: assignmentId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error removing reviewer:", error);
    return NextResponse.json(
      { error: "Failed to remove reviewer" },
      { status: 500 }
    );
  }
}
