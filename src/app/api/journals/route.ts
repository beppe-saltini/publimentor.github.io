import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const createJournalSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
  description: z.string().optional(),
});

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const journals = await prisma.journal.findMany({
      where: {
        members: {
          some: { userId: session.user.id },
        },
      },
      include: {
        members: {
          where: { userId: session.user.id },
          select: { role: true },
        },
        _count: {
          select: { submissions: true, members: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ journals });
  } catch (error) {
    console.error("Error fetching journals:", error);
    return NextResponse.json({ error: "Failed to fetch journals" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const result = createJournalSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error.issues[0].message },
        { status: 400 }
      );
    }

    const { name, slug, description } = result.data;

    // Check if slug is already taken
    const existingJournal = await prisma.journal.findUnique({
      where: { slug },
    });

    if (existingJournal) {
      return NextResponse.json(
        { error: "A journal with this URL already exists" },
        { status: 400 }
      );
    }

    // Create journal and add creator as admin
    const journal = await prisma.journal.create({
      data: {
        name,
        slug,
        description,
        members: {
          create: {
            userId: session.user.id,
            role: "ADMIN",
          },
        },
      },
      include: {
        members: {
          include: { user: true },
        },
      },
    });

    return NextResponse.json({ journal }, { status: 201 });
  } catch (error) {
    console.error("Error creating journal:", error);
    return NextResponse.json({ error: "Failed to create journal" }, { status: 500 });
  }
}
