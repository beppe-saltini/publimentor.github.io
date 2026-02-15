import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStorage, calculateHash } from "@/lib/storage";
// Heavy processing deps (unpdf, mammoth, anthropic, huggingface) are
// dynamically imported inside processManuscriptAsync() to keep the route
// module lightweight and avoid bundling issues on Vercel.
import { 
  validateFileType, 
  sanitizeFileName, 
  checkRateLimit, 
  getRateLimitResponse,
  STRICT_RATE_LIMIT,
  auditLog,
  getClientIp,
  getUserAgent,
} from "@/lib/security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Give the function enough time for text + LLM extraction on Vercel
export const maxDuration = 60;

// Vercel Serverless Functions have a 4.5 MB request body limit.
// Use a slightly lower threshold to account for multipart overhead.
const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4 MB

/**
 * Sanitize error messages before storing in the database.
 * Strips file paths, URLs with tokens, and limits length.
 */
function sanitizeErrorForStorage(error: unknown): string {
  const msg = error instanceof Error ? error.message : "Processing failed";
  return msg
    .replace(/\/[^\s:]+/g, "[path]")         // Strip file paths
    .replace(/https?:\/\/[^\s]+/g, "[url]")  // Strip URLs (may contain tokens)
    .substring(0, 500);                       // Limit length
}

