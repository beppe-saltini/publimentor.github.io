"use client";

import { Loader2, Users } from "lucide-react";
import { ExpertiseCoveragePanel } from "./expertise-coverage-panel";
import type { ExpertiseCoverageInfo } from "./expertise-coverage-panel";
import { ReviewerDiscoveryCard } from "./reviewer-discovery-card";
import type { ReviewerDisplay } from "./reviewer-display";

interface ReviewerResultsListProps {
  reviewers: ReviewerDisplay[];
  manuscriptExpertise: string[];
  expertiseCoverage: Record<string, ExpertiseCoverageInfo>;
  coveredExpertise: string[];
  uncoveredExpertise: string[];
  assignedExpertise: Record<string, string[]>;
  flaggedReviewers: Record<string, "up" | "down" | null>;
  onToggleExpertise: (reviewerId: string, expertise: string) => void;
  onToggleFlag: (reviewerId: string, direction: "up" | "down") => void;
  isLoading?: boolean;
  maxDisplay?: number;
  emptyMessage?: string;
}

export function ReviewerResultsList({
  reviewers,
  manuscriptExpertise,
  expertiseCoverage,
  coveredExpertise,
  uncoveredExpertise,
  assignedExpertise,
  flaggedReviewers,
  onToggleExpertise,
  onToggleFlag,
  isLoading = false,
  maxDisplay,
  emptyMessage = "No reviewers found yet. Use Find Reviewers to discover suitable experts.",
}: ReviewerResultsListProps) {
  if (isLoading) {
    return (
      <div className="text-center py-8">
        <Loader2 className="h-6 w-6 mx-auto animate-spin text-gray-400" />
        <p className="text-sm text-gray-500 mt-2">Loading reviewers...</p>
      </div>
    );
  }

  if (reviewers.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <Users className="h-10 w-10 mx-auto mb-3 text-gray-300" />
        <p className="text-sm">{emptyMessage}</p>
      </div>
    );
  }

  const displayed = maxDisplay ? reviewers.slice(0, maxDisplay) : reviewers;

  return (
    <div className="space-y-4">
      {reviewers.length > 0 && manuscriptExpertise.length > 0 && (
        <ExpertiseCoveragePanel
          manuscriptExpertise={manuscriptExpertise}
          expertiseCoverage={expertiseCoverage}
          coveredExpertise={coveredExpertise}
          uncoveredExpertise={uncoveredExpertise}
        />
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {displayed.map((reviewer, index) => (
          <ReviewerDiscoveryCard
            key={reviewer.id}
            reviewer={reviewer}
            index={index}
            manuscriptExpertise={manuscriptExpertise}
            assignedExpertise={assignedExpertise}
            flaggedReviewers={flaggedReviewers}
            onToggleExpertise={onToggleExpertise}
            onToggleFlag={onToggleFlag}
          />
        ))}
      </div>

      {maxDisplay && reviewers.length > maxDisplay && (
        <p className="text-xs text-center text-gray-400">
          Showing {maxDisplay} of {reviewers.length} reviewers. Open the Reviewers tab for
          the full list.
        </p>
      )}
    </div>
  );
}
