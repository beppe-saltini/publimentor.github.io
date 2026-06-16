"use client";

import { AlertTriangle, ExternalLink } from "lucide-react";
import type { ReputationSummary } from "@/lib/reviewers/reputation-check";

interface ReputationDetailsProps {
  reputation: ReputationSummary;
  className?: string;
}

export function ReputationDetails({ reputation, className = "" }: ReputationDetailsProps) {
  if (!reputation.hasConcerns || reputation.entries.length === 0) return null;

  const linksToShow = reputation.entries;

  return (
    <div
      className={`rounded-md border border-orange-300 bg-orange-50 p-2 text-xs ${className}`}
    >
      <div className="flex items-start gap-1.5 mb-1.5">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-orange-600" />
        <p className="font-medium text-orange-800">
          Integrity screening: high-confidence match (PubPeer / For Better Science)
        </p>
      </div>
      <ul className="space-y-1 ml-5">
        {linksToShow.map((entry, i) => (
          <li key={`${entry.url}-${i}`}>
            <a
              href={entry.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline inline-flex items-center gap-1"
            >
              {entry.label}
              <ExternalLink className="h-3 w-3" />
            </a>
            {entry.detail && (
              <p className="text-gray-500 line-clamp-2 mt-0.5">{entry.detail}</p>
            )}
          </li>
        ))}
      </ul>
      <p className="text-[10px] text-gray-400 mt-1.5 italic">{reputation.disclaimer}</p>
    </div>
  );
}
