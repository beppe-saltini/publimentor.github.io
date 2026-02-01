"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { 
  ChevronDown, 
  ChevronUp, 
  FileText, 
  Building, 
  Clock,
  User,
  AlertTriangle 
} from "lucide-react";
import { cn } from "@/lib/utils";
import { COIBadge, type ConflictSeverity } from "./coi-badge";

export interface ReviewerConflict {
  authorName: string;
  authorRole: string;
  type: "coauthorship" | "affiliation";
  baseSeverity: ConflictSeverity;
  adjustedSeverity: ConflictSeverity;
  yearsSince?: number;
  details: {
    title?: string;
    year?: number;
    institutionName?: string;
    affiliationType?: "current_both" | "current_one" | "historical";
  };
}

interface COIDetailsProps {
  conflicts: ReviewerConflict[];
  worstSeverity: ConflictSeverity | null;
  className?: string;
  defaultExpanded?: boolean;
}

const roleLabels: Record<string, string> = {
  first: "First Author",
  last: "Last/PI Author",
  corresponding: "Corresponding",
  middle_early: "2nd-3rd Author",
  middle_late: "Co-Author",
  unknown: "Author",
};

const affiliationTypeLabels: Record<string, string> = {
  current_both: "Both currently at",
  current_one: "Recent overlap at",
  historical: "Historical overlap at",
};

export function COIDetails({ 
  conflicts, 
  worstSeverity,
  className,
  defaultExpanded = false 
}: COIDetailsProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (conflicts.length === 0) {
    return null;
  }

  // Group conflicts by type
  const coauthorshipConflicts = conflicts.filter(c => c.type === "coauthorship");
  const affiliationConflicts = conflicts.filter(c => c.type === "affiliation");

  return (
    <div className={cn("space-y-2", className)}>
      {/* Expandable header */}
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          "w-full justify-between h-auto py-2 px-3",
          worstSeverity === "critical" && "bg-red-50 hover:bg-red-100 text-red-800",
          worstSeverity === "high" && "bg-orange-50 hover:bg-orange-100 text-orange-800",
          worstSeverity === "medium" && "bg-amber-50 hover:bg-amber-100 text-amber-800",
          worstSeverity === "low" && "bg-blue-50 hover:bg-blue-100 text-blue-800",
          worstSeverity === "minimal" && "bg-gray-50 hover:bg-gray-100 text-gray-700"
        )}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          <span className="font-medium">
            {conflicts.length} Potential Conflict{conflicts.length > 1 ? "s" : ""} Found
          </span>
        </span>
        {expanded ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </Button>

      {/* Expanded details */}
      {expanded && (
        <div className="space-y-3 pt-1">
          {/* Coauthorship conflicts */}
          {coauthorshipConflicts.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <FileText className="h-3 w-3" />
                <span className="font-medium uppercase tracking-wide">
                  Co-authored Publications ({coauthorshipConflicts.length})
                </span>
              </div>
              <div className="space-y-2">
                {coauthorshipConflicts.map((conflict, index) => (
                  <div 
                    key={`coauth-${index}`}
                    className="bg-white rounded-lg border p-3 text-sm"
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <User className="h-3.5 w-3.5 text-gray-400" />
                        <span className="font-medium">{conflict.authorName}</span>
                        <Badge variant="secondary" className="text-xs">
                          {roleLabels[conflict.authorRole] || conflict.authorRole}
                        </Badge>
                      </div>
                      <COIBadge 
                        severity={conflict.adjustedSeverity} 
                        showCount={false}
                        size="sm"
                      />
                    </div>
                    
                    {conflict.details.title && (
                      <p className="text-gray-600 text-xs line-clamp-2 mb-1">
                        {conflict.details.title}
                      </p>
                    )}
                    
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      {conflict.details.year && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {conflict.details.year}
                        </span>
                      )}
                      {conflict.yearsSince !== undefined && (
                        <span className={cn(
                          "px-1.5 py-0.5 rounded text-xs",
                          conflict.yearsSince <= 2 && "bg-red-100 text-red-700",
                          conflict.yearsSince > 2 && conflict.yearsSince <= 5 && "bg-orange-100 text-orange-700",
                          conflict.yearsSince > 5 && conflict.yearsSince <= 10 && "bg-amber-100 text-amber-700",
                          conflict.yearsSince > 10 && "bg-gray-100 text-gray-600"
                        )}>
                          {conflict.yearsSince} year{conflict.yearsSince !== 1 ? "s" : ""} ago
                        </span>
                      )}
                      {conflict.baseSeverity !== conflict.adjustedSeverity && (
                        <span className="text-gray-400 italic">
                          (reduced from {conflict.baseSeverity})
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {coauthorshipConflicts.length > 0 && affiliationConflicts.length > 0 && (
            <Separator />
          )}

          {/* Affiliation conflicts */}
          {affiliationConflicts.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <Building className="h-3 w-3" />
                <span className="font-medium uppercase tracking-wide">
                  Shared Affiliations ({affiliationConflicts.length})
                </span>
              </div>
              <div className="space-y-2">
                {affiliationConflicts.map((conflict, index) => (
                  <div 
                    key={`affil-${index}`}
                    className="bg-white rounded-lg border p-3 text-sm"
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <User className="h-3.5 w-3.5 text-gray-400" />
                        <span className="font-medium">{conflict.authorName}</span>
                        <Badge variant="secondary" className="text-xs">
                          {roleLabels[conflict.authorRole] || conflict.authorRole}
                        </Badge>
                      </div>
                      <COIBadge 
                        severity={conflict.adjustedSeverity} 
                        showCount={false}
                        size="sm"
                      />
                    </div>
                    
                    {conflict.details.institutionName && (
                      <div className="flex items-center gap-2 text-xs text-gray-600">
                        <Building className="h-3 w-3" />
                        <span>
                          {conflict.details.affiliationType && 
                            affiliationTypeLabels[conflict.details.affiliationType]
                          }
                          {" "}
                          <span className="font-medium">{conflict.details.institutionName}</span>
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Disclaimer */}
          <p className="text-xs text-gray-400 italic pt-1">
            Automated screening — verify before editorial decisions
          </p>
        </div>
      )}
    </div>
  );
}
