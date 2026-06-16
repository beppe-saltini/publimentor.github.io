-- Add reputation screening results (PubPeer / For Better Science) to manuscript reviewers
ALTER TABLE "ManuscriptReviewer" ADD COLUMN IF NOT EXISTS "reputationSummary" JSONB;
