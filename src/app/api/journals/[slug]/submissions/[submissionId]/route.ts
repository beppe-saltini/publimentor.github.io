import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const updateSubmissionSchema = z.object({
  status: z.enum(["DRAFT", "SUBMITTED", "UNDER_REVIEW", "REVISION_REQUESTED", "ACCEPTED", "REJECTED"]).optional(),
  title: z.string().min(5).optional(),
  abstract: z.string().optional(),
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

    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        authors: {
          orderBy: { order: "asc" },
        },
        reviewAssignments: {
          include: {
            reviewer: {
              select: { id: true, name: true, email: true, institution: true },
            },
          },
        },
        formatReport: true,
        journal: true,
      },
    });

    if (!submission || submission.journalId !== journal.id) {
      return NextResponse.json({ error: "Submission not found" }, { status: 404 });
    }

    return NextResponse.json({ submission });
  } catch (error) {
    console.error("Error fetching submission:", error);
    return NextResponse.json({ error: "Failed to fetch submission" }, { status: 500 });
  }
}

export async function PATCH(
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
    const result = updateSubmissionSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error.issues[0].message },
        { status: 400 }
      );
    }

    const submission = await prisma.submission.update({
      where: { id: submissionId },
      data: result.data,
      include: {
        authors: true,
        reviewAssignments: {
          include: { reviewer: true },
        },
      },
    });

    return NextResponse.json({ submission });
  } catch (error) {
    console.error("Error updating submission:", error);
    return NextResponse.json({ error: "Failed to update submission" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string; submissionId: string }> }
) {
  try {
    const session = await auth();
    const { slug, submissionId } = await params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check admin access
    const membership = await prisma.journalMember.findFirst({
      where: {
        journal: { slug },
        userId: session.user.id,
        role: "ADMIN",
      },
    });

    if (!membership) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    await prisma.submission.delete({
      where: { id: submissionId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting submission:", error);
    return NextResponse.json({ error: "Failed to delete submission" }, { status: 500 });
  }
}
