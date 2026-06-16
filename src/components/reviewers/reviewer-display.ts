import type { ConflictSeverity } from "./coi-badge";
import type { ReviewerConflict } from "./coi-details";
import type {
  EmailConfidence,
  EmailSource,
} from "@/lib/reviewers/email-enrichment";
import type { ReputationSummary } from "@/lib/reviewers/reputation-check";

export interface ReviewerDisplay {
  id: string;
  name: string;
  affiliation?: string;
  country?: string;
  email?: string | null;
  emailSource?: EmailSource;
  emailConfidence?: EmailConfidence;
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
    emailSource?: EmailSource;
    emailConfidence?: EmailConfidence;
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
  /** True when this reviewer first appeared in the most recent search run */
  isNewThisRun?: boolean;
  /** PubPeer / For Better Science integrity screening */
  reputationSummary?: ReputationSummary;
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
