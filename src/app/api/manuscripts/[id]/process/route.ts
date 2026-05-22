import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { downloadFile } from "@/lib/supabase";
import { calculateHash } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Sanitize error messages before storing in the database.
 */
function sanitizeErrorForStorage(error: unknown): string {
  const msg = error instanceof Error ? error.message : "Processing failed";
  return msg
    .replace(/\/[^\s:]+/g, "[path]")
    .replace(/https?:\/\/[^\s]+/g, "[url]")
    .substring(0, 500);
}

/**
 * POST /api/manuscripts/[id]/process
 *
 * Step 2 of the two-step upload flow:
 *   1. Downloads the file from Supabase Storage
 *   2. Runs text extraction, metadata extraction, chunking
 *   3. Updates the manuscript record progressively
 *
 * Returns immediately with { status: "PROCESSING" }.
 * The actual processing runs asynchronously (fire-and-forget).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: manuscriptId } = await params;
  console.log("[Process] POST handler reached", manuscriptId, new Date().toISOString());

  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fetch manuscript
    const manuscript = await prisma.manuscript.findUnique({
      where: { id: manuscriptId },
    });

    if (!manuscript) {
      return NextResponse.json({ error: "Manuscript not found" }, { status: 404 });
    }

    // Verify ownership / access
    if (manuscript.uploaderId !== session.user.id) {
      const isMember = await prisma.publisherMember.findUnique({
        where: {
          userId_publisherId: {
            userId: session.user.id,
            publisherId: manuscript.publisherId,
          },
        },
      });
      if (!isMember) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }
    }

    const { searchParams } = new URL(request.url);
    const force = searchParams.get("force") === "true";

    if (force && manuscript.extractedText) {
      return await reextractMetadata(manuscriptId, manuscript);
    }

    if (manuscript.status === "READY" && !force) {
      return NextResponse.json({
        success: true,
        manuscriptId,
        status: "READY",
        message: "Already processed",
      });
    }

    if (["EXTRACTING", "PROCESSING", "EMBEDDING"].includes(manuscript.status)) {
      const staleMinutes = manuscript.processingStarted
        ? (Date.now() - new Date(manuscript.processingStarted).getTime()) / 60000
        : 999;
      if (staleMinutes < 5) {
        return NextResponse.json({
          success: true,
          manuscriptId,
          status: manuscript.status,
          message: "Already processing",
        });
      }
      console.log(`[Process] Stale processing detected (${staleMinutes.toFixed(0)} min), re-processing`);
    }

    if (!manuscript.storagePath) {
      return NextResponse.json(
        { error: "No storage path found — was the file uploaded?" },
        { status: 400 }
      );
    }

    await prisma.manuscript.update({
      where: { id: manuscriptId },
      data: {
        status: "EXTRACTING",
        processingStarted: new Date(),
        statusMessage: null,
      },
    });

    await prisma.processingJob.create({
      data: {
        manuscriptId,
        jobType: "EXTRACT_TEXT",
        status: "PENDING",
      },
    });

    try {
      await processManuscriptFromStorage(
        manuscriptId,
        manuscript.storagePath,
        manuscript.fileName,
        manuscript.fileMimeType
      );

      return NextResponse.json({
        success: true,
        manuscriptId,
        status: "READY",
        message: "Processing complete",
      });
    } catch (processingError) {
      console.error(`[Process] Pipeline failed for ${manuscriptId}:`, processingError);
      try {
        await prisma.manuscript.update({
          where: { id: manuscriptId },
          data: {
            status: "ERROR",
            statusMessage: sanitizeErrorForStorage(processingError),
            processingEnded: new Date(),
          },
        });
        await prisma.processingJob.updateMany({
          where: { manuscriptId, status: { in: ["PENDING", "RUNNING"] } },
          data: { status: "FAILED", error: sanitizeErrorForStorage(processingError), completedAt: new Date() },
        });
      } catch (updateErr) {
        console.error("[Process] Failed to update error status:", updateErr);
      }

      return NextResponse.json({
        success: false,
        manuscriptId,
        status: "ERROR",
        message: sanitizeErrorForStorage(processingError),
      }, { status: 500 });
    }
  } catch (error) {
    console.error("[Process] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start processing" },
      { status: 500 }
    );
  }
}

/**
 * Download file from Supabase Storage and run the full processing pipeline.
 */