// Allowed MIME types with their extensions
const ALLOWED_FILE_TYPES: Record<string, string[]> = {
  "application/pdf": ["pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
};

// File extensions
const ALLOWED_EXTENSIONS = ["pdf", "docx"];

export async function POST(request: Request) {
  console.log("[Upload] POST handler reached", new Date().toISOString());
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const clientIp = getClientIp(request);
    
    // Rate limiting - 10 uploads per minute per user
    const rateLimit = checkRateLimit(
      `upload:${session.user.id}`, 
      { windowMs: 60000, maxRequests: 10 }
    );
    if (!rateLimit.allowed) {
      return getRateLimitResponse(rateLimit.resetIn);
    }

    // ── Parse request ──
    // The client sends ALL metadata as query params and the file as the
    // raw request body (ArrayBuffer).  No custom headers are used — this
    // avoids Safari/WebKit header-validation errors and Vercel multipart
    // parsing failures.
    const url = new URL(request.url);
    const publisherId = url.searchParams.get("publisherId");
    const rawFileName = url.searchParams.get("fileName");

    console.log("[Upload] request received", { publisherId: !!publisherId, fileName: rawFileName });

    if (!publisherId) {
      return NextResponse.json(
        { error: "Publisher ID is required" },
        { status: 400 }
      );
    }

    if (!rawFileName) {
      return NextResponse.json(
        { error: "No file name provided (fileName query param)" },
        { status: 400 }
      );
    }

    const fileName = rawFileName;

    // Validate file extension
    const extension = fileName.split(".").pop()?.toLowerCase();
    if (!extension || !ALLOWED_EXTENSIONS.includes(extension)) {
      return NextResponse.json(
        { error: `Invalid file type. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}` },
        { status: 400 }
      );
    }

    // Read raw body
    const arrayBuffer = await request.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Validate file size
    if (buffer.length > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)} MB` },
        { status: 400 }
      );
    }

    if (buffer.length === 0) {
      return NextResponse.json(
        { error: "No file provided (empty body)" },
        { status: 400 }
      );
    }

    // Sanitize filename
    const sanitizedFileName = sanitizeFileName(fileName);

    // SECURITY: Validate file content matches claimed MIME type
    const expectedMimeType = Object.entries(ALLOWED_FILE_TYPES)
      .find(([_, exts]) => exts.includes(extension))?.[0];
    
    if (expectedMimeType && !validateFileType(buffer, expectedMimeType)) {
      auditLog({
        userId: session.user.id,
        action: "MALICIOUS_FILE_UPLOAD_ATTEMPT",
        resource: "manuscripts",
        resourceId: sanitizedFileName,
        ip: clientIp,
        userAgent: getUserAgent(request),
        severity: "critical",
        details: { 
          claimedExtension: extension,
          claimedMimeType: request.headers.get("content-type") || "unknown",
        },
      });
      
      return NextResponse.json(
        { error: "File content does not match file type" },
        { status: 400 }
      );
    }

    // Verify user has access to the publisher (direct membership)
    const publisherMember = await prisma.publisherMember.findUnique({
      where: {
        userId_publisherId: {
          userId: session.user.id,
          publisherId,
        },
      },
    });

    if (!publisherMember) {
      return NextResponse.json(
        { error: "You don't have access to this publisher" },
        { status: 403 }
      );
    }

    // Calculate file hash for duplicate detection (buffer already read above)
    const fileHash = calculateHash(buffer);

    // Check for duplicate
    const existingManuscript = await prisma.manuscript.findFirst({
      where: {
        fileHash,
        publisherId,
      },
    });

    if (existingManuscript) {
      return NextResponse.json(
        {
          error: "Duplicate file detected",
          existingManuscriptId: existingManuscript.id,
        },
        { status: 409 }
      );
    }

    // Create manuscript record
    const manuscript = await prisma.manuscript.create({
      data: {
        publisherId,
        uploaderId: session.user.id,
        fileName: sanitizedFileName,
        fileType: extension,
        fileMimeType: expectedMimeType || `application/${extension}`,
        fileSize: buffer.length,
        filePath: "", // Will be updated after storage
        fileHash,
        status: "UPLOADED",
      },
    });

    // Upload file to storage
    const storage = getStorage();
    const storageResult = await storage.upload(buffer, {
      publisherId,
      manuscriptId: manuscript.id,
      fileName: sanitizedFileName,
      mimeType: expectedMimeType || `application/${extension}`,
    });

    // Log successful upload
    auditLog({
      userId: session.user.id,
      action: "MANUSCRIPT_UPLOADED",
      resource: "manuscripts",
      resourceId: manuscript.id,
      ip: clientIp,
      userAgent: getUserAgent(request),
      severity: "info",
      details: {
        fileName: sanitizedFileName,
        fileSize: buffer.length,
        publisherId,
      },
    });

    // Update manuscript with storage path
    await prisma.manuscript.update({
      where: { id: manuscript.id },
      data: {
        filePath: storageResult.path,
        status: "EXTRACTING",
        processingStarted: new Date(),
      },
    });

    // Create processing job for async processing
    const job = await prisma.processingJob.create({
      data: {
        manuscriptId: manuscript.id,
        jobType: "EXTRACT_TEXT",
        status: "PENDING",
      },
    });

    // Fire-and-forget: kick off processing WITHOUT awaiting.
    // The maxDuration = 60 keeps the serverless function alive long enough
    // for processing to complete, even though the HTTP response is sent first.
    // We intentionally do NOT await this — the response is sent immediately.
    processManuscriptAsync(manuscript.id, buffer, sanitizedFileName, expectedMimeType || `application/${extension}`)
      .catch(async (error) => {
        console.error(`[Upload] Async processing failed for ${manuscript.id}:`, error);
        try {
          await prisma.manuscript.update({
            where: { id: manuscript.id },
            data: {
              status: "ERROR",
              statusMessage: sanitizeErrorForStorage(error),
              processingEnded: new Date(),
            },
          });
        } catch (updateErr) {
          console.error("[Upload] Failed to update error status:", updateErr);
        }
      });

    return NextResponse.json({
      success: true,
      manuscriptId: manuscript.id,
      jobId: job.id,
      fileName: sanitizedFileName,
      fileSize: buffer.length,
      status: "EXTRACTING",
      message: "File uploaded successfully. Processing started.",
      _v: Date.now(), // deployment verification timestamp
    });
  } catch (error) {
    console.error("[Upload] Error:", error);
    return NextResponse.json(
      { error: "Failed to upload manuscript" },
      { status: 500 }
    );
  }
}

/**
 * Async processing pipeline
 *
 * Heavy dependencies (unpdf, mammoth, anthropic, huggingface) are
 * dynamically imported here so the route module stays lightweight.
 */
async function processManuscriptAsync(
  manuscriptId: string,
  buffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<void> {
  try {
    // Dynamic imports — keeps route module lightweight
    const { extractText, detectSections } = await import("@/lib/manuscript/text-extractor");
    const { extractMetadata } = await import("@/lib/manuscript/metadata-extractor");
    const { chunkText, generateEmbeddings, getEmbeddingModelInfo } = await import("@/lib/manuscript/embeddings");

    // Get manuscript for publisherId
    const manuscript = await prisma.manuscript.findUnique({
      where: { id: manuscriptId },
    });

    if (!manuscript) {
      throw new Error("Manuscript not found");
    }

    // STEP 1: Extract text
    console.log(`[Upload] Extracting text from ${fileName}...`);
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

    // Update job
    await prisma.processingJob.updateMany({
      where: { manuscriptId, jobType: "EXTRACT_TEXT" },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

    // STEP 2: Extract metadata with LLM
    console.log(`[Upload] Extracting metadata with LLM...`);
    await prisma.manuscript.update({
      where: { id: manuscriptId },
      data: { status: "PROCESSING" },
    });

    // Create metadata job
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

    // Update metadata job
    await prisma.processingJob.updateMany({
      where: { manuscriptId, jobType: "EXTRACT_METADATA" },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

    // STEP 3: Create document chunks for RAG
    console.log(`[Upload] Chunking text for ${manuscriptId}...`);
    const sections = detectSections(extractionResult.text);
    const allChunks = chunkText(extractionResult.text, sections);

    // SECURITY: Cap chunk count to prevent DoS from very large documents
    const MAX_CHUNKS = 500;
    const chunks = allChunks.slice(0, MAX_CHUNKS);
    if (allChunks.length > MAX_CHUNKS) {
      console.warn(`[Upload] Truncated chunks from ${allChunks.length} to ${MAX_CHUNKS} for ${manuscriptId}`);
    }

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

    console.log(`[Upload] Created ${chunks.length} chunks for ${manuscriptId}`);

    // STEP 4: Mark manuscript as READY (embeddings are non-blocking)
    await prisma.manuscript.update({
      where: { id: manuscriptId },
      data: {
        status: "READY",
        processingEnded: new Date(),
      },
    });

    console.log(`[Upload] Processing complete for ${manuscriptId}`);

    // STEP 5: Generate embeddings in background (non-blocking)
    // Manuscript is already READY; embeddings enhance RAG but are not required.
    generateEmbeddingsAsync(manuscriptId, manuscript.publisherId).catch((error) => {
      console.error(`[Upload] Embedding generation failed for ${manuscriptId}:`, error);
    });
  } catch (error) {
    console.error(`[Upload] Processing error for ${manuscriptId}:`, error);

    // Mark as error
    await prisma.manuscript.update({
      where: { id: manuscriptId },
      data: {
        status: "ERROR",
        statusMessage: sanitizeErrorForStorage(error),
        processingEnded: new Date(),
      },
    });

    // Update any running jobs
    await prisma.processingJob.updateMany({
      where: { manuscriptId, status: "RUNNING" },
      data: {
        status: "FAILED",
        error: sanitizeErrorForStorage(error),
        completedAt: new Date(),
      },
    });
  }
}

/**
 * Non-blocking embedding generation.
 * Runs after manuscript is already marked READY.
 */
async function generateEmbeddingsAsync(
  manuscriptId: string,
  publisherId: string
): Promise<void> {
  // Dynamic import (same reason as processManuscriptAsync)
  const { generateEmbeddings, getEmbeddingModelInfo } = await import("@/lib/manuscript/embeddings");

  // Create processing job for tracking
  const job = await prisma.processingJob.create({
    data: {
      manuscriptId,
      jobType: "GENERATE_EMBEDDINGS",
      status: "RUNNING",
      startedAt: new Date(),
    },
  });

  try {
    // Fetch the chunks we already stored (without embeddings)
    // SECURITY: Include publisherId for multi-tenant isolation
    const storedChunks = await prisma.documentChunk.findMany({
      where: { manuscriptId, publisherId },
      orderBy: { chunkIndex: "asc" },
    });

    if (storedChunks.length === 0) {
      console.log(`[Embeddings] No chunks found for ${manuscriptId}, skipping`);
      await prisma.processingJob.update({
        where: { id: job.id },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      return;
    }

    // Convert stored chunks to the format expected by generateEmbeddings
    const chunksForEmbedding = storedChunks.map((c) => ({
      content: c.content,
      chunkIndex: c.chunkIndex,
      charStart: c.charStart ?? 0,
      charEnd: c.charEnd ?? c.content.length,
      section: c.section ?? undefined,
      tokenCount: c.tokenCount ?? undefined,
    }));

    // Generate embeddings via HuggingFace API
    const embeddedChunks = await generateEmbeddings(chunksForEmbedding);
    const modelInfo = getEmbeddingModelInfo();

    // Persist embeddings using raw SQL (Prisma cannot write Unsupported types).
    // SECURITY: Do NOT refactor to $executeRawUnsafe — that would enable SQL injection.
    // The tagged template literal $executeRaw parameterizes all interpolated values.
    for (let i = 0; i < embeddedChunks.length; i++) {
      const ec = embeddedChunks[i];
      const chunk = storedChunks[i];

      if (ec.embedding && ec.embedding.length > 0) {
        // Validate all embedding values are finite numbers
        const isValid = ec.embedding.every(
          (v: number) => typeof v === "number" && isFinite(v)
        );
        if (!isValid) {
          console.warn(`[Embeddings] Skipping chunk ${chunk.id}: invalid embedding values`);
          continue;
        }
        // Validate dimension matches expected model output
        if (ec.embedding.length !== modelInfo.dimensions) {
          console.warn(`[Embeddings] Skipping chunk ${chunk.id}: expected ${modelInfo.dimensions} dims, got ${ec.embedding.length}`);
          continue;
        }

        const vectorStr = `[${ec.embedding.join(",")}]`;
        await prisma.$executeRaw`
          UPDATE "DocumentChunk"
          SET embedding = ${vectorStr}::vector
          WHERE id = ${chunk.id}
        `;
      }
    }

    // Update manuscript with embedding metadata
    await prisma.manuscript.update({
      where: { id: manuscriptId },
      data: {
        embeddingModel: modelInfo.model,
        embeddedAt: new Date(),
      },
    });

    // Mark job complete
    await prisma.processingJob.update({
      where: { id: job.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        progress: 100,
      },
    });

    console.log(`[Embeddings] Generated ${embeddedChunks.length} embeddings for ${manuscriptId}`);
  } catch (error) {
    console.error(`[Embeddings] Failed for ${manuscriptId}:`, error);

    await prisma.processingJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        error: sanitizeErrorForStorage(error),
        completedAt: new Date(),
      },
    });
  }
}
