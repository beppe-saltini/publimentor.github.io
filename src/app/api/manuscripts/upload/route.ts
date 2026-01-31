import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStorage, calculateHash } from "@/lib/storage";
import { extractText } from "@/lib/manuscript/text-extractor";
import { extractMetadata } from "@/lib/manuscript/metadata-extractor";
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

// Max file size: 50MB
const MAX_FILE_SIZE = 50 * 1024 * 1024;

// Allowed MIME types with their extensions
const ALLOWED_FILE_TYPES: Record<string, string[]> = {
  "application/pdf": ["pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
};

// File extensions
const ALLOWED_EXTENSIONS = ["pdf", "docx"];

export async function POST(request: Request) {
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

    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const publisherId = formData.get("publisherId") as string | null;
    const journalId = formData.get("journalId") as string | null;

    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    if (!publisherId) {
      return NextResponse.json(
        { error: "Publisher ID is required" },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB` },
        { status: 400 }
      );
    }

    // Validate file extension
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!extension || !ALLOWED_EXTENSIONS.includes(extension)) {
      return NextResponse.json(
        { error: `Invalid file type. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}` },
        { status: 400 }
      );
    }

    // Sanitize filename
    const sanitizedFileName = sanitizeFileName(file.name);

    // Read file buffer for content validation
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // SECURITY: Validate file content matches claimed MIME type
    const expectedMimeType = Object.entries(ALLOWED_FILE_TYPES)
      .find(([_, exts]) => exts.includes(extension))?.[0];
    
    if (expectedMimeType && !validateFileType(buffer, expectedMimeType)) {
      auditLog({
        userId: session.user.id,
        action: "MALICIOUS_FILE_UPLOAD_ATTEMPT",
        resource: "manuscripts",
        resourceId: file.name,
        ip: clientIp,
        userAgent: getUserAgent(request),
        severity: "critical",
        details: { 
          claimedExtension: extension,
          claimedMimeType: file.type,
        },
      });
      
      return NextResponse.json(
        { error: "File content does not match file type" },
        { status: 400 }
      );
    }

    // Verify user has access to the publisher
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

    // If journalId provided, verify it belongs to the publisher
    if (journalId) {
      const journal = await prisma.journal.findFirst({
        where: {
          id: journalId,
          publisherId,
        },
      });

      if (!journal) {
        return NextResponse.json(
          { error: "Journal not found or doesn't belong to this publisher" },
          { status: 404 }
        );
      }
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
        journalId,
        uploaderId: session.user.id,
        fileName: sanitizedFileName,
        fileType: extension,
        fileMimeType: expectedMimeType || `application/${extension}`,
        fileSize: file.size,
        filePath: "", // Will be updated after storage
        fileHash,
        status: "UPLOADED",
      },
    });

    // Upload file to storage
    const storage = getStorage();
    const storageResult = await storage.upload(buffer, {
      publisherId,
      journalId: journalId || undefined,
      manuscriptId: manuscript.id,
      fileName: sanitizedFileName,
      mimeType: expectedMimeType || file.type,
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
        fileSize: file.size,
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

    // Start async processing (fire and forget)
    processManuscriptAsync(manuscript.id, buffer, sanitizedFileName, expectedMimeType || file.type).catch(
      (error) => {
        console.error(`[Upload] Async processing failed:`, error);
      }
    );

    return NextResponse.json({
      success: true,
      manuscriptId: manuscript.id,
      jobId: job.id,
      fileName: sanitizedFileName,
      fileSize: file.size,
      status: "EXTRACTING",
      message: "File uploaded successfully. Processing started.",
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
 */
async function processManuscriptAsync(
  manuscriptId: string,
  buffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<void> {
  try {
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
        fundingStatement: metadata.declarations.funding,
        coiStatement: metadata.declarations.conflictOfInterest,
        dataAvailability: metadata.declarations.dataAvailability,
        ethicsStatement: metadata.declarations.ethics,
        authorContribs: metadata.declarations.authorContributions,
        figureCount: metadata.statistics.figureCount,
        tableCount: metadata.statistics.tableCount,
        referenceCount: metadata.statistics.referenceCount || metadata.references.length,
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

    // STEP 3: Generate embeddings (TODO: implement later)
    // For now, mark as ready
    await prisma.manuscript.update({
      where: { id: manuscriptId },
      data: {
        status: "READY",
        processingEnded: new Date(),
      },
    });

    console.log(`[Upload] Processing complete for ${manuscriptId}`);
  } catch (error) {
    console.error(`[Upload] Processing error for ${manuscriptId}:`, error);

    // Mark as error
    await prisma.manuscript.update({
      where: { id: manuscriptId },
      data: {
        status: "ERROR",
        statusMessage: error instanceof Error ? error.message : "Processing failed",
        processingEnded: new Date(),
      },
    });

    // Update any running jobs
    await prisma.processingJob.updateMany({
      where: { manuscriptId, status: "RUNNING" },
      data: {
        status: "FAILED",
        error: error instanceof Error ? error.message : "Unknown error",
        completedAt: new Date(),
      },
    });
  }
}
