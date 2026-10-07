/**
 * "Possibly deceased" screen: one web search per reviewer for obituary-style
 * pages, judged conservatively (the reviewer's name and a death term must appear
 * in the same result). Flagged reviewers are sorted to the bottom of the list and
 * shown with the search that triggered the flag, so the editor can judge.
 */

import { googleSearchUrl, webSearch, type WebSearchHit, type WebSearchProvider } from "./web-search";
import { isHighConfidencePersonMatch } from "./reputation-check";

const DECEASED_DISCLAIMER =
  "Automated web search only. A match can be a namesake or a relative; verify before acting on it.";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const BATCH_CONCURRENCY = 3;

const DEATH_TERMS =
  /\b(obituary|obituaries|passed away|has died|had died|died (on|peacefully|suddenly|aged|unexpectedly|at (home|the age))|death of|in memoriam|in memory of|remembering|rest in peace|the late|late professor|late dr\.?|tribute to|funeral|condolences)\b/i;

export interface DeceasedEvidence {
  title: string;
  url: string;
  snippet: string;
}

export interface DeceasedCheck {
  possiblyDeceased: boolean;
  query: string;
  /** Google search for the same query, whichever provider ran it. */
  searchUrl: string;
  provider: WebSearchProvider | null;
  evidence: DeceasedEvidence[];
  checkedAt: string;
  disclaimer: string;
}

export interface DeceasedCheckInput {
  name: string;
  firstName?: string;
  lastName?: string;
  affiliation?: string;
}

export function buildDeceasedQuery(name: string): string {
  return `"${name.trim()}" (obituary OR "passed away" OR "in memoriam" OR died)`;
}

/**
 * Keep hits that mention this person and a death term together. A hit whose
 * title carries both is strong; one hit like that, or two weaker ones, flags the reviewer.
 */
export function evaluateDeceasedEvidence(
  hits: WebSearchHit[],
  person: { name: string; firstName?: string; lastName?: string }
): { possiblyDeceased: boolean; evidence: DeceasedEvidence[] } {
  let strong = 0;
  const evidence: DeceasedEvidence[] = [];
  for (const hit of hits) {
    const text = `${hit.title} ${hit.snippet}`;
    if (!isHighConfidencePersonMatch(text, person) || !DEATH_TERMS.test(text)) continue;
    if (isHighConfidencePersonMatch(hit.title, person) && DEATH_TERMS.test(hit.title)) strong++;
    evidence.push({ title: hit.title, url: hit.url, snippet: hit.snippet });
  }
  return { possiblyDeceased: strong >= 1 || evidence.length >= 2, evidence };
}

const cache = new Map<string, { at: number; result: DeceasedCheck }>();

export async function checkReviewerDeceased(input: DeceasedCheckInput): Promise<DeceasedCheck> {
  const key = input.name.trim().toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.result;

  const query = buildDeceasedQuery(input.name);
  const { provider, hits } = await webSearch(query, 8);
  const verdict = evaluateDeceasedEvidence(hits, input);
  const result: DeceasedCheck = {
    ...verdict,
    query,
    searchUrl: googleSearchUrl(query),
    provider,
    checkedAt: new Date().toISOString(),
    disclaimer: DECEASED_DISCLAIMER,
  };
  if (provider !== null) cache.set(key, { at: Date.now(), result });
  return result;
}

interface WithReputation {
  reputationSummary?: {
    hasConcerns: boolean;
    entries: unknown[];
    checkedAt: string;
    disclaimer: string;
    deceased?: DeceasedCheck;
  };
}

/** Runs the check for each reviewer and stores it on reputationSummary.deceased. */
export async function enrichReviewerDeceasedBatch<T extends DeceasedCheckInput & WithReputation>(
  reviewers: T[]
): Promise<number> {
  let flagged = 0;
  const queue = [...reviewers];
  async function worker() {
    for (let r = queue.shift(); r; r = queue.shift()) {
      try {
        const check = await checkReviewerDeceased(r);
        r.reputationSummary = {
          hasConcerns: false,
          entries: [],
          checkedAt: check.checkedAt,
          disclaimer: "",
          ...r.reputationSummary,
          deceased: check,
        };
        if (check.possiblyDeceased) flagged++;
      } catch (err) {
        console.error(`[Deceased] Check failed for ${r.name}:`, err);
      }
    }
  }
  await Promise.all(Array.from({ length: BATCH_CONCURRENCY }, worker));
  return flagged;
}

export function isPossiblyDeceased(r: WithReputation): boolean {
  return r.reputationSummary?.deceased?.possiblyDeceased === true;
}
