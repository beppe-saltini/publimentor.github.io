/**
 * Fuzzy matching utilities for reference metadata validation.
 * Pure functions — no network I/O.
 */

export interface ParsedReferenceFields {
  title?: string;
  authors?: string;
  year?: number;
  journal?: string;
}

export interface CandidateWork {
  title: string;
  authors: string[];
  year?: number;
  journal?: string;
  doi?: string;
  pmid?: string;
  source: "openalex" | "crossref" | "pubmed";
}

export interface ScoredCandidate {
  candidate: CandidateWork;
  titleScore: number;
  authorScore: number;
  yearScore: number;
  journalScore: number;
  compositeScore: number;
  sourceCount: number;
}

/** Classification thresholds */
export const THRESHOLDS = {
  validatedComposite: 0.85,
  validatedTitle: 0.88,
  validatedAuthor: 0.5,
  validatedYear: 0.8,
  fakeComposite: 0.45,
  fakeDoiTitleMismatch: 0.5,
  ambiguousTopGap: 0.1,
} as const;

const STOP_WORDS = new Set([
  "a", "an", "the", "of", "in", "on", "for", "to", "and", "or", "with", "by",
  "from", "at", "as", "is", "are", "was", "were", "be", "been", "being",
]);

/**
 * Normalize a title for comparison
 */
