import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { uploadFile } from "@/lib/storage";
import { z } from "zod";

const createSubmissionSchema = z.object({
  title: z.string().min(5, "Title must be at least 5 characters"),
  abstract: z.string().optional(),
  authors: z.array(
    z.object({
      name: z.string().min(1),
      email: z.string().email().optional(),
      orcid: z.string().optional(),
      affiliation: z.string().optional(),
    })
  ).min(1, "At least one author is required"),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await auth();
    const { slug } = await params;
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

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

    const submissions = await prisma.submission.findMany({
      where: {
        journalId: journal.id,
        ...(status ? { status: status as never } : {}),
      },
      include: {
        authors: {
          orderBy: { order: "asc" },
        },
        reviewAssignments: {
          include: {
            reviewer: {
              select: { id: true, name: true, email: true },
            },
          },
        },
        _count: {
          select: { reviewAssignments: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ submissions });
  } catch (error) {
    console.error("Error fetching submissions:", error);
    return NextResponse.json({ error: "Failed to fetch submissions" }, { status: 500 });
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

    const formData = await request.formData();
    const title = formData.get("title") as string;
    const abstract = formData.get("abstract") as string;
    const authorsJson = formData.get("authors") as string;
    const pdfFile = formData.get("pdf") as File | null;

    let authors;
    try {
      authors = JSON.parse(authorsJson);
    } catch {
      return NextResponse.json({ error: "Invalid authors data" }, { status: 400 });
    }

    const validationResult = createSubmissionSchema.safeParse({ title, abstract, authors });
    if (!validationResult.success) {
      return NextResponse.json(
        { error: validationResult.error.issues[0].message },
        { status: 400 }
      );
    }

    let pdfUrl: string | undefined;
    if (pdfFile && pdfFile.size > 0) {
      if (pdfFile.type !== "application/pdf") {
        return NextResponse.json({ error: "Only PDF files are allowed" }, { status: 400 });
      }
      if (pdfFile.size > 50 * 1024 * 1024) {
        return NextResponse.json({ error: "File size must be less than 50MB" }, { status: 400 });
      }
      pdfUrl = await uploadFile(pdfFile, "submissions");
    }

    const submission = await prisma.submission.create({
      data: {
        title,
        abstract,
        pdfUrl,
        journalId: journal.id,
        status: "SUBMITTED",
        authors: {
          create: authors.map((author: { name: string; email?: string; orcid?: string; affiliation?: string }, index: number) => ({
            name: author.name,
            email: author.email,
            orcid: author.orcid,
            affiliation: author.affiliation,
            order: index,
          })),
        },
      },
      include: {
        authors: true,
      },
    });

    return NextResponse.json({ submission }, { status: 201 });
  } catch (error) {
    console.error("Error creating submission:", error);
    return NextResponse.json({ error: "Failed to create submission" }, { status: 500 });
  }
}
