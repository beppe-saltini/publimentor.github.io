/**
 * In-memory cache for email enrichment results (30-day TTL).
 * Keyed by ORCID id or name+institutionDomain.
 */

import type { EmailEnrichmentResult } from "./email-enrichment";

const TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface CacheEntry {
  result: EmailEnrichmentResult;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export function emailCacheKey(input: {
  orcid?: string | null;
  name: string;
  institutionDomain?: string | null;
}): string {
  if (input.orcid) {
    return `orcid:${input.orcid.replace(/^https?:\/\/orcid\.org\//i, "")}`;
  }
  const domain = input.institutionDomain || "";
  return `name:${input.name.trim().toLowerCase()}|${domain}`;
}

export function getCachedEmail(
  key: string
): EmailEnrichmentResult | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.result;
}

export function setCachedEmail(
  key: string,
  result: EmailEnrichmentResult
): void {
  if (!result.email) return;
  cache.set(key, { result, expiresAt: Date.now() + TTL_MS });
}

export function clearEmailCache(): void {
  cache.clear();
}
