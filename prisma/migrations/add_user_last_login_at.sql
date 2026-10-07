-- Sign-in timestamp for the inactive-user retention policy (sessions are JWTs, so the Session table is empty)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3);
