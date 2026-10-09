/**
 * Rebuild a reference list in the target journal style with DOIs from
 * Crossref.
 *
 * For every entry: parse the raw text, (a) if it carries a DOI resolve it
 * and accept when the title matches, otherwise (b) search Crossref
 * bibliographically through the shared retrieval module and accept the best
 * candidate when titleSimilarity >= 0.88 (THRESHOLDS.validatedTitle). On
 * acceptance the full Crossref record is fetched (cached per DOI) and the
 * reference is rendered in the target style. Anything that fails — no
 * match, network error, timeout — keeps the original text with
 * matched=false. Lookups run with concurrency 3 and never throw.
 */
import { THRESHOLDS, titleSimilarity, type CandidateWork } from "@/lib/references/reference-match";
import { searchCrossrefBibliographic } from "@/lib/references/reference-retrieval";
import type { ReferenceEntry } from "@/lib/format/manuscript-model";
import { dottedAbbreviation, fetchCrossrefWork, type CrossrefWorkRecord, type WorkCache } from "./crossref-work";
import { normalizePages, parseRawReference, toReferenceFields, type ParsedReference } from "./reference-parse";
import { renderReference } from "./reference-render";
import type { RepairedReference, TargetStructure } from "./types";

export { renderReference };

/** Injectable network layer so tests never touch the real Crossref API. */
export interface RepairDeps {
  search: (parsed: { title?: string; authors?: string; year?: number; journal?: string }) => Promise<CandidateWork[]>;
  fetchWork: (doi: string, cache: WorkCache) => Promise<CrossrefWorkRecord | null>;
  timeoutMs: number;
  concurrency: number;
  /** Politeness delay before each Crossref call per worker (ms); also seeds the retry backoff. */
  pauseMs: number;
}

export const defaultRepairDeps: RepairDeps = {
  search: (parsed) => searchCrossrefBibliographic(parsed),
  fetchWork: (doi, cache) => fetchCrossrefWork(doi, { cache, timeoutMs: 8000 }),
  timeoutMs: 10000,
  concurrency: 3,
  pauseMs: 250,
};

const TITLE_ACCEPT = THRESHOLDS.validatedTitle; // 0.88

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Run a network call politely: wait `pauseMs` first (keeps the three workers
 * well under Crossref's rate limit), retry thrown errors (429s surface as
 * exceptions from the shared search helper) with exponential backoff, and
 * never let a failure escape — the fallback is returned instead.
 */
async function polite<T>(fn: () => Promise<T>, deps: RepairDeps, fallback: T, attempts = 3): Promise<T> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (deps.pauseMs > 0) await sleep(deps.pauseMs * (attempt === 0 ? 1 : 2 ** attempt * 3));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), deps.timeoutMs);
    });
    try {
      return await Promise.race([fn(), timeout]);
    } catch {
      // thrown error or timeout: fall through to the next attempt
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return fallback;
}

/** Run `fn` over `items` with bounded parallelism, preserving order. */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Fields rendered from a Crossref record (authoritative when matched). */
export function fieldsFromWork(work: CrossrefWorkRecord, parsed: ParsedReference): RepairedReference["fields"] {
  const pages = normalizePages(work.page) || (work.articleNumber ? work.articleNumber : parsed.pages);
  return {
    authors: work.authors.length > 0 ? work.authors : parsed.authors,
    year: work.year ?? parsed.year,
    title: work.title || parsed.title,
    journal: work.containerTitle || parsed.journal,
    journalAbbrev: dottedAbbreviation(work.shortContainerTitle, work.containerTitle) || parsed.journal,
    volume: work.volume || parsed.volume,
    issue: work.issue || parsed.issue,
    pages,
  };
}

function authorsAsString(parsed: ParsedReference): string | undefined {
  if (parsed.authors.length === 0) return undefined;
  return parsed.authors.map((a) => (a.given ? `${a.family}, ${a.given}` : a.family)).join(", ");
}

const NOTICE_RE = /^(correction|corrigendum|erratum|retraction|retracted|expression of concern|publisher correction|author correction|addendum)\b/i;

/**
 * Score a candidate: title similarity, capped below the threshold when the
 * year is off by more than one, or when the candidate is a correction /
 * erratum notice and the cited reference is not. Exact-year matches get a
 * tiny bonus so they win ties against online-first duplicates.
 */
function candidateScore(parsed: ParsedReference, cand: { title: string; year?: number }): number {
  if (!parsed.title || !cand.title) return 0;
  const sim = titleSimilarity(parsed.title, cand.title);
  if (NOTICE_RE.test(cand.title) && !NOTICE_RE.test(parsed.title)) return Math.min(sim, TITLE_ACCEPT - 0.01);
  if (parsed.year && cand.year && Math.abs(parsed.year - cand.year) > 1) return Math.min(sim, TITLE_ACCEPT - 0.01);
  if (parsed.year && cand.year === parsed.year) return Math.min(1, sim + 0.005);
  return sim;
}

