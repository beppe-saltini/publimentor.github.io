import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkFormat, defaultGuidelines, type FormatGuidelines } from "@/lib/format-checker";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("pdf") as File | null;
    const journalSlug = formData.get("journalSlug") as string | null;
    const submissionId = formData.get("submissionId") as string | null;

    if (!file) {
      return NextResponse.json({ error: "PDF file is required" }, { status: 400 });
    }

    if (file.type !== "application/pdf") {
      return NextResponse.json({ error: "Only PDF files are allowed" }, { status: 400 });
    }

    // Get journal-specific guidelines if available
    let guidelines: FormatGuidelines = defaultGuidelines;

    if (journalSlug) {
      const journalGuidelines = await prisma.formatGuideline.findFirst({
        where: {
          journal: { slug: journalSlug },
        },
      });

      if (journalGuidelines) {
        guidelines = journalGuidelines.rules as FormatGuidelines;
      }
    }

    // Parse PDF - dynamic import to avoid SSR issues
    const { parsePDFBuffer } = await import("@/lib/pdf-parser");
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const content = await parsePDFBuffer(buffer);

    // Check format
    const result = checkFormat(content, guidelines);

    // Save report if submissionId provided
    if (submissionId) {
      await prisma.formatReport.upsert({
        where: { submissionId },
        create: {
          submissionId,
          passed: result.passed,
          issues: JSON.parse(JSON.stringify(result.issues)),
        },
        update: {
          passed: result.passed,
          issues: JSON.parse(JSON.stringify(result.issues)),
          checkedAt: new Date(),
        },
      });
    }

    return NextResponse.json({
      result,
      pdfInfo: {
        title: content.info.title,
        author: content.info.author,
        pages: content.numPages,
        wordCount: content.wordCount,
      },
    });
  } catch (error) {
    console.error("Error checking format:", error);
    return NextResponse.json(
      { error: "Failed to check format. Make sure the PDF is valid." },
      { status: 500 }
    );
  }
}
