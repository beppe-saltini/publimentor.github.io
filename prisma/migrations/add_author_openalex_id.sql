-- Resolved OpenAlex author id per manuscript author, reused by reviewer searches and COI checks
ALTER TABLE "ManuscriptAuthor" ADD COLUMN IF NOT EXISTS "openAlexId" TEXT;
CREATE INDEX IF NOT EXISTS "ManuscriptAuthor_openAlexId_idx" ON "ManuscriptAuthor"("openAlexId");
