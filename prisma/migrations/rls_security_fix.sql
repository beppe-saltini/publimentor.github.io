-- ============================================================
-- Supabase RLS Security Fix
-- Fixes all 27 issues from Supabase Performance & Security Lints
-- 
-- Context: This app uses Prisma with a direct connection string
-- (postgres role), NOT the Supabase client SDK. The Supabase
-- auto-generated REST API (PostgREST) exposes all public tables
-- via the anon/authenticated roles. Since we don't use those
-- roles, we enable RLS on every table and add NO policies,
-- effectively blocking all access via the REST API while
-- leaving Prisma's direct connection (postgres role) unaffected
-- because postgres bypasses RLS.
-- ============================================================

-- 1. Enable RLS on all tables
-- (The postgres role used by Prisma bypasses RLS by default,
--  so this ONLY restricts anon/authenticated PostgREST access)

ALTER TABLE public."User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Account" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."VerificationToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Publisher" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PublisherMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Journal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."JournalMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."FavouriteJournal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Submission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Author" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ReviewAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."FormatGuideline" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."FormatReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Manuscript" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ManuscriptPermission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ManuscriptAuthor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ManuscriptAffiliation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Institution" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ManuscriptReference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DocumentChunk" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ProcessingJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_retention_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._prisma_migrations ENABLE ROW LEVEL SECURITY;

-- 2. Revoke all privileges from anon and authenticated roles
--    on every table (belt-and-suspenders with RLS)

REVOKE ALL ON public."User" FROM anon, authenticated;
REVOKE ALL ON public."Account" FROM anon, authenticated;
REVOKE ALL ON public."Session" FROM anon, authenticated;
REVOKE ALL ON public."VerificationToken" FROM anon, authenticated;
REVOKE ALL ON public."Publisher" FROM anon, authenticated;
REVOKE ALL ON public."PublisherMember" FROM anon, authenticated;
REVOKE ALL ON public."Journal" FROM anon, authenticated;
REVOKE ALL ON public."JournalMember" FROM anon, authenticated;
REVOKE ALL ON public."FavouriteJournal" FROM anon, authenticated;
REVOKE ALL ON public."Submission" FROM anon, authenticated;
REVOKE ALL ON public."Author" FROM anon, authenticated;
REVOKE ALL ON public."ReviewAssignment" FROM anon, authenticated;
REVOKE ALL ON public."FormatGuideline" FROM anon, authenticated;
REVOKE ALL ON public."FormatReport" FROM anon, authenticated;
REVOKE ALL ON public."Manuscript" FROM anon, authenticated;
REVOKE ALL ON public."ManuscriptPermission" FROM anon, authenticated;
REVOKE ALL ON public."ManuscriptAuthor" FROM anon, authenticated;
REVOKE ALL ON public."ManuscriptAffiliation" FROM anon, authenticated;
REVOKE ALL ON public."Institution" FROM anon, authenticated;
REVOKE ALL ON public."ManuscriptReference" FROM anon, authenticated;
REVOKE ALL ON public."DocumentChunk" FROM anon, authenticated;
REVOKE ALL ON public."ProcessingJob" FROM anon, authenticated;
REVOKE ALL ON public.audit_logs FROM anon, authenticated;
REVOKE ALL ON public.data_retention_policies FROM anon, authenticated;
REVOKE ALL ON public._prisma_migrations FROM anon, authenticated;

-- 3. Also revoke default privileges on future tables in public schema
--    so any new tables created by Prisma are locked down automatically

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;

-- ============================================================
-- Verification: Run this query to confirm all tables have RLS enabled:
--
-- SELECT schemaname, tablename, rowsecurity 
-- FROM pg_tables 
-- WHERE schemaname = 'public';
--
-- All rows should show rowsecurity = true
-- ============================================================
