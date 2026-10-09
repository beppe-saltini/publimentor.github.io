/**
 * Request guards shared by the format routes: session, per-user rate limit and
 * the uniform JSON error shape ({ error }) used across the API.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkRateLimit, getRateLimitResponse } from "@/lib/security";

/** Both check routes: 10 checks per minute per user (each one runs the LLM detectors). */
export const FORMAT_CHECK_RATE_LIMIT = { windowMs: 60_000, maxRequests: 10 };

export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export type Guarded = { ok: true; userId: string } | { ok: false; response: NextResponse };

/** Resolve the signed-in user or produce the 401 response. */
export async function requireUser(): Promise<Guarded> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, response: jsonError("Unauthorized", 401) };
  return { ok: true, userId };
}

/** 401 / 429 guard for the two check routes. */
export async function requireUserWithinCheckLimit(): Promise<Guarded> {
  const guarded = await requireUser();
  if (!guarded.ok) return guarded;
  const limit = await checkRateLimit(`format:${guarded.userId}`, FORMAT_CHECK_RATE_LIMIT);
  if (!limit.allowed) return { ok: false, response: getRateLimitResponse(limit.resetIn) };
  return guarded;
}
