/**
 * Metadata-first reference validation.
 * Searches OpenAlex, Crossref, and PubMed by title/author/year — not by DOI alone.
 */

import { parseReferences, type ReferenceInput as LegacyReferenceInput } from "../reference-validator";
import {
  classifyReference,
  pickBestMatches,
  THRESHOLDS,
  type ParsedReferenceFields,
  type ReferenceClassification,
  type ScoredCandidate,
} from "./reference-match";
import {
  retrieveCandidates,
  resolveDoiMetadata,
  checkDoiRetracted,
  checkDoiTitleMismatch,
} from "./reference-retrieval";

export interface ReferenceMetadataInput {
  raw: string;
  doi?: string;
  pmid?: string;
  title?: string;
  authors?: string;
  year?: number;
  journal?: string;
}

export interface BestMatchInfo {
  title: string;
  authors: string[];
  year?: number;
  journal?: string;
  doi?: string;
  pmid?: string;
  source: string;
  compositeScore: number;
  titleScore: number;
  authorScore: number;
  yearScore: number;
}

export interface ReferenceMetadataResult {
  input: ReferenceMetadataInput;
  parsed: ParsedReferenceFields;
  classification: ReferenceClassification;
  bestMatch?: BestMatchInfo;
  alternativeCandidates: BestMatchInfo[];
  sourcesQueried: string[];
  sourcesReached: number;
  isRetracted: boolean;
  retractionDate?: string;
  issues: string[];
}

export interface ReferenceMetadataValidationResult {
  validated: ReferenceMetadataResult[];
  fake: ReferenceMetadataResult[];
  unsure: ReferenceMetadataResult[];
  summary: {
    total: number;
    validated: number;
    fake: number;
    unsure: number;
  };
  disclaimer: string;
}

/**
 * Heuristic parse of title, authors, year, journal from raw citation text
 */
export function parseReferenceFields(raw: string): ParsedReferenceFields {
  const fields: ParsedReferenceFields = {};

  const yearMatch = raw.match(/\b(19|20)\d{2}\b/g);
  if (yearMatch) {
    fields.year = parseInt(yearMatch[yearMatch.length - 1], 10);
  }

  const quotedTitle = raw.match(/"([^"]{10,})"/) || raw.match(/'([^']{10,})'/);
  if (quotedTitle) {
    fields.title = quotedTitle[1].trim();
  }

  // "Title." Journal pattern — title before year in italics or after authors
  if (!fields.title) {
    const afterAuthors = raw.match(/\)\s*\.?\s*([^.]+\.)\s+[A-Z][^,]+,\s*\d{4}/);
    if (afterAuthors) {
      fields.title = afterAuthors[1].replace(/\.$/, "").trim();
    }
  }

  if (!fields.title) {
    const titleCase = raw.match(/\.\s+([A-Z][^.]{15,}?)\.\s+(?:[A-Z][a-z]+|[A-Z]{2,})/);
    if (titleCase) fields.title = titleCase[1].trim();
  }

  // Authors: text before year, often "Surname, Initial"
  const authorYear = raw.match(/^(.+?)\s*\(?\s*(19|20)\d{2}/);
  if (authorYear) {
    let authorPart = authorYear[1]
      .replace(/^[\[\(]?\d+[\]\)]?\.?\s*/, "")
      .trim();
    authorPart = authorPart.replace(/\.\s+[A-Z].*$/, "").trim();
    if (authorPart.length > 3 && authorPart.length < 200) {
      fields.authors = authorPart;
    }
  }

  // Journal: often italicized segment or after title before year
  const journalMatch = raw.match(/\.\s+([A-Z][A-Za-z\s&]+),\s*(?:\d{4}|vol)/i);
  if (journalMatch) fields.journal = journalMatch[1].trim();

  return fields;
}

/**
 * Merge structured input with heuristic parse from raw
 */
export function mergeParsedFields(input: ReferenceMetadataInput): ParsedReferenceFields {
  const fromRaw = parseReferenceFields(input.raw);
  return {
    title: input.title?.trim() || fromRaw.title,
    authors: input.authors?.trim() || fromRaw.authors,
    year: input.year ?? fromRaw.year,
    journal: input.journal?.trim() || fromRaw.journal,
  };
}

function scoredToBestMatch(scored: ScoredCandidate): BestMatchInfo {
  return {
    title: scored.candidate.title,
    authors: scored.candidate.authors,
    year: scored.candidate.year,
    journal: scored.candidate.journal,
    doi: scored.candidate.doi,
    pmid: scored.candidate.pmid,
    source: scored.candidate.source,
    compositeScore: Math.round(scored.compositeScore * 100) / 100,
    titleScore: Math.round(scored.titleScore * 100) / 100,
    authorScore: Math.round(scored.authorScore * 100) / 100,
    yearScore: Math.round(scored.yearScore * 100) / 100,
  };
}

