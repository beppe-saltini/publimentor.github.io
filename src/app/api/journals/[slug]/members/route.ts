import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const addMemberSchema = z.object({
  email: z.string().email("Invalid email address"),
  role: z.enum(["ADMIN", "EDITOR", "REVIEWER"]),
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
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                image: true,
                institution: true,
              },
            },
          },
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

    return NextResponse.json({ members: journal.members });
  } catch (error) {
    console.error("Error fetching members:", error);
    return NextResponse.json({ error: "Failed to fetch members" }, { status: 500 });
  }
}

export async function POST(
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
    const result = addMemberSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error.issues[0].message },
        { status: 400 }
      );
    }

    const { email, role } = result.data;

    // Check if current user is an admin or editor
    const currentMembership = await prisma.journalMember.findFirst({
      where: {
        journal: { slug },
        userId: session.user.id,
        role: { in: ["ADMIN", "EDITOR"] },
      },
    });

    if (!currentMembership) {
      return NextResponse.json({ error: "Editor or Admin access required" }, { status: 403 });
    }

    // Find user by email
    const userToAdd = await prisma.user.findUnique({
      where: { email },
    });

    if (!userToAdd) {
      return NextResponse.json(
        { error: "No user found with this email. They need to register first." },
        { status: 404 }
      );
    }

    // Check if already a member
    const journal = await prisma.journal.findUnique({
      where: { slug },
    });

    if (!journal) {
      return NextResponse.json({ error: "Journal not found" }, { status: 404 });
    }

    const existingMembership = await prisma.journalMember.findUnique({
      where: {
        userId_journalId: {
          userId: userToAdd.id,
          journalId: journal.id,
        },
      },
    });

    if (existingMembership) {
      return NextResponse.json({ error: "User is already a member" }, { status: 400 });
    }

    // Add member
    const member = await prisma.journalMember.create({
      data: {
        userId: userToAdd.id,
        journalId: journal.id,
        role,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            institution: true,
          },
        },
      },
    });

    return NextResponse.json({ member }, { status: 201 });
  } catch (error) {
    console.error("Error adding member:", error);
    return NextResponse.json({ error: "Failed to add member" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await auth();
    const { slug } = await params;
    const { searchParams } = new URL(request.url);
    const memberId = searchParams.get("memberId");

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!memberId) {
      return NextResponse.json({ error: "Member ID required" }, { status: 400 });
    }

    // Check if current user is an admin
    const currentMembership = await prisma.journalMember.findFirst({
      where: {
        journal: { slug },
        userId: session.user.id,
        role: "ADMIN",
      },
    });

    if (!currentMembership) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    // Prevent removing the last admin
    const memberToRemove = await prisma.journalMember.findUnique({
      where: { id: memberId },
      include: { journal: true },
    });

    if (memberToRemove?.role === "ADMIN") {
      const adminCount = await prisma.journalMember.count({
        where: {
          journalId: memberToRemove.journalId,
          role: "ADMIN",
        },
      });

      if (adminCount <= 1) {
        return NextResponse.json(
          { error: "Cannot remove the last admin" },
          { status: 400 }
        );
      }
    }

    await prisma.journalMember.delete({
      where: { id: memberId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error removing member:", error);
    return NextResponse.json({ error: "Failed to remove member" }, { status: 500 });
  }
}
