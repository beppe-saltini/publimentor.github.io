"use client";

import { Badge } from "@/components/ui/badge";
import { AlertTriangle, AlertCircle, Info, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type ConflictSeverity = "critical" | "high" | "medium" | "low" | "minimal";

interface COIBadgeProps {
  severity: ConflictSeverity | null;
  conflictCount?: number;
  showCount?: boolean;
  size?: "sm" | "md";
  className?: string;
}

const severityConfig: Record<ConflictSeverity, {
  label: string;
  shortLabel: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
  icon: React.ElementType;
}> = {
  critical: {
    label: "Critical COI",
    shortLabel: "Critical",
    bgClass: "bg-red-100",
    textClass: "text-red-800",
    borderClass: "border-red-300",
    icon: AlertCircle,
  },
  high: {
    label: "High COI",
    shortLabel: "High",
    bgClass: "bg-orange-100",
    textClass: "text-orange-800",
    borderClass: "border-orange-300",
    icon: AlertTriangle,
  },
  medium: {
    label: "Medium COI",
    shortLabel: "Medium",
    bgClass: "bg-amber-100",
    textClass: "text-amber-800",
    borderClass: "border-amber-300",
    icon: AlertTriangle,
  },
  low: {
    label: "Low COI",
    shortLabel: "Low",
    bgClass: "bg-blue-100",
    textClass: "text-blue-800",
    borderClass: "border-blue-200",
    icon: Info,
  },
  minimal: {
    label: "Minimal COI",
    shortLabel: "Minimal",
    bgClass: "bg-gray-100",
    textClass: "text-gray-600",
    borderClass: "border-gray-200",
    icon: Info,
  },
};

export function COIBadge({ 
  severity, 
  conflictCount = 0, 
  showCount = true,
  size = "md",
  className 
}: COIBadgeProps) {
  // No conflicts - show clear badge
  if (!severity || conflictCount === 0) {
    return (
      <Badge 
        variant="outline" 
        className={cn(
          "bg-green-50 text-green-700 border-green-200",
          size === "sm" && "text-xs py-0 px-1.5",
          className
        )}
      >
        <CheckCircle className={cn("mr-1", size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5")} />
        Clear
      </Badge>
    );
  }

  const config = severityConfig[severity];
  const Icon = config.icon;

  return (
    <Badge 
      variant="outline" 
      className={cn(
        config.bgClass,
        config.textClass,
        config.borderClass,
        size === "sm" && "text-xs py-0 px-1.5",
        className
      )}
    >
      <Icon className={cn("mr-1", size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5")} />
      {size === "sm" ? config.shortLabel : config.label}
      {showCount && conflictCount > 1 && (
        <span className="ml-1 opacity-75">({conflictCount})</span>
      )}
    </Badge>
  );
}

// Get border class for card styling based on severity
export function getCardBorderClass(severity: ConflictSeverity | null, hasConflict: boolean): string {
  if (!hasConflict || !severity) return "";
  
  switch (severity) {
    case "critical":
      return "border-red-300 border-2";
    case "high":
      return "border-orange-300 border-2";
    case "medium":
      return "border-amber-200";
    case "low":
      return "border-blue-200";
    case "minimal":
      return "border-gray-200";
    default:
      return "";
  }
}