/**
 * Validate a single reference by metadata search
 */
export async function validateReferenceByMetadata(
  input: ReferenceMetadataInput
): Promise<ReferenceMetadataResult> {
  const parsed = mergeParsedFields(input);
  const issues: string[] = [];
  const hasParseableTitle = !!(parsed.title?.trim());

  if (!hasParseableTitle) {
    issues.push("Could not extract a title for bibliographic search");
  }

  let retrieval = {
    candidates: [] as Awaited<ReturnType<typeof retrieveCandidates>>["candidates"],
    sourcesQueried: [] as string[],
    sourcesReached: 0,
    errors: [] as string[],
  };

  if (hasParseableTitle) {
    retrieval = await retrieveCandidates(parsed);
    issues.push(...retrieval.errors);
  }

  const { best, runnerUp, allScored } = pickBestMatches(parsed, retrieval.candidates);

  let isRetracted = false;
  let retractionDate: string | undefined;
  let doiMismatch = false;

  const doiToCheck = input.doi || best?.candidate.doi;
  if (input.doi) {
    const resolved = await resolveDoiMetadata(input.doi);
    if (resolved.valid && parsed.title) {
      if (checkDoiTitleMismatch(parsed.title, resolved.title)) {
        doiMismatch = true;
        issues.push("DOI resolves to a different paper than the cited title");
      }
    }
    const retraction = await checkDoiRetracted(input.doi);
    if (retraction.isRetracted) {
      isRetracted = true;
      retractionDate = retraction.retractionDate;
      issues.push("Paper associated with this DOI has been RETRACTED");
    }
  } else if (doiToCheck && best && best.compositeScore >= THRESHOLDS.validatedComposite) {
    const retraction = await checkDoiRetracted(doiToCheck);
    if (retraction.isRetracted) {
      isRetracted = true;
      retractionDate = retraction.retractionDate;
      issues.push("Best-matching paper has been RETRACTED");
    }
  }

  const classification = classifyReference({
    parsed,
    best,
    runnerUp,
    sourcesReached: retrieval.sourcesReached,
    sourcesQueried: retrieval.sourcesQueried.length,
    isRetracted,
    doiTitleMismatch: doiMismatch,
    hasParseableTitle,
    apiErrors: retrieval.errors,
  });

  const alternativeCandidates = allScored
    .slice(1, 3)
    .map(scoredToBestMatch);

  return {
    input,
    parsed,
    classification,
    bestMatch: best ? scoredToBestMatch(best) : undefined,
    alternativeCandidates,
    sourcesQueried: retrieval.sourcesQueried,
    sourcesReached: retrieval.sourcesReached,
    isRetracted,
    retractionDate,
    issues,
  };
}

const BATCH_SIZE = 4;
const BATCH_DELAY_MS = 200;

/**
 * Validate multiple references; returns three lists
 */
export async function validateReferencesByMetadata(
  references: ReferenceMetadataInput[]
): Promise<ReferenceMetadataValidationResult> {
  const all: ReferenceMetadataResult[] = [];

  for (let i = 0; i < references.length; i += BATCH_SIZE) {
    const batch = references.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map((ref) => validateReferenceByMetadata(ref))
    );
    all.push(...batchResults);

    if (i + BATCH_SIZE < references.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  const validated = all.filter((r) => r.classification === "validated");
  const fake = all.filter((r) => r.classification === "fake");
  const unsure = all.filter((r) => r.classification === "unsure");

  return {
    validated,
    fake,
    unsure,
    summary: {
      total: all.length,
      validated: validated.length,
      fake: fake.length,
      unsure: unsure.length,
    },
    disclaimer:
      "These results are automated screening based on title/author/year matching across OpenAlex, Crossref, and PubMed. DOI is used only for optional corroboration and retraction checks, not as the primary validation gate. Preprints, books, and non-indexed works may appear as unsure. All findings require editorial review.",
  };
}

/**
 * Parse reference text block into metadata inputs (reuses DOI/PMID extraction)
 */
export function parseReferencesForMetadata(text: string): ReferenceMetadataInput[] {
  const legacy: LegacyReferenceInput[] = parseReferences(text);
  return legacy.map((ref) => {
    const parsed = parseReferenceFields(ref.raw);
    return {
      raw: ref.raw,
      doi: ref.doi,
      pmid: ref.pmid,
      ...parsed,
    };
  });
}

export { parseReferences };
