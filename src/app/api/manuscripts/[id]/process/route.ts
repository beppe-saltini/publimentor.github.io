import { NextResponse, after } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { downloadFile } from "@/lib/supabase";
import { embedManuscript } from "@/lib/manuscript/embed-manuscript";
import { IN_FLIGHT_STATUSES, isProcessingStale } from "@/lib/manuscript/processing-timeout";
import { calculateHash } from "@/lib/storage";
import {
  sanitizeOptionalTextForPostgres,
  sanitizeTextArrayForPostgres,
  sanitizeTextForPostgres,
} from "@/lib/manuscript/sanitize-text";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Ceiling on the Hobby plan with Fluid compute; the pipeline runs in after() so the
// client gets its response immediately and polls /status.
export const maxDuration = 300;

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
 * Returns 202 immediately with { status: "EXTRACTING" }; the pipeline continues in
 * after() and the client polls GET /api/manuscripts/[id]/status.
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

    if (IN_FLIGHT_STATUSES.includes(manuscript.status)) {
      if (!isProcessingStale(manuscript.status, manuscript.processingStarted)) {
        return NextResponse.json({
          success: true,
          manuscriptId,
          status: manuscript.status,
          message: "Already processing",
        });
      }
      console.log(`[Process] Stale processing detected for ${manuscriptId}, re-processing`);
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

    // The pipeline runs after the response is sent (the platform keeps the function
    // alive up to maxDuration) and the client polls /status. It records its own
    // failures on the manuscript row; /status flags runs that the platform killed.
    const storagePath = manuscript.storagePath;
    after(() =>
      processManuscriptFromStorage(manuscriptId, storagePath, manuscript.fileName, manuscript.fileMimeType).catch((error) =>
        console.error(`[Process] Pipeline failed for ${manuscriptId}:`, error)
      )
    );

    return NextResponse.json(
      { success: true, manuscriptId, status: "EXTRACTING", message: "Processing started" },
      { status: 202 }
    );
  } catch (error) {
    console.error("[Process] Error:", error);
    return NextResponse.json(
      { error: "Failed to start processing" },
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
        extractedText: sanitizeTextForPostgres(extractionResult.text),
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
        title: sanitizeOptionalTextForPostgres(metadata.title),
        abstract: sanitizeOptionalTextForPostgres(metadata.abstract),
        keywords: sanitizeTextArrayForPostgres(metadata.keywords),
        manuscriptType: sanitizeOptionalTextForPostgres(metadata.manuscriptType),
        language: sanitizeOptionalTextForPostgres(metadata.language),
        detectedJournal: sanitizeOptionalTextForPostgres(metadata.detectedJournal),
        fundingStatement: sanitizeOptionalTextForPostgres(metadata.declarations.funding),
        coiStatement: sanitizeOptionalTextForPostgres(metadata.declarations.conflictOfInterest),
        dataAvailability: sanitizeOptionalTextForPostgres(metadata.declarations.dataAvailability),
        ethicsStatement: sanitizeOptionalTextForPostgres(metadata.declarations.ethics),
        authorContribs: sanitizeOptionalTextForPostgres(metadata.declarations.authorContributions),
        figureCount: metadata.statistics.figureCount,
        tableCount: metadata.statistics.tableCount,
        referenceCount: metadata.statistics.referenceCount || metadata.references.length,
        extractionConfidence: metadata.extractionConfidence,
        extractionNotes: sanitizeTextArrayForPostgres(metadata.extractionNotes || []),
        correspondingAddress: sanitizeOptionalTextForPostgres(metadata.correspondingAuthor?.address),
        status: "EMBEDDING",
      },
    });

    // A retry after a killed run must not duplicate child rows
    await prisma.$transaction([
      prisma.manuscriptAuthor.deleteMany({ where: { manuscriptId } }),
      prisma.manuscriptAffiliation.deleteMany({ where: { manuscriptId } }),
      prisma.manuscriptReference.deleteMany({ where: { manuscriptId } }),
      prisma.documentChunk.deleteMany({ where: { manuscriptId } }),
    ]);

    // Store authors
    if (metadata.authors.length > 0) {
      await prisma.manuscriptAuthor.createMany({
        data: metadata.authors.map((author, index) => ({
          manuscriptId,
          publisherId: manuscript.publisherId,
          fullName: sanitizeTextForPostgres(author.fullName),
          firstName: sanitizeOptionalTextForPostgres(author.firstName),
          lastName: sanitizeOptionalTextForPostgres(author.lastName),
          email: sanitizeOptionalTextForPostgres(author.email),
          orcid: sanitizeOptionalTextForPostgres(author.orcid),
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
          rawText: sanitizeTextForPostgres(aff.rawText),
          institutionName: sanitizeOptionalTextForPostgres(aff.institutionName),
          department: sanitizeOptionalTextForPostgres(aff.department),
          city: sanitizeOptionalTextForPostgres(aff.city),
          state: sanitizeOptionalTextForPostgres(aff.state),
          country: sanitizeOptionalTextForPostgres(aff.country),
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
          rawText: sanitizeTextForPostgres(ref.rawText),
          authors: sanitizeOptionalTextForPostgres(ref.authors),
          title: sanitizeOptionalTextForPostgres(ref.title),
          journal: sanitizeOptionalTextForPostgres(ref.journal),
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
          content: sanitizeTextForPostgres(chunk.content),
          chunkIndex: chunk.chunkIndex,
          charStart: chunk.charStart,
          charEnd: chunk.charEnd,
          section: sanitizeOptionalTextForPostgres(chunk.section),
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

    // Optional: pgvector embeddings (only when HF_API_TOKEN is set); failures stay on the job row
    await embedManuscript(manuscriptId, manuscript.publisherId);
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

    const refs = await extractReferencesFromText(manuscript.extractedText);

    // Only replace the stored references once the new extraction has succeeded
    await prisma.manuscriptReference.deleteMany({ where: { manuscriptId } });

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
          rawText: sanitizeTextForPostgres(ref.rawText),
          authors: sanitizeOptionalTextForPostgres(ref.authors),
          title: sanitizeOptionalTextForPostgres(ref.title),
          journal: sanitizeOptionalTextForPostgres(ref.journal),
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
