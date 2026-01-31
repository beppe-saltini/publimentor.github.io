import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const updateJournalSchema = z.object({
  name: z.string().min(2).optional(),
  description: z.string().optional(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await auth();
    const { slug } = await params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const journal = await prisma.journal.findUnique({
      where: { slug },
      include: {
        members: {
          include: { user: true },
        },
        _count: {
          select: { submissions: true },
        },
      },
    });

    if (!journal) {
      return NextResponse.json({ error: "Journal not found" }, { status: 404 });
    }

    // Check if user is a member
    const isMember = journal.members.some((m) => m.userId === session.user.id);
    if (!isMember) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    return NextResponse.json({ journal });
  } catch (error) {
    console.error("Error fetching journal:", error);
    return NextResponse.json({ error: "Failed to fetch journal" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await auth();
    const { slug } = await params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const result = updateJournalSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error.issues[0].message },
        { status: 400 }
      );
    }

    // Check if user is an admin
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

    const journal = await prisma.journal.update({
      where: { slug },
      data: result.data,
    });

    return NextResponse.json({ journal });
  } catch (error) {
    console.error("Error updating journal:", error);
    return NextResponse.json({ error: "Failed to update journal" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await auth();
    const { slug } = await params;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is an admin
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

    await prisma.journal.delete({
      where: { slug },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting journal:", error);
    return NextResponse.json({ error: "Failed to delete journal" }, { status: 500 });
  }
}
