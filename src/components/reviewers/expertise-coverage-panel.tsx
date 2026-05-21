"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GraduationCap, Check, AlertTriangle } from "lucide-react";

export interface ExpertiseCoverageInfo {
  reviewerIds: string[];
  reviewerNames: string[];
}

interface ExpertiseCoveragePanelProps {
  manuscriptExpertise: string[];
  expertiseCoverage: Record<string, ExpertiseCoverageInfo>;
  coveredExpertise: string[];
  uncoveredExpertise: string[];
}

export function ExpertiseCoveragePanel({
  manuscriptExpertise,
  expertiseCoverage,
  coveredExpertise,
  uncoveredExpertise,
}: ExpertiseCoveragePanelProps) {
  if (manuscriptExpertise.length === 0) return null;

  return (
    <Card className="border-blue-200 bg-blue-50/30">
      <CardContent className="py-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <GraduationCap className="h-4 w-4 text-blue-600" />
            Expertise Coverage
            <Badge
              variant="outline"
              className={`text-xs ${
                coveredExpertise.length === manuscriptExpertise.length
                  ? "bg-green-100 text-green-700"
                  : coveredExpertise.length > 0
                    ? "bg-amber-100 text-amber-700"
                    : "bg-red-100 text-red-700"
              }`}
            >
              {coveredExpertise.length}/{manuscriptExpertise.length} covered
            </Badge>
          </h4>
        </div>
        <div className="flex flex-wrap gap-2">
          {manuscriptExpertise.map((exp) => {
            const info = expertiseCoverage[exp];
            const isCovered = info && info.reviewerNames.length > 0;
            return (
              <div key={exp} className="group relative">
                <Badge
                  variant="outline"
                  className={`text-xs cursor-default ${
                    isCovered
                      ? "bg-green-100 text-green-700 border-green-300"
                      : "bg-amber-50 text-amber-700 border-amber-300"
                  }`}
                >
                  {isCovered ? (
                    <Check className="h-3 w-3 mr-1" />
                  ) : (
                    <AlertTriangle className="h-3 w-3 mr-1" />
                  )}
                  {exp}
                  {isCovered && (
                    <span className="ml-1 text-green-600">
                      ({info.reviewerNames.length})
                    </span>
                  )}
                </Badge>
                {isCovered && (
                  <div className="absolute z-10 hidden group-hover:block bottom-full mb-1 left-0 bg-white border rounded shadow-lg p-2 text-xs min-w-[140px]">
                    <p className="font-medium text-gray-700 mb-1">Covered by:</p>
                    {info.reviewerNames.map((name, i) => (
                      <p key={i} className="text-gray-600">
                        {name}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {uncoveredExpertise.length > 0 && (
          <p className="text-xs text-amber-600 mt-2">
            {uncoveredExpertise.length === manuscriptExpertise.length
              ? "Assign expertise to reviewers using the checkboxes on each card below."
              : `Still need coverage: ${uncoveredExpertise.join(", ")}`}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
