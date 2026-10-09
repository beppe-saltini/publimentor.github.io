-- Pre-accept format check reports (Journal-Ready Formatter & Compliance Checker).
-- FK-free by design: reports may come from ad-hoc uploads (no manuscript) and
-- must survive journal/manuscript deletion. Mirrors model FormatCheckReport in
-- prisma/schema.prisma.
CREATE TABLE IF NOT EXISTS "FormatCheckReport" (
  "id"             TEXT NOT NULL,
  "manuscriptId"   TEXT,
  "journalId"      TEXT,
  "profileId"      TEXT NOT NULL,
  "profileVersion" TEXT NOT NULL,
  "sourceType"     TEXT NOT NULL,
  "fileName"       TEXT,
  "results"        JSONB NOT NULL,
  "overrides"      JSONB,
  "letterText"     TEXT NOT NULL,
  "stats"          JSONB NOT NULL,
  "checkedById"    TEXT NOT NULL,
  "checkedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FormatCheckReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "FormatCheckReport_manuscriptId_idx" ON "FormatCheckReport"("manuscriptId");
CREATE INDEX IF NOT EXISTS "FormatCheckReport_journalId_idx" ON "FormatCheckReport"("journalId");
CREATE INDEX IF NOT EXISTS "FormatCheckReport_checkedById_idx" ON "FormatCheckReport"("checkedById");

-- Same posture as rls_security_fix.sql: block PostgREST (anon/authenticated) access;
-- Prisma connects as postgres, which bypasses RLS.
ALTER TABLE public."FormatCheckReport" ENABLE ROW LEVEL SECURITY;
