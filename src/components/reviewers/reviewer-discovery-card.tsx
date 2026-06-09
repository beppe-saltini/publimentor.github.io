"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Building,
  Mail,
  FileText,
  BookOpen,
  Award,
  Globe,
  Sparkles,
  ThumbsUp,
  ThumbsDown,
  Check,
} from "lucide-react";
import { COIBadge, getCardBorderClass } from "./coi-badge";
import { COIDetails } from "./coi-details";
import type { ReviewerDisplay } from "./reviewer-display";

interface ReviewerDiscoveryCardProps {
  reviewer: ReviewerDisplay;
  index: number;
  manuscriptExpertise: string[];
  assignedExpertise: Record<string, string[]>;
  flaggedReviewers: Record<string, "up" | "down" | null>;
  onToggleExpertise: (reviewerId: string, expertise: string) => void;
  onToggleFlag: (reviewerId: string, direction: "up" | "down") => void;
}

export function ReviewerDiscoveryCard({
  reviewer,
  index,
  manuscriptExpertise,
  assignedExpertise,
  flaggedReviewers,
  onToggleExpertise,
  onToggleFlag,
}: ReviewerDiscoveryCardProps) {
  const affiliation = reviewer.affiliation || "";
  const sources = reviewer.sources || [];

  return (
    <Card
      className={`hover:shadow-md transition-shadow ${
        reviewer.coiSummary?.hasConflict
          ? getCardBorderClass(reviewer.coiSummary.worstSeverity, true)
          : ""
      }`}
    >
      <CardContent className="pt-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-start gap-3">
            <div className="bg-blue-100 rounded-full p-2 flex-shrink-0">
              <span className="text-sm font-bold text-blue-700">{index + 1}</span>
            </div>
            <div>
              <h4 className="font-semibold">{reviewer.name}</h4>
              {affiliation && (
                <p className="text-sm text-gray-500 flex items-center gap-1">
                  <Building className="h-3 w-3" />
                  {affiliation.slice(0, 60)}
                  {affiliation.length > 60 ? "..." : ""}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            {reviewer.llmAnalysis ? (
              <Badge
                variant="outline"
                className={`text-xs ${
                  reviewer.llmAnalysis.recommendation === "highly_recommended"
                    ? "bg-green-100 text-green-800 border-green-300"
                    : reviewer.llmAnalysis.recommendation === "recommended"
                      ? "bg-blue-100 text-blue-800 border-blue-300"
                      : "bg-amber-100 text-amber-800 border-amber-300"
                }`}
              >
                {reviewer.llmAnalysis.relevanceScore}% match
              </Badge>
            ) : sources.length > 0 ? (
              <Badge variant="outline" className="bg-blue-50 text-blue-700 text-xs">
                {sources[0]}
              </Badge>
            ) : null}
            {reviewer.isNewThisRun && (
              <Badge variant="outline" className="bg-sky-50 text-sky-700 border-sky-200 text-xs">
                New
              </Badge>
            )}
            <COIBadge
              severity={reviewer.coiSummary?.worstSeverity || null}
              conflictCount={reviewer.coiSummary?.conflictCount || 0}
              size="sm"
            />
            <div className="flex gap-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFlag(reviewer.id, "up");
                }}
                className={`p-1 rounded transition-colors ${
                  flaggedReviewers[reviewer.id] === "up"
                    ? "bg-green-100 text-green-700"
                    : "text-gray-300 hover:text-green-500 hover:bg-green-50"
                }`}
                title="Approve reviewer"
              >
                <ThumbsUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFlag(reviewer.id, "down");
                }}
                className={`p-1 rounded transition-colors ${
                  flaggedReviewers[reviewer.id] === "down"
                    ? "bg-red-100 text-red-700"
                    : "text-gray-300 hover:text-red-500 hover:bg-red-50"
                }`}
                title="Reject reviewer"
              >
                <ThumbsDown className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {reviewer.llmAnalysis && (
          <div className="mb-3 p-2 bg-purple-50 rounded-lg border border-purple-200">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="h-3 w-3 text-purple-600" />
              <span className="text-xs font-medium text-purple-800">AI Suggested</span>
              <Badge
                variant="outline"
                className={`text-xs ${
                  reviewer.llmAnalysis.topicalMatch === "excellent"
                    ? "bg-green-100 text-green-700"
                    : reviewer.llmAnalysis.topicalMatch === "good"
                      ? "bg-blue-100 text-blue-700"
                      : "bg-amber-100 text-amber-700"
                }`}
              >
                {reviewer.llmAnalysis.topicalMatch} match
              </Badge>
            </div>
            <p className="text-xs text-purple-700 mb-2">{reviewer.llmAnalysis.reasoning}</p>
            {reviewer.llmAnalysis.expertise && reviewer.llmAnalysis.expertise.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {reviewer.llmAnalysis.expertise.map((exp, i) => (
                  <Badge
                    key={i}
                    variant="secondary"
                    className="text-xs bg-purple-100 text-purple-700"
                  >
                    {exp}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}

        {manuscriptExpertise.length > 0 && (
          <div className="mb-3 p-2 bg-blue-50/50 rounded-lg border border-blue-200">
            <p className="text-xs font-medium text-blue-800 mb-1.5">Covers expertise:</p>
            <div className="flex flex-wrap gap-1.5">
              {manuscriptExpertise.map((exp) => {
                const isChecked = (assignedExpertise[reviewer.id] || []).includes(exp);
                return (
                  <button
                    key={exp}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleExpertise(reviewer.id, exp);
                    }}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors ${
                      isChecked
                        ? "bg-green-100 text-green-800 border-green-300"
                        : "bg-white text-gray-500 border-gray-300 hover:border-blue-400 hover:text-blue-700"
                    }`}
                  >
                    <div
                      className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 ${
                        isChecked ? "bg-green-600 border-green-600" : "border-gray-400"
                      }`}
                    >
                      {isChecked && <Check className="h-2.5 w-2.5 text-white" />}
                    </div>
                    {exp}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-5 gap-2 text-center text-xs mb-3">
          <div
            className="bg-amber-50 rounded p-2 border border-amber-200"
            title="H-Index from Semantic Scholar/OpenAlex"
          >
            <p className="font-bold text-lg text-amber-700">
              {reviewer.hIndex != null ? reviewer.hIndex : "—"}
            </p>
            <p className="text-gray-500">H-Index</p>
          </div>
          <div className="bg-gray-50 rounded p-2">
            <p className="font-bold text-lg">{reviewer.publicationCount ?? "—"}</p>
            <p className="text-gray-500">Pubs</p>
          </div>
          <div className="bg-blue-50 rounded p-2" title="First author papers">
            <p className="font-bold text-blue-700">{reviewer.firstAuthorCount ?? 0}</p>
            <p className="text-gray-500">1st Auth</p>
          </div>
          <div className="bg-purple-50 rounded p-2" title="Last/PI author papers">
            <p className="font-bold text-purple-700">{reviewer.lastAuthorCount ?? 0}</p>
            <p className="text-gray-500">Last/PI</p>
          </div>
          <div className="bg-green-50 rounded p-2" title="Total senior author papers">
            <p className="font-bold text-green-700">{reviewer.seniorAuthorCount ?? 0}</p>
            <p className="text-gray-500">Senior</p>
          </div>
        </div>

        {sources.length > 0 && (
          <div className="flex gap-1 mb-2 flex-wrap">
            {sources.map((source, i) => (
              <Badge key={i} variant="outline" className="text-xs">
                {source}
              </Badge>
            ))}
          </div>
        )}

        {reviewer.recentArticles && reviewer.recentArticles.length > 0 && (
          <div className="mb-3">
            <p className="text-xs text-gray-500 mb-1">Recent Articles</p>
            <div className="space-y-1">
              {reviewer.recentArticles.slice(0, 2).map((article, i) => (
                <div key={i} className="text-xs bg-gray-50 rounded p-2">
                  <div className="flex items-center gap-1 mb-0.5">
                    <Badge
                      variant="outline"
                      className={`text-xs ${
                        article.position === "first"
                          ? "bg-blue-50 text-blue-700"
                          : article.position === "last"
                            ? "bg-purple-50 text-purple-700"
                            : "bg-gray-100"
                      }`}
                    >
                      {article.position === "first"
                        ? "1st"
                        : article.position === "last"
                          ? "Last"
                          : "Mid"}
                    </Badge>
                    <span className="text-gray-400">{article.journal}</span>
                  </div>
                  <a
                    href={`https://pubmed.ncbi.nlm.nih.gov/${article.pmid}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline line-clamp-1"
                  >
                    {article.title}
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}

        {reviewer.coiSummary && reviewer.coiSummary.conflicts.length > 0 && (
          <COIDetails
            conflicts={reviewer.coiSummary.conflicts}
            worstSeverity={reviewer.coiSummary.worstSeverity}
            className="mb-3"
          />
        )}

        <Separator className="my-3" />

        <div className="flex flex-col gap-1 text-sm">
          <div className="flex items-center gap-2">
            <Mail className="h-3.5 w-3.5 text-gray-400 shrink-0" />
            {reviewer.email ? (
              <a
                href={`mailto:${reviewer.email}`}
                className="text-blue-600 hover:underline truncate"
              >
                {reviewer.email}
              </a>
            ) : (
              <span className="text-gray-400 italic">No public email</span>
            )}
          </div>
          {reviewer.verificationUrls?.institutionProfileUrl ? (
            <div className="flex items-center gap-2">
              <Building className="h-3.5 w-3.5 text-green-500 shrink-0" />
              <a
                href={reviewer.verificationUrls.institutionProfileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline truncate"
              >
                Institution Profile
              </a>
            </div>
          ) : reviewer.verificationUrls?.institutionSearchUrl ? (
            <div className="flex items-center gap-2">
              <Building className="h-3.5 w-3.5 text-gray-400 shrink-0" />
              <a
                href={reviewer.verificationUrls.institutionSearchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline truncate"
              >
                Search at institution
              </a>
            </div>
          ) : null}
        </div>

        {reviewer.verificationUrls && (
          <>
            <Separator className="my-2" />
            <div className="flex flex-wrap gap-2">
              {reviewer.verificationUrls.pubmedSearchUrl && (
                <Button variant="outline" size="sm" asChild>
                  <a
                    href={reviewer.verificationUrls.pubmedSearchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <FileText className="h-3 w-3 mr-1" />
                    PubMed
                  </a>
                </Button>
              )}
              {reviewer.verificationUrls.semanticScholarUrl && (
                <Button variant="outline" size="sm" asChild>
                  <a
                    href={reviewer.verificationUrls.semanticScholarUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Award className="h-3 w-3 mr-1" />
                    S2
                  </a>
                </Button>
              )}
              {reviewer.verificationUrls.openAlexUrl && (
                <Button variant="outline" size="sm" asChild>
                  <a
                    href={reviewer.verificationUrls.openAlexUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Globe className="h-3 w-3 mr-1" />
                    OpenAlex
                  </a>
                </Button>
              )}
              {reviewer.verificationUrls.googleScholarUrl && (
                <Button variant="outline" size="sm" asChild>
                  <a
                    href={reviewer.verificationUrls.googleScholarUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <BookOpen className="h-3 w-3 mr-1" />
                    Scholar
                  </a>
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