async function processManuscriptFromStorage(
  manuscriptId: string,
  storagePath: string,
  fileName: string,
  mimeType: string
): Promise<void> {
  try {
    // Dynamic imports to avoid loading heavy deps at module level
    const { extractText, detectSections } = await import("@/lib/manuscript/text-extractor");
    const { extractMetadata } = await import("@/lib/manuscript/metadata-extractor");
    const { chunkText } = await import("@/lib/manuscript/embeddings");

    const manuscript = await prisma.manuscript.findUnique({
      where: { id: manuscriptId },
    });
    if (!manuscript) throw new Error("Manuscript not found");

    // STEP 1: Download from Supabase
    console.log(`[Process] Downloading from Supabase: ${storagePath}`);
    const buffer = await downloadFile(storagePath);
    console.log(`[Process] Downloaded ${buffer.length} bytes`);

    const fileHash = calculateHash(buffer);
    const sizeUpdate: { fileSize?: number; fileHash?: string } = { fileHash };
    if (manuscript.fileSize === 0) {
      sizeUpdate.fileSize = buffer.length;
    }
    if (!manuscript.fileHash || manuscript.fileSize === 0) {
      await prisma.manuscript.update({
        where: { id: manuscriptId },
        data: sizeUpdate,
      });
    }

    // STEP 2: Extract text
    console.log(`[Process] Extracting text from ${fileName}...`);
    const extractionResult = await extractText(buffer, mimeType, fileName);

    await prisma.manuscript.update({
      where: { id: manuscriptId },
      data: {
        extractedText: extractionResult.text,
        textExtractionMethod: extractionResult.method,
        wordCount: extractionResult.wordCount,
        pageCount: extractionResult.pageCount,
        status: "EXTRACTED",
      },
    });

    await prisma.processingJob.updateMany({
      where: { manuscriptId, jobType: "EXTRACT_TEXT" },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

    // STEP 3: Extract metadata with LLM
    console.log(`[Process] Extracting metadata with LLM...`);
    await prisma.manuscript.update({
      where: { id: manuscriptId },
      data: { status: "PROCESSING" },
    });

    await prisma.processingJob.create({
      data: {
        manuscriptId,
        jobType: "EXTRACT_METADATA",
        status: "RUNNING",
        startedAt: new Date(),
      },
    });

    const metadata = await extractMetadata(extractionResult.text);

    // Update manuscript with metadata
    await prisma.manuscript.update({
      where: { id: manuscriptId },
      data: {
        title: metadata.title,
        abstract: metadata.abstract,
        keywords: metadata.keywords,
        manuscriptType: metadata.manuscriptType,
        language: metadata.language,
        detectedJournal: metadata.detectedJournal,
        fundingStatement: metadata.declarations.funding,
        coiStatement: metadata.declarations.conflictOfInterest,
        dataAvailability: metadata.declarations.dataAvailability,
        ethicsStatement: metadata.declarations.ethics,
        authorContribs: metadata.declarations.authorContributions,
        figureCount: metadata.statistics.figureCount,
        tableCount: metadata.statistics.tableCount,
        referenceCount: metadata.statistics.referenceCount || metadata.references.length,
        extractionConfidence: metadata.extractionConfidence,
        extractionNotes: metadata.extractionNotes || [],
        correspondingAddress: metadata.correspondingAuthor?.address,
        status: "EMBEDDING",
      },
    });

    // Store authors
    if (metadata.authors.length > 0) {
      await prisma.manuscriptAuthor.createMany({
        data: metadata.authors.map((author, index) => ({
          manuscriptId,
          publisherId: manuscript.publisherId,
          fullName: author.fullName,
          firstName: author.firstName,
          lastName: author.lastName,
          email: author.email,
          orcid: author.orcid,
          authorOrder: index + 1,
          isCorresponding: author.isCorresponding,
          equalContrib: author.equalContribution || false,
          affiliationNums: author.affiliationNumbers,
        })),
      });
    }

    // Store affiliations
    if (metadata.affiliations.length > 0) {
      await prisma.manuscriptAffiliation.createMany({
        data: metadata.affiliations.map((aff) => ({
          manuscriptId,
          publisherId: manuscript.publisherId,
          affiliationNumber: aff.number,
          rawText: aff.rawText,
          institutionName: aff.institutionName,
          department: aff.department,
          city: aff.city,
          state: aff.state,
          country: aff.country,
        })),
      });
    }

    // Store references
    if (metadata.references.length > 0) {
      await prisma.manuscriptReference.createMany({
        data: metadata.references.map((ref) => ({
          manuscriptId,
          publisherId: manuscript.publisherId,
          refNumber: ref.number,
          rawText: ref.rawText,
          authors: ref.authors,
          title: ref.title,
          journal: ref.journal,
          year: ref.year,
          volume: ref.volume,
          issue: ref.issue,
          pages: ref.pages,
          doi: ref.doi,
          pmid: ref.pmid,
          pmcid: ref.pmcid,
          arxivId: ref.arxivId,
          url: ref.url,
          refType: ref.refType,
        })),
      });
    }

    await prisma.processingJob.updateMany({
      where: { manuscriptId, jobType: "EXTRACT_METADATA" },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

    // STEP 4: Create document chunks
    console.log(`[Process] Chunking text for ${manuscriptId}...`);
    const sections = detectSections(extractionResult.text);
    const allChunks = chunkText(extractionResult.text, sections);

    const MAX_CHUNKS = 500;
    const chunks = allChunks.slice(0, MAX_CHUNKS);

    if (chunks.length > 0) {
      await prisma.documentChunk.createMany({
        data: chunks.map((chunk) => ({
          manuscriptId,
          publisherId: manuscript.publisherId,
          content: chunk.content,
          chunkIndex: chunk.chunkIndex,
          charStart: chunk.charStart,
          charEnd: chunk.charEnd,
          section: chunk.section,
          tokenCount: chunk.tokenCount,
        })),
      });

      await prisma.manuscript.update({
        where: { id: manuscriptId },
        data: { chunkCount: chunks.length },
      });
    }

    // STEP 5: Mark READY
    await prisma.manuscript.update({
      where: { id: manuscriptId },
      data: {
        status: "READY",
        processingEnded: new Date(),
      },
    });

    console.log(`[Process] Complete for ${manuscriptId}: ${metadata.authors.length} authors, ${metadata.keywords.length} keywords`);
  } catch (error) {
    console.error(`[Process] Pipeline error for ${manuscriptId}:`, error);

    await prisma.manuscript.update({
      where: { id: manuscriptId },
      data: {
        status: "ERROR",
        statusMessage: sanitizeErrorForStorage(error),
        processingEnded: new Date(),
      },
    });

    await prisma.processingJob.updateMany({
      where: { manuscriptId, status: { in: ["PENDING", "RUNNING"] } },
      data: {
        status: "FAILED",
        error: sanitizeErrorForStorage(error),
        completedAt: new Date(),
      },
    });
  }
}

/**
 * Fast path for force-reprocessing: skip file download and text extraction,
 * only re-run LLM metadata extraction using already-stored text.
 */
async function reextractMetadata(
  manuscriptId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  manuscript: any
): Promise<Response> {
  try {
    const { extractReferencesFromText } = await import("@/lib/manuscript/metadata-extractor");

    console.log(`[Process] Fast reprocess: re-extracting references for ${manuscriptId}`);

    await prisma.manuscriptReference.deleteMany({ where: { manuscriptId } });

    const refs = await extractReferencesFromText(manuscript.extractedText);

    await prisma.manuscript.update({
      where: { id: manuscriptId },
      data: {
        referenceCount: refs.length,
        status: "READY",
        processingEnded: new Date(),
      },
    });

    if (refs.length > 0) {
      await prisma.manuscriptReference.createMany({
        data: refs.map((ref) => ({
          manuscriptId,
          publisherId: manuscript.publisherId,
          refNumber: ref.number,
          rawText: ref.rawText,
          authors: ref.authors,
          title: ref.title,
          journal: ref.journal,
          year: ref.year,
          volume: ref.volume,
          issue: ref.issue,
          pages: ref.pages,
          doi: ref.doi,
          pmid: ref.pmid,
          pmcid: ref.pmcid,
          arxivId: ref.arxivId,
          url: ref.url,
          refType: ref.refType,
        })),
      });
    }

    console.log(`[Process] Fast reprocess complete: ${refs.length} references`);

    return NextResponse.json({
      success: true,
      manuscriptId,
      status: "READY",
      message: `Reprocessed: ${refs.length} references extracted`,
    });
  } catch (error) {
    console.error(`[Process] Fast reprocess failed for ${manuscriptId}:`, error);
    await prisma.manuscript.update({
      where: { id: manuscriptId },
      data: { status: "READY", processingEnded: new Date() },
    }).catch(() => {});

    return NextResponse.json({
      success: false,
      manuscriptId,
      status: "ERROR",
      message: sanitizeErrorForStorage(error),
    }, { status: 500 });
  }
}
