import type { ConflictSeverity } from "./coi-badge";
import type { ReviewerConflict } from "./coi-details";

export interface ReviewerDisplay {
  id: string;
  name: string;
  affiliation?: string;
  country?: string;
  email?: string | null;
  hIndex?: number | null;
  citationCount?: number | null;
  publicationCount?: number;
  firstAuthorCount?: number;
  lastAuthorCount?: number;
  seniorAuthorCount?: number;
  sources?: string[];
  recentArticles?: {
    title: string;
    journal: string;
    year: string;
    pmid: string;
    position: "first" | "last" | "middle";
  }[];
  verificationUrls?: {
    pubmedSearchUrl?: string;
    googleScholarUrl?: string;
    semanticScholarUrl?: string;
    openAlexUrl?: string;
    institutionSearchUrl?: string;
    institutionProfileUrl?: string;
  };
  llmAnalysis?: {
    relevanceScore: number;
    reasoning: string;
    topicalMatch: string;
    recommendation?: string;
    expertise?: string[];
  };
  coiSummary?: {
    hasConflict: boolean;
    worstSeverity: ConflictSeverity | null;
    conflictCount: number;
    conflicts: ReviewerConflict[];
  };
}

export function flagsFromReviewerStatuses(
  reviewers: Array<{ id: string; status?: string }>
): Record<string, "up" | "down" | null> {
  const flags: Record<string, "up" | "down" | null> = {};
  for (const r of reviewers) {
    if (r.status === "SHORTLISTED") flags[r.id] = "up";
    else if (r.status === "REJECTED") flags[r.id] = "down";
  }
  return flags;
}
