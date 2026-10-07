import { prisma } from "@/lib/prisma";
import { generateEmbeddings, getEmbeddingModelInfo, isEmbeddingConfigured } from "./embeddings";

function sanitizeErrorForStorage(error: unknown): string {
  const msg = error instanceof Error ? error.message : "Embedding failed";
  return msg.replace(/\/[^\s:]+/g, "[path]").replace(/https?:\/\/[^\s]+/g, "[url]").substring(0, 500);
}

/**
 * Generate and store pgvector embeddings for a manuscript's chunks.
 * Runs after the manuscript is already READY; failures are recorded on the
 * processing job and never change the manuscript status. Does nothing unless
 * HF_API_TOKEN is configured.
 */
export async function embedManuscript(
  manuscriptId: string,
  publisherId: string
): Promise<void> {
  if (!isEmbeddingConfigured()) return;

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
