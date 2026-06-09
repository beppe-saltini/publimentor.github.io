/**
 * Multi-source retrieval for reference metadata validation.
 */

import { openAlex } from "@/lib/openalex";
import { searchPubMedArticles } from "@/lib/pubmed";
import type { OpenAlexWork } from "@/types";
import type { CandidateWork, ParsedReferenceFields } from "./reference-match";
import { extractAuthorSurnames, titleSimilarity } from "./reference-match";

const CROSSREF_BASE = "https://api.crossref.org/works";
const USER_AGENT = "PubliMentor/1.0 (mailto:support@publimentor.com)";

export interface RetrievalResult {
  candidates: CandidateWork[];
  sourcesQueried: string[];
  sourcesReached: number;
  errors: string[];
}

function openAlexToCandidate(work: OpenAlexWork): CandidateWork {
  const authors = (work.authorships || [])
    .map((a) => a.author?.display_name || "")
    .filter(Boolean);
  const journal = work.primary_location?.source?.display_name;
  let doi = work.doi;
  if (doi?.startsWith("https://doi.org/")) {
    doi = doi.replace("https://doi.org/", "");
  }

  return {
    title: typeof work.title === "string" ? work.title : String(work.title || ""),
    authors,
    year: work.publication_year,
    journal,
    doi,
    source: "openalex",
  };
}

interface CrossrefAuthor {
  given?: string;
  family?: string;
}

interface CrossrefWork {
  title?: string[];
  author?: CrossrefAuthor[];
  published?: { "date-parts"?: number[][] };
  "published-print"?: { "date-parts"?: number[][] };
  "published-online"?: { "date-parts"?: number[][] };
  "container-title"?: string[];
  DOI?: string;
}

function crossrefToCandidate(work: CrossrefWork): CandidateWork {
  const authors = (work.author || [])
    .map((a) => `${a.given || ""} ${a.family || ""}`.trim())
    .filter(Boolean);
  const year =
    work.published?.["date-parts"]?.[0]?.[0] ||
    work["published-print"]?.["date-parts"]?.[0]?.[0] ||
    work["published-online"]?.["date-parts"]?.[0]?.[0];

  return {
    title: work.title?.[0] || "",
    authors,
    year,
    journal: work["container-title"]?.[0],
    doi: work.DOI,
    source: "crossref",
  };
}

/**
 * Build bibliographic search string from parsed fields
 */
export function buildSearchQuery(parsed: ParsedReferenceFields): string {
  const parts: string[] = [];
  if (parsed.title) parts.push(parsed.title);
  if (parsed.authors) {
    const surnames = extractAuthorSurnames(parsed.authors);
    if (surnames.length > 0) parts.push(surnames[0]);
  }
  if (parsed.year) parts.push(String(parsed.year));
  if (parsed.journal) parts.push(parsed.journal);
  return parts.join(" ").trim();
}

/**
 * Build PubMed query: title + first author surname
 */
export function buildPubMedQuery(parsed: ParsedReferenceFields): string {
  if (!parsed.title?.trim()) return "";

  const surnames = extractAuthorSurnames(parsed.authors || "");
  const titleTerm = `"${parsed.title.replace(/"/g, "")}"[Title]`;
  if (surnames.length > 0) {
    return `${titleTerm} AND ${surnames[0]}[Author]`;
  }
  return `${parsed.title}[Title]`;
}

export async function searchOpenAlexByMetadata(
  parsed: ParsedReferenceFields
): Promise<CandidateWork[]> {
  const query = parsed.title?.trim() || buildSearchQuery(parsed);
  if (!query) return [];

  try {
    const response = await openAlex.searchWorks({ query, perPage: 5 });
    let results = (response.results || []).map(openAlexToCandidate);

    if (parsed.year) {
      const filtered = results.filter(
        (r) => r.year != null && Math.abs(r.year - parsed.year!) <= 1
      );
      if (filtered.length > 0) results = filtered;
    }

    return results;
  } catch (err) {
    console.error("[RefRetrieval] OpenAlex error:", err);
    throw err;
  }
}

export async function searchCrossrefBibliographic(
  parsed: ParsedReferenceFields
): Promise<CandidateWork[]> {
  const bibliographic = buildSearchQuery(parsed);
  if (!bibliographic) return [];

  const params = new URLSearchParams({
    "query.bibliographic": bibliographic,
    rows: "5",
  });

  const response = await fetch(`${CROSSREF_BASE}?${params}`, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!response.ok) {
    throw new Error(`Crossref search failed: ${response.status}`);
  }

  const data = await response.json();
  const items: CrossrefWork[] = data.message?.items || [];
  return items.map(crossrefToCandidate).filter((c) => c.title.length > 0);
}

