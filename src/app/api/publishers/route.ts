import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/publishers
 * Get publishers the current user has access to
 */
export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get publishers where user is a member
    const memberships = await prisma.publisherMember.findMany({
      where: { userId: session.user.id },
      include: {
        publisher: {
          include: {
            _count: {
              select: {
                journals: true,
                manuscripts: true,
                members: true,
              },
            },
          },
        },
      },
    });

    const publishers = memberships.map((m) => ({
      id: m.publisher.id,
      name: m.publisher.name,
      slug: m.publisher.slug,
      logoUrl: m.publisher.logoUrl,
      role: m.role,
      journalCount: m.publisher._count.journals,
      manuscriptCount: m.publisher._count.manuscripts,
      memberCount: m.publisher._count.members,
      createdAt: m.publisher.createdAt,
    }));

    return NextResponse.json({ publishers });
  } catch (error) {
    console.error("[Publishers] Error:", error);
    return NextResponse.json(
      { error: "Failed to get publishers" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/publishers
 * Create a new publisher
 */
export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { name, slug, logoUrl, website } = body;

    if (!name || !slug) {
      return NextResponse.json(
        { error: "Name and slug are required" },
        { status: 400 }
      );
    }

    // Check if slug is already taken
    const existing = await prisma.publisher.findUnique({
      where: { slug },
    });

    if (existing) {
      return NextResponse.json(
        { error: "Slug is already taken" },
        { status: 409 }
      );
    }

    // Create publisher and add user as owner
    const publisher = await prisma.publisher.create({
      data: {
        name,
        slug,
        logoUrl,
        website,
        members: {
          create: {
            userId: session.user.id,
            role: "OWNER",
          },
        },
      },
      include: {
        members: true,
      },
    });

    return NextResponse.json({
      publisher: {
        id: publisher.id,
        name: publisher.name,
        slug: publisher.slug,
        logoUrl: publisher.logoUrl,
        role: "OWNER",
      },
    });
  } catch (error) {
    console.error("[Publishers] Error creating publisher:", error);
    return NextResponse.json(
      { error: "Failed to create publisher" },
      { status: 500 }
    );
  }
}
