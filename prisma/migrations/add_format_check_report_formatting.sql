-- Journal-Ready Formatter output columns on FormatCheckReport. All nullable:
-- a report row exists as soon as the checks have run; formatting fills these in
-- later (or never, when the editor asked for checks only). Mirrors the model in
-- prisma/schema.prisma; apply after add_format_check_report.sql.
ALTER TABLE "FormatCheckReport" ADD COLUMN IF NOT EXISTS "formatPlan"      JSONB;
ALTER TABLE "FormatCheckReport" ADD COLUMN IF NOT EXISTS "sourcePath"      TEXT;
ALTER TABLE "FormatCheckReport" ADD COLUMN IF NOT EXISTS "formattedPath"   TEXT;
ALTER TABLE "FormatCheckReport" ADD COLUMN IF NOT EXISTS "trackedPath"     TEXT;
ALTER TABLE "FormatCheckReport" ADD COLUMN IF NOT EXISTS "changeLogText"   TEXT;
ALTER TABLE "FormatCheckReport" ADD COLUMN IF NOT EXISTS "formattedAt"     TIMESTAMP(3);
ALTER TABLE "FormatCheckReport" ADD COLUMN IF NOT EXISTS "profileOverride" TEXT;