export async function searchPubMedByMetadata(
  parsed: ParsedReferenceFields
): Promise<CandidateWork[]> {
  const query = buildPubMedQuery(parsed);
  if (!query) return [];

  const articles = await searchPubMedArticles(query, 5);
  return articles.map((a) => {
    const yearMatch = a.pubDate?.match(/\b(19|20)\d{2}\b/);
    return {
      title: a.title,
      authors: a.authors.map((auth) => auth.fullName || `${auth.foreName} ${auth.lastName}`.trim()),
      year: yearMatch ? parseInt(yearMatch[0], 10) : undefined,
      journal: a.journal,
      doi: a.doi,
      pmid: a.pmid,
      source: "pubmed" as const,
    };
  });
}

/**
 * Query all sources in parallel and merge candidates
 */
export async function retrieveCandidates(
  parsed: ParsedReferenceFields
): Promise<RetrievalResult> {
  const sourcesQueried: string[] = [];
  const errors: string[] = [];
  const allCandidates: CandidateWork[] = [];
  let sourcesReached = 0;

  if (!parsed.title?.trim() && !buildSearchQuery(parsed)) {
    return {
      candidates: [],
      sourcesQueried: [],
      sourcesReached: 0,
      errors: ["No parseable title for search"],
    };
  }

  const tasks: { name: string; run: () => Promise<CandidateWork[]> }[] = [
    { name: "openalex", run: () => searchOpenAlexByMetadata(parsed) },
    { name: "crossref", run: () => searchCrossrefBibliographic(parsed) },
    { name: "pubmed", run: () => searchPubMedByMetadata(parsed) },
  ];

  sourcesQueried.push(...tasks.map((t) => t.name));

  const results = await Promise.allSettled(
    tasks.map(async (t) => ({ name: t.name, candidates: await t.run() }))
  );

  results.forEach((result, i) => {
    const name = tasks[i]?.name || "unknown";
    if (result.status === "fulfilled") {
      if (result.value.candidates.length > 0) {
        sourcesReached++;
        allCandidates.push(...result.value.candidates);
      }
    } else {
      errors.push(`${name}: ${result.reason instanceof Error ? result.reason.message : "failed"}`);
      console.error(`[RefRetrieval] ${name} failed:`, result.reason);
    }
  });

  return {
    candidates: allCandidates,
    sourcesQueried,
    sourcesReached,
    errors,
  };
}

/**
 * Resolve DOI metadata for corroboration / retraction (not used as primary match key)
 */
export async function resolveDoiMetadata(doi: string): Promise<{
  title?: string;
  authors?: string[];
  year?: number;
  journal?: string;
  valid: boolean;
}> {
  try {
    const encoded = encodeURIComponent(doi);
    const response = await fetch(`${CROSSREF_BASE}/${encoded}`, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!response.ok) return { valid: false };

    const data = await response.json();
    const work = data.message;
    const authors = (work.author || [])
      .map((a: CrossrefAuthor) => `${a.given || ""} ${a.family || ""}`.trim())
      .filter(Boolean);

    return {
      valid: true,
      title: work.title?.[0],
      authors,
      year:
        work.published?.["date-parts"]?.[0]?.[0] ||
        work["published-print"]?.["date-parts"]?.[0]?.[0],
      journal: work["container-title"]?.[0],
    };
  } catch {
    return { valid: false };
  }
}

export async function checkDoiRetracted(doi: string): Promise<{
  isRetracted: boolean;
  retractionDate?: string;
}> {
  try {
    const encoded = encodeURIComponent(doi);
    const response = await fetch(`${CROSSREF_BASE}/${encoded}`, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!response.ok) return { isRetracted: false };

    const data = await response.json();
    const work = data.message;
    const updateTo = work["update-to"];
    if (updateTo && Array.isArray(updateTo)) {
      const retraction = updateTo.find((u: { type?: string }) => u.type === "retraction");
      if (retraction) {
        return {
          isRetracted: true,
          retractionDate: retraction.updated?.["date-parts"]?.[0]?.join("-"),
        };
      }
    }
    if (work.type === "retracted-article") {
      return { isRetracted: true };
    }
    return { isRetracted: false };
  } catch {
    return { isRetracted: false };
  }
}

/**
 * Check if cited title matches DOI-resolved title (corroboration only)
 */
export function checkDoiTitleMismatch(
  citedTitle: string,
  resolvedTitle: string | undefined
): boolean {
  if (!resolvedTitle?.trim() || !citedTitle?.trim()) return false;
  return titleSimilarity(citedTitle, resolvedTitle) < 0.5;
}