export function normalizeTitle(title: string): string {
  let t = title.toLowerCase().trim();
  // Strip HTML entities / tags
  t = t.replace(/<[^>]+>/g, "");
  // Remove subtitle after colon (common in citations)
  const colonIdx = t.indexOf(":");
  if (colonIdx > 20) {
    t = t.slice(0, colonIdx);
  }
  t = t
    .replace(/[''`]/g, "'")
    .replace(/[""]/g, '"')
    .replace(/[-–—]/g, " ")
    .replace(/[^\w\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t;
}

/**
 * Tokenize for similarity (drop stop words)
 */
function titleTokens(title: string): Set<string> {
  const normalized = normalizeTitle(title);
  const tokens = normalized.split(/\s+/).filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  return new Set(tokens);
}

/**
 * Token-set Jaccard similarity (0–1)
 */
export function titleSimilarity(a: string, b: string): number {
  if (!a.trim() || !b.trim()) return 0;
  const setA = titleTokens(a);
  const setB = titleTokens(b);
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Extract author surnames from a citation author string
 */
export function extractAuthorSurnames(authors: string): string[] {
  if (!authors?.trim()) return [];

  const surnames: string[] = [];
  // Split on "and", "&", semicolon, comma between author blocks
  const blocks = authors
    .split(/\s+and\s+|\s*&\s*|;\s*|,\s*(?=[A-Z])/i)
    .map((b) => b.trim())
    .filter(Boolean);

  for (const block of blocks.length > 0 ? blocks : [authors]) {
    // "Smith, J." or "J. Smith" or "Smith J"
    const commaMatch = block.match(/^([A-Za-zÀ-ÿ][\w'-]+)\s*,/);
    if (commaMatch) {
      surnames.push(commaMatch[1].toLowerCase());
      continue;
    }
    const parts = block.replace(/\./g, " ").trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      if (last.length > 1 && !/^\d+$/.test(last)) {
        surnames.push(last.toLowerCase());
      } else if (parts[0].length > 1) {
        // "Smith J" — surname first
        surnames.push(parts[0].toLowerCase());
      }
    } else if (parts.length === 1 && parts[0].length > 2) {
      surnames.push(parts[0].toLowerCase());
    }
  }

  return [...new Set(surnames)];
}

/**
 * Author overlap: fraction of cited surnames found in candidate list
 */
export function authorSimilarity(citedAuthors: string, candidateAuthors: string[]): number {
  const citedSurnames = extractAuthorSurnames(citedAuthors);
  if (citedSurnames.length === 0) return 1; // no authors to compare — neutral

  const candidateSurnames = new Set<string>();
  for (const name of candidateAuthors) {
    const parts = name.trim().split(/\s+/);
    if (parts.length > 0) {
      candidateSurnames.add(parts[parts.length - 1].toLowerCase().replace(/[^a-z'-]/g, ""));
    }
    // Also check "Family, Given" format
    const comma = name.match(/^([A-Za-zÀ-ÿ][\w'-]+)\s*,/);
    if (comma) candidateSurnames.add(comma[1].toLowerCase());
  }

  let matched = 0;
  for (const s of citedSurnames) {
    if (candidateSurnames.has(s)) matched++;
  }
  return matched / citedSurnames.length;
}

/**
 * Year similarity with ±1 tolerance
 */
export function yearSimilarity(citedYear: number | undefined, candidateYear: number | undefined): number {
  if (citedYear == null) return 1;
  if (candidateYear == null) return 0.5;
  if (citedYear === candidateYear) return 1;
  if (Math.abs(citedYear - candidateYear) === 1) return 0.8;
  return 0;
}

/**
 * Journal / venue token overlap
 */
export function journalSimilarity(citedJournal: string | undefined, candidateJournal: string | undefined): number {
  if (!citedJournal?.trim() || !candidateJournal?.trim()) return 1;
  return titleSimilarity(citedJournal, candidateJournal);
}

/**
 * Score a single candidate against parsed reference fields
 */
export function scoreCandidate(
  parsed: ParsedReferenceFields,
  candidate: CandidateWork,
  sourceCount = 1
): ScoredCandidate {
  const titleScore = titleSimilarity(parsed.title || "", candidate.title);
  const authorScore = authorSimilarity(parsed.authors || "", candidate.authors);
  const yearScore = yearSimilarity(parsed.year, candidate.year);
  const journalScore = journalSimilarity(parsed.journal, candidate.journal);

  let compositeScore =
    0.55 * titleScore + 0.3 * authorScore + 0.15 * yearScore;

  // Small journal bonus when both present
  if (parsed.journal && candidate.journal) {
    compositeScore = 0.9 * compositeScore + 0.1 * journalScore;
  }

  // Multi-source confirmation bonus
  if (sourceCount >= 2) {
    compositeScore = Math.min(1, compositeScore + 0.05 * (sourceCount - 1));
  }

  return {
    candidate,
    titleScore,
    authorScore,
    yearScore,
    journalScore,
    compositeScore,
    sourceCount,
  };
}

/**
 * Deduplicate candidates by normalized title, track source count
 */
export function deduplicateCandidates(candidates: CandidateWork[]): CandidateWork[] {
  const byKey = new Map<string, { work: CandidateWork; sources: Set<string> }>();

  for (const c of candidates) {
    const key = normalizeTitle(c.title);
    if (!key) continue;
    const existing = byKey.get(key);
    if (existing) {
      existing.sources.add(c.source);
      // Prefer entry with DOI
      if (!existing.work.doi && c.doi) existing.work = { ...c, source: existing.work.source };
    } else {
      byKey.set(key, { work: c, sources: new Set([c.source]) });
    }
  }

  return Array.from(byKey.values()).map(({ work, sources }) => ({
    ...work,
    source: work.source,
    _sourceCount: sources.size,
  })) as (CandidateWork & { _sourceCount?: number })[];
}

/**
 * Pick best and runner-up matches from candidates
 */
export function pickBestMatches(
  parsed: ParsedReferenceFields,
  candidates: CandidateWork[]
): { best: ScoredCandidate | null; runnerUp: ScoredCandidate | null; allScored: ScoredCandidate[] } {
  const deduped = deduplicateCandidates(candidates);
  const sourceCounts = new Map<string, number>();
  for (const c of candidates) {
    const key = normalizeTitle(c.title);
    sourceCounts.set(key, (sourceCounts.get(key) || 0) + 1);
  }

  const scored: ScoredCandidate[] = deduped.map((c) => {
    const key = normalizeTitle(c.title);
    const count = new Set(
      candidates.filter((x) => normalizeTitle(x.title) === key).map((x) => x.source)
    ).size;
    return scoreCandidate(parsed, c, count);
  });

  scored.sort((a, b) => b.compositeScore - a.compositeScore);

  return {
    best: scored[0] || null,
    runnerUp: scored[1] || null,
    allScored: scored,
  };
}

export type ReferenceClassification = "validated" | "fake" | "unsure";

export interface ClassificationInput {
  parsed: ParsedReferenceFields;
  best: ScoredCandidate | null;
  runnerUp: ScoredCandidate | null;
  sourcesReached: number;
  sourcesQueried: number;
  isRetracted: boolean;
  doiTitleMismatch: boolean;
  hasParseableTitle: boolean;
  apiErrors: string[];
}

/**
 * Classify a reference into validated / fake / unsure
 */
export function classifyReference(input: ClassificationInput): ReferenceClassification {
  const {
    parsed,
    best,
    runnerUp,
    sourcesReached,
    isRetracted,
    doiTitleMismatch,
    hasParseableTitle,
    apiErrors,
  } = input;

  if (isRetracted) return "fake";
  if (doiTitleMismatch) return "fake";

  if (!hasParseableTitle) return "unsure";

  if (!best || best.compositeScore < THRESHOLDS.fakeComposite) {
    if (sourcesReached >= 2) return "fake";
    if (apiErrors.length > 0 && sourcesReached < 2) return "unsure";
    return "fake";
  }

  const yearRequired = parsed.year != null;
  const yearOk = !yearRequired || best.yearScore >= THRESHOLDS.validatedYear;
  const authorOk =
    !parsed.authors?.trim() || best.authorScore >= THRESHOLDS.validatedAuthor;

  const validated =
    best.compositeScore >= THRESHOLDS.validatedComposite &&
    best.titleScore >= THRESHOLDS.validatedTitle &&
    authorOk &&
    yearOk;

  if (validated) {
    // Ambiguous if two candidates are very close
    if (
      runnerUp &&
      best.compositeScore - runnerUp.compositeScore < THRESHOLDS.ambiguousTopGap
    ) {
      return "unsure";
    }
    return "validated";
  }

  if (best.compositeScore < THRESHOLDS.fakeComposite) return "fake";

  return "unsure";
}
