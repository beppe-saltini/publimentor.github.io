/**
 * Document Embedding Service
 * 
 * Uses open-source Sentence Transformers for generating embeddings
 * Via Hugging Face Inference API (free tier) or local model
 * 
 * Models:
 * - all-MiniLM-L6-v2: 384 dimensions, fast, good quality
 * - all-mpnet-base-v2: 768 dimensions, slower, better quality
 */

// Configuration
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "sentence-transformers/all-MiniLM-L6-v2";
const EMBEDDING_DIMENSIONS = EMBEDDING_MODEL.includes("MiniLM") ? 384 : 768;
const HF_API_TOKEN = process.env.HF_API_TOKEN; // Optional, for Hugging Face API
const HF_API_URL = `https://api-inference.huggingface.co/pipeline/feature-extraction/${EMBEDDING_MODEL}`;

// Chunk configuration
const CHUNK_SIZE = 500; // Characters per chunk
const CHUNK_OVERLAP = 50; // Overlap between chunks

export interface DocumentChunk {
  content: string;
  chunkIndex: number;
  charStart: number;
  charEnd: number;
  section?: string;
  tokenCount?: number;
}

export interface EmbeddedChunk extends DocumentChunk {
  embedding: number[];
}

/**
 * Split text into chunks for embedding
 */
export function chunkText(
  text: string,
  sections?: { name: string; start: number; end: number }[]
): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  let chunkIndex = 0;
  let position = 0;

  while (position < text.length) {
    const charStart = position;
    const charEnd = Math.min(position + CHUNK_SIZE, text.length);
    
    // Try to break at sentence boundary
    let actualEnd = charEnd;
    if (charEnd < text.length) {
      const searchText = text.substring(charEnd - 50, charEnd + 50);
      const sentenceEnd = searchText.search(/[.!?]\s/);
      if (sentenceEnd !== -1) {
        actualEnd = charEnd - 50 + sentenceEnd + 2;
      }
    }

    const content = text.substring(charStart, actualEnd).trim();
    
    if (content.length > 0) {
      // Detect which section this chunk belongs to
      let section: string | undefined;
      if (sections) {
        const matchingSection = sections.find(
          s => charStart >= s.start && charStart < s.end
        );
        section = matchingSection?.name;
      }

      chunks.push({
        content,
        chunkIndex,
        charStart,
        charEnd: actualEnd,
        section,
        tokenCount: estimateTokens(content),
      });
      
      chunkIndex++;
    }

    // Move position with overlap
    position = actualEnd - CHUNK_OVERLAP;
    if (position <= charStart) {
      position = actualEnd; // Prevent infinite loop
    }
  }

  return chunks;
}

/**
 * Estimate token count (rough approximation)
 */
function estimateTokens(text: string): number {
  // Rough estimate: 1 token ≈ 4 characters for English
  return Math.ceil(text.length / 4);
}

/**
 * Generate embeddings for chunks using Hugging Face API
 */
export async function generateEmbeddings(chunks: DocumentChunk[]): Promise<EmbeddedChunk[]> {
  const embeddedChunks: EmbeddedChunk[] = [];

  // Process in batches to avoid rate limits
  const batchSize = 10;
  
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const texts = batch.map(c => c.content);
    
    try {
      const embeddings = await getEmbeddingsFromHF(texts);
      
      for (let j = 0; j < batch.length; j++) {
        embeddedChunks.push({
          ...batch[j],
          embedding: embeddings[j],
        });
      }
      
      // Rate limiting
      if (i + batchSize < chunks.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      console.error(`[Embeddings] Error processing batch ${i}:`, error);
      
      // Add chunks without embeddings on error
      for (const chunk of batch) {
        embeddedChunks.push({
          ...chunk,
          embedding: [],
        });
      }
    }
  }

  return embeddedChunks;
}

/**
 * Get embeddings from Hugging Face Inference API
 */
async function getEmbeddingsFromHF(texts: string[]): Promise<number[][]> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  
  if (HF_API_TOKEN) {
    headers["Authorization"] = `Bearer ${HF_API_TOKEN}`;
  }

  const response = await fetch(HF_API_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      inputs: texts,
      options: {
        wait_for_model: true,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`HuggingFace API error: ${response.status} - ${error}`);
  }

  const embeddings = await response.json();
  
  // The API returns nested arrays - we need to handle mean pooling
  // For sentence-transformers models, this is usually already done
  return embeddings.map((emb: number[] | number[][]) => {
    if (Array.isArray(emb[0])) {
      // Need to mean pool token embeddings
      return meanPool(emb as number[][]);
    }
    return emb as number[];
  });
}

/**
 * Mean pooling for token embeddings
 */
function meanPool(tokenEmbeddings: number[][]): number[] {
  if (tokenEmbeddings.length === 0) return [];
  
  const dim = tokenEmbeddings[0].length;
  const result = new Array(dim).fill(0);
  
  for (const emb of tokenEmbeddings) {
    for (let i = 0; i < dim; i++) {
      result[i] += emb[i];
    }
  }
  
  for (let i = 0; i < dim; i++) {
    result[i] /= tokenEmbeddings.length;
  }
  
  return result;
}

/**
 * Generate embedding for a single query
 */
export async function generateQueryEmbedding(query: string): Promise<number[]> {
  const embeddings = await getEmbeddingsFromHF([query]);
  return embeddings[0];
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

/**
 * Get embedding model info
 */
export function getEmbeddingModelInfo() {
  return {
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
  };
}
