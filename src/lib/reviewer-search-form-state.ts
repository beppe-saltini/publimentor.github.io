/**
 * Session persistence for the reviewer finder form (sliders, keywords, results, flags).
 * Keyed by manuscript so navigating to COI and back restores the full UI state.
 */

const STORAGE_PREFIX = "publimentor_reviewer_form:";

export type ReviewerSearchActiveTab = "advanced" | "auto-find";

export interface PersistedReviewerCandidate {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  affiliation?: string;
  source: "pubmed" | "openalex" | "both";
  worksCount?: number;
  citedByCount?: number;
  hIndex?: number;
  orcid?: string;
  coauthorCount?: number;
  topics?: string[];
  coiSummary?: {
    hasConflict: boolean;
    worstSeverity: string | null;
    conflictCount: number;
    conflicts: unknown[];
  };
}

export interface PersistedDiscoveryResult {
  reviewers: unknown[];
  summary: unknown;
  relatedConcepts: { id: string; display_name: string; relevance: number }[];
  disclaimer: string;
  selectionCriteria: Record<string, string | boolean>;
}

export interface ReviewerSearchFormState {
  version: 1;
  manuscriptId: string | null;
  activeTab: ReviewerSearchActiveTab;
  authorList: string;
  keywords: string;
  primaryKeywords: string;
  secondaryKeywords: string;
  keywordOperator: "AND" | "OR";
  minHIndex: number;
  maxHIndex: number;
  minPublications: number;
  maxPublications: number;
  yearsActive: number;
  requireSeniorAuthor: boolean;
  maxResults: number;
  diversifyGeo: boolean;
  avoidSameInstitution: boolean;
  useLLM: boolean;
  candidateReviewers: PersistedReviewerCandidate[];
  coauthorWarnings: { name: string; coauthorCount: number }[];
  discoveryResult: PersistedDiscoveryResult | null;
  flaggedReviewers: Record<string, "up" | "down" | null>;
  assignedExpertise: Record<string, string[]>;
  savedAt: number;
}

export function reviewerFormStorageKey(manuscriptId: string | null): string {
  return `${STORAGE_PREFIX}${manuscriptId ?? "_none"}`;
}

export function loadReviewerSearchFormState(
  manuscriptId: string | null
): ReviewerSearchFormState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(reviewerFormStorageKey(manuscriptId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ReviewerSearchFormState;
    if (parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveReviewerSearchFormState(state: ReviewerSearchFormState): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      reviewerFormStorageKey(state.manuscriptId),
      JSON.stringify(state)
    );
  } catch (err) {
    console.warn("[reviewer-form-state] save failed:", err);
  }
}

export function clearReviewerSearchFormState(manuscriptId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(reviewerFormStorageKey(manuscriptId));
  } catch {
    // ignore
  }
}
