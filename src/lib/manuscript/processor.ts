/**
 * Manuscript Processing Orchestrator
 * 
 * Coordinates the full processing pipeline:
 * 1. Upload file to storage
 * 2. Extract text from document
 * 3. Extract metadata using LLM
 * 4. Store in database
 * 5. Generate embeddings for RAG
 */

import { getStorage, calculateHash } from "../storage";
import { extractText, detectSections } from "./text-extractor";
import { extractMetadata, ExtractedMetadata } from "./metadata-extractor";
import { chunkText, generateEmbeddings, getEmbeddingModelInfo } from "./embeddings";
// import { prisma } from "../prisma"; // Uncomment when DB is ready

export interface ProcessingInput {
  fileBuffer: Buffer;
  fileName: string;
  mimeType: string;
  publisherId: string;
  journalId?: string;
  uploaderId: string;
}

export interface ProcessingResult {
  manuscriptId: string;
  status: "success" | "partial" | "error";
  title?: string;
  authorCount: number;
  referenceCount: number;
  chunkCount: number;
  processingTime: number;
  errors?: string[];
}

export type StatusCallback = (
  stage: string,
  progress: number,
  message: string
) => void;

/**
 * Process a manuscript through the full pipeline
 */
export async function processManuscript(
  input: ProcessingInput,
  onStatus?: StatusCallback
): Promise<ProcessingResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  const manuscriptId = generateId();

  const updateStatus = (stage: string, progress: number, message: string) => {
    console.log(`[Processor] ${stage}: ${message} (${progress}%)`);
    onStatus?.(stage, progress, message);
  };

  try {
    // ===== STAGE 1: Upload file =====
    updateStatus("upload", 10, "Uploading file to storage...");
    
    const storage = getStorage();
    const fileHash = await calculateHash(input.fileBuffer);
    
    const storageResult = await storage.upload(input.fileBuffer, {
      publisherId: input.publisherId,
      journalId: input.journalId,
      manuscriptId,
      fileName: input.fileName,
      mimeType: input.mimeType,
    });

    updateStatus("upload", 20, "File uploaded successfully");

    // ===== STAGE 2: Extract text =====
    updateStatus("extract_text", 25, "Extracting text from document...");
    
    let extractionResult;
    try {
      extractionResult = await extractText(
        input.fileBuffer,
        input.mimeType,
        input.fileName
      );
      updateStatus("extract_text", 35, `Extracted ${extractionResult.wordCount} words`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Text extraction failed";
      errors.push(errorMsg);
      updateStatus("extract_text", 35, `Text extraction failed: ${errorMsg}`);
      throw error;
    }

    // ===== STAGE 3: Extract metadata with LLM =====
    updateStatus("extract_metadata", 40, "Analyzing document with AI...");
    
    let metadata: ExtractedMetadata;
    try {
      metadata = await extractMetadata(extractionResult.text);
      updateStatus(
        "extract_metadata",
        60,
        `Extracted: "${metadata.title?.substring(0, 40)}..." with ${metadata.authors.length} authors`
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Metadata extraction failed";
      errors.push(errorMsg);
      updateStatus("extract_metadata", 60, `Metadata extraction failed: ${errorMsg}`);
      
      // Use empty metadata
      metadata = {
        keywords: [],
        authors: [],
        affiliations: [],
        declarations: {},
        statistics: {},
        references: [],
        extractionConfidence: 0,
      };
    }

    // ===== STAGE 4: Store in database =====
    updateStatus("store", 65, "Storing manuscript data...");
    
    // TODO: Implement database storage when schema is applied
    // await storeManuscript({
    //   manuscriptId,
    //   ...input,
    //   ...storageResult,
    //   extractedText: extractionResult.text,
    //   metadata,
    // });
    
    updateStatus("store", 75, "Manuscript data stored");

    // ===== STAGE 5: Generate embeddings =====
    updateStatus("embeddings", 80, "Generating document embeddings...");
    
    let chunkCount = 0;
    try {
      const sections = detectSections(extractionResult.text);
      const chunks = chunkText(extractionResult.text, sections);
      chunkCount = chunks.length;
      
      updateStatus("embeddings", 85, `Created ${chunkCount} chunks, generating embeddings...`);
      
      const embeddedChunks = await generateEmbeddings(chunks);
      
      // TODO: Store embeddings in pgvector
      // await storeChunks(manuscriptId, embeddedChunks);
      
      const modelInfo = getEmbeddingModelInfo();
      updateStatus(
        "embeddings",
        95,
        `Generated ${embeddedChunks.length} embeddings (${modelInfo.model})`
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Embedding generation failed";
      errors.push(errorMsg);
      updateStatus("embeddings", 95, `Embedding failed: ${errorMsg}`);
    }

    // ===== COMPLETE =====
    const processingTime = Date.now() - startTime;
    updateStatus("complete", 100, `Processing complete in ${processingTime}ms`);

    return {
      manuscriptId,
      status: errors.length === 0 ? "success" : "partial",
      title: metadata.title,
      authorCount: metadata.authors.length,
      referenceCount: metadata.references.length,
      chunkCount,
      processingTime,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (error) {
    const processingTime = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : "Processing failed";
    
    return {
      manuscriptId,
      status: "error",
      authorCount: 0,
      referenceCount: 0,
      chunkCount: 0,
      processingTime,
      errors: [...errors, errorMsg],
    };
  }
}

/**
 * Generate a unique manuscript ID
 */
function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `ms_${timestamp}_${random}`;
}

/**
 * Queue-based async processing
 * For background job processing
 */
export async function queueManuscriptProcessing(
  input: ProcessingInput
): Promise<{ jobId: string; manuscriptId: string }> {
  const manuscriptId = generateId();
  const jobId = `job_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;

  // TODO: Add to job queue (e.g., BullMQ, Inngest, or simple DB queue)
  // For now, we'll process immediately in the background
  
  // Start processing in background (don't await)
  processManuscript(input).catch(error => {
    console.error(`[Processor] Background job ${jobId} failed:`, error);
  });

  return { jobId, manuscriptId };
}

/**
 * Check processing status
 */
export async function getProcessingStatus(
  manuscriptId: string
): Promise<{
  status: string;
  progress: number;
  message?: string;
  error?: string;
} | null> {
  // TODO: Get from database or job queue
  // For now, return null (not found)
  return null;
}