/** Repair one entry; isolated so one failure cannot affect the batch. */
async function repairOne(entry: ReferenceEntry, target: TargetStructure["references"], deps: RepairDeps, cache: WorkCache): Promise<RepairedReference> {
  const parsed = parseRawReference(entry.raw);
  const unmatched = (reason: string): RepairedReference => ({
    index: entry.index,
    original: entry.raw,
    formatted: entry.raw.trim(),
    doi: parsed.doi,
    matched: false,
    confidence: 0,
    source: reason,
    fields: toReferenceFields(parsed),
  });

  // (a) DOI present: resolve it and verify the title.
  let work: CrossrefWorkRecord | null = null;
  let confidence = 0;
  let source = "crossref";
  if (parsed.doi) {
    work = await polite(() => deps.fetchWork(parsed.doi!, cache), deps, null, 2);
    if (work) {
      const sim = parsed.title ? titleSimilarity(parsed.title, work.title) : 1;
      const isNotice = NOTICE_RE.test(work.title) && !(parsed.title && NOTICE_RE.test(parsed.title));
      if ((sim >= TITLE_ACCEPT || !parsed.title) && !isNotice) {
        confidence = parsed.title ? sim : 0.9;
        source = "crossref-doi";
      } else work = null;
    }
  }

  // (b) Bibliographic search.
  if (!work && parsed.title) {
    const candidates = await polite(() => deps.search({ title: parsed.title, authors: authorsAsString(parsed), year: parsed.year, journal: parsed.journal }), deps, [] as CandidateWork[]);
    const scored = candidates
      .filter((c) => c.doi)
      .map((c) => ({ c, score: candidateScore(parsed, c) }))
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (best && best.score >= TITLE_ACCEPT) {
      work = await polite(() => deps.fetchWork(best.c.doi!, cache), deps, null, 2);
      if (work && (titleSimilarity(parsed.title, work.title) < TITLE_ACCEPT || (NOTICE_RE.test(work.title) && !NOTICE_RE.test(parsed.title)))) work = null;
      confidence = best.score;
    }
  }

  if (!work) return unmatched(parsed.doi ? "doi-unverified" : "unmatched");

  const fields = fieldsFromWork(work, parsed);
  return {
    index: entry.index,
    original: entry.raw,
    formatted: renderReference(fields, target.style, entry.index, {
      etAlAfter: target.etAlAfter,
      includeDoi: target.includeDoi,
      doiAsUrl: target.doiAsUrl,
      doi: work.DOI,
    }),
    doi: work.DOI || parsed.doi,
    matched: true,
    confidence: Number(confidence.toFixed(3)),
    source,
    fields,
  };
}

/**
 * Repair a whole list. Order of the output equals the input order. Entries
 * that are unmatched keep their original text; callers can still show the
 * parsed fields to the authors.
 */
export async function repairReferences(entries: ReferenceEntry[], target: TargetStructure["references"], deps: Partial<RepairDeps> = {}): Promise<RepairedReference[]> {
  const d: RepairDeps = { ...defaultRepairDeps, ...deps };
  const cache: WorkCache = new Map();
  const safeRepair = async (entry: ReferenceEntry, opts: RepairDeps): Promise<RepairedReference> => {
    try {
      return await repairOne(entry, target, opts, cache);
    } catch {
      const parsed = parseRawReference(entry.raw);
      return { index: entry.index, original: entry.raw, formatted: entry.raw.trim(), doi: parsed.doi, matched: false, confidence: 0, source: "error", fields: toReferenceFields(parsed) };
    }
  };
  const results = await mapWithConcurrency(entries, d.concurrency, (entry) => safeRepair(entry, d));

  // Second, slower pass: entries that found no candidate are usually
  // rate-limit casualties, so retry them one at a time with a longer pause —
  // but only when the network clearly works (at least one match so far).
  const anyMatched = results.some((r) => r.matched);
  const retryIdx = results.map((r, i) => (!r.matched && r.source === "unmatched" && r.fields.title ? i : -1)).filter((i) => i >= 0);
  if (anyMatched && retryIdx.length > 0 && d.pauseMs > 0) {
    const slow: RepairDeps = { ...d, concurrency: 1, pauseMs: d.pauseMs * 4 };
    for (const i of retryIdx) results[i] = await safeRepair(entries[i], slow);
  }
  return results;
}

/** Render references offline (no lookup) — used when repair is disabled. */
export function formatReferencesOffline(entries: ReferenceEntry[], target: TargetStructure["references"]): RepairedReference[] {
  return entries.map((entry) => {
    const parsed = parseRawReference(entry.raw);
    const fields = toReferenceFields(parsed);
    const canRender = parsed.style !== "fallback" && parsed.authors.length > 0 && !!parsed.title;
    return {
      index: entry.index,
      original: entry.raw,
      formatted: canRender
        ? renderReference(fields, target.style, entry.index, { etAlAfter: target.etAlAfter, includeDoi: target.includeDoi, doiAsUrl: target.doiAsUrl, doi: parsed.doi })
        : entry.raw.trim(),
      doi: parsed.doi,
      matched: false,
      confidence: 0,
      source: "parsed",
      fields,
    };
  });
}
