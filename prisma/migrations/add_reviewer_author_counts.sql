-- Author-position counts for saved reviewer suggestions; without them a reloaded reviewer showed 0 / 0 / 0
ALTER TABLE "ManuscriptReviewer" ADD COLUMN IF NOT EXISTS "firstAuthorCount" INTEGER;
ALTER TABLE "ManuscriptReviewer" ADD COLUMN IF NOT EXISTS "lastAuthorCount" INTEGER;
ALTER TABLE "ManuscriptReviewer" ADD COLUMN IF NOT EXISTS "seniorAuthorCount" INTEGER;
