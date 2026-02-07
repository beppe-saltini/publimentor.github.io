import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const addFavouriteSchema = z.object({
  journalName: z.string().min(1).max(200),
  notes: z.string().max(500).optional(),
});

/**
 * GET /api/user/favourites — list user's favourite journals
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const favourites = await prisma.favouriteJournal.findMany({
      where: { userId: session.user.id },
      include: {
        journal: {
          select: {
            id: true,
            name: true,
            slug: true,
            description: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ favourites });
  } catch (error) {
    console.error("Error fetching favourites:", error);
    return NextResponse.json({ error: "Failed to fetch favourites" }, { status: 500 });
  }
}

/**
 * POST /api/user/favourites — add a journal to favourites
 * If the journal doesn't exist, creates a lightweight journal entry.
 */
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = addFavouriteSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { journalName, notes } = parsed.data;

    // Generate a slug from the journal name
    const slug = journalName
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 50);

    // Find or create the journal
    let journal = await prisma.journal.findFirst({
      where: {
        OR: [
          { slug },
          { name: { equals: journalName, mode: "insensitive" } },
        ],
      },
    });

    if (!journal) {
      // Create a lightweight journal entry (no publisher, no members)
      journal = await prisma.journal.create({
        data: {
          name: journalName,
          slug: `${slug}-${Date.now().toString(36)}`, // ensure unique
          description: `Added as a favourite by ${session.user.name || "a user"}`,
        },
      });
    }

    // Add to favourites (upsert to avoid duplicates)
    const favourite = await prisma.favouriteJournal.upsert({
      where: {
        userId_journalId: {
          userId: session.user.id,
          journalId: journal.id,
        },
      },
      update: { notes },
      create: {
        userId: session.user.id,
        journalId: journal.id,
        notes,
      },
      include: {
        journal: {
          select: { id: true, name: true, slug: true },
        },
      },
    });

    return NextResponse.json({ favourite }, { status: 201 });
  } catch (error) {
    console.error("Error adding favourite:", error);
    return NextResponse.json({ error: "Failed to add favourite" }, { status: 500 });
  }
}

/**
 * DELETE /api/user/favourites — remove a journal from favourites
 */
export async function DELETE(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const journalId = searchParams.get("journalId");

    if (!journalId) {
      return NextResponse.json({ error: "journalId is required" }, { status: 400 });
    }

    await prisma.favouriteJournal.deleteMany({
      where: {
        userId: session.user.id,
        journalId,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error removing favourite:", error);
    return NextResponse.json({ error: "Failed to remove favourite" }, { status: 500 });
  }
}
