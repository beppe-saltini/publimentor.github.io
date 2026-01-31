/**
 * Manuscript Module
 * 
 * Exports all manuscript-related functionality
 */

// Text extraction
export { 
  extractText, 
  detectSections,
  type ExtractionResult 
} from "./text-extractor";

// Metadata extraction
export { 
  extractMetadata,
  type ExtractedMetadata,
  type ExtractedAuthor,
  type ExtractedAffiliation,
  type ExtractedReference,
} from "./metadata-extractor";

// Embeddings
export {
  chunkText,
  generateEmbeddings,
  generateQueryEmbedding,
  cosineSimilarity,
  getEmbeddingModelInfo,
  type DocumentChunk,
  type EmbeddedChunk,
} from "./embeddings";

// Processing orchestrator
export {
  processManuscript,
  queueManuscriptProcessing,
  getProcessingStatus,
  type ProcessingInput,
  type ProcessingResult,
  type StatusCallback,
} from "./processor";
