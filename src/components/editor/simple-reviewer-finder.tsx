"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  User,
  Building,
  Loader2,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { COIBadge, getCardBorderClass, type ReviewerConflict, type ConflictSeverity } from "@/components/reviewers";
import type { ManuscriptReadyData } from "./manuscript-input-panel";

interface ReviewerCandidate {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  affiliation?: string;
  source: "pubmed" | "openalex" | "both";
  worksCount?: number;
  citedByCount?: number;
  hIndex?: number;
  coiSummary?: {
    hasConflict: boolean;
    worstSeverity: ConflictSeverity | null;
    conflictCount: number;
    conflicts: ReviewerConflict[];
  };
}

interface CoauthorWarning {
  name: string;
  coauthorCount: number;
}

interface SimpleReviewerFinderProps {
  manuscriptData: ManuscriptReadyData | null;
}

export function SimpleReviewerFinder({ manuscriptData }: SimpleReviewerFinderProps) {
  const router = useRouter();
  const [keywords, setKeywords] = useState("");
  const [authorList, setAuthorList] = useState("");
  const [isFinding, setIsFinding] = useState(false);
  const [candidates, setCandidates] = useState<ReviewerCandidate[]>([]);
  const [coauthorWarnings, setCoauthorWarnings] = useState<CoauthorWarning[]>([]);

  const manuscriptId = manuscriptData?.manuscriptId;

  useEffect(() => {
    if (!manuscriptData) return;
    if (manuscriptData.keywords.length > 0) {
      setKeywords(manuscriptData.keywords.join(", "));
    }
    if (manuscriptData.authors.length > 0) {
      setAuthorList(manuscriptData.authors.map((a) => a.name).join(", "));
    }
  }, [manuscriptData]);

  const handleFindReviewers = async () => {
    if (!keywords.trim()) {
      toast.error("Please enter keywords to search for reviewers");
      return;
    }

    setIsFinding(true);
    setCandidates([]);
    setCoauthorWarnings([]);

    try {
      const response = await fetch("/api/reviewers/find", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authorList: authorList.trim() || undefined,
          keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean),
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to find reviewers");
      }

      setCandidates(data.reviewers || []);
      setCoauthorWarnings(data.coauthors || []);

      if (manuscriptId && data.reviewers?.length > 0) {
        try {
          const mapped = data.reviewers.map((r: ReviewerCandidate) => ({
            name: r.name,
            firstName: r.firstName,
            lastName: r.lastName,
            affiliation: r.affiliation,
            hIndex: r.hIndex,
            citationCount: r.citedByCount,
            publicationCount: r.worksCount,
            sources: r.source ? [r.source] : undefined,
            coiSummary: r.coiSummary,
          }));
          const saveRes = await fetch(`/api/manuscripts/${manuscriptId}/reviewers`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reviewers: mapped }),
          });
          const saveData = await saveRes.json();
          if (saveRes.ok) {
            toast.success(
              `Found ${data.reviewers.length} reviewers — ${saveData.saved} saved`
            );
          } else {
            toast.success(`Found ${data.reviewers.length} potential reviewers`);
          }
        } catch {
          toast.success(`Found ${data.reviewers.length} potential reviewers`);
        }
      } else {
        toast.success(`Found ${data.reviewers?.length || 0} potential reviewers`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Search failed");
    } finally {
      setIsFinding(false);
    }
  };

  const getSourceBadge = (source: string) => {
    if (source === "both") {
      return (
        <Badge variant="outline" className="text-xs bg-green-50 border-green-300">
          PubMed + OpenAlex
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-xs">
        {source === "pubmed" ? "PubMed" : "OpenAlex"}
      </Badge>
    );
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Find reviewers
          </CardTitle>
          <CardDescription>
            Search PubMed and OpenAlex for experts matching your research keywords.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="simple-keywords">Research keywords (comma-separated)</Label>
            <Input
              id="simple-keywords"
              placeholder="e.g., machine learning, neural networks"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleFindReviewers()}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="simple-authors">Manuscript authors (optional — to exclude)</Label>
            <Textarea
              id="simple-authors"
              placeholder="e.g., John Smith, Jane Doe"
              value={authorList}
              onChange={(e) => setAuthorList(e.target.value)}
              rows={2}
              className="font-mono text-sm"
            />
          </div>

          {candidates.length > 0 && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const names = candidates.map((r) => r.name).join("\n");
                sessionStorage.setItem("coi_reviewers_import", names);
                if (manuscriptData?.authors.length) {
                  sessionStorage.setItem(
                    "coi_authors_import",
                    manuscriptData.authors.map((a) => a.name).join("\n")
                  );
                }
                if (manuscriptId) {
                  sessionStorage.setItem("coi_manuscript_id", manuscriptId);
                }
                router.push("/dashboard/editor/coi");
              }}
            >
              <AlertTriangle className="h-4 w-4 mr-2" />
              Check COI for these reviewers
            </Button>
          )}

          <Button
            onClick={handleFindReviewers}
            disabled={isFinding || !keywords.trim()}
            size="lg"
          >
            {isFinding ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Search className="h-4 w-4 mr-2" />
            )}
            Find reviewers
          </Button>
        </CardContent>
      </Card>

      <Card className="bg-amber-50 border-amber-200">
        <CardContent className="py-3">
          <div className="flex items-start gap-2 text-sm text-amber-800">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <p>
              Automated suggestions for editorial consideration only. Verify independence
              and suitability before inviting reviewers.
            </p>
          </div>
        </CardContent>
      </Card>

      {coauthorWarnings.length > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-amber-800">
              <AlertTriangle className="h-4 w-4" />
              Potential overlap — verify independence
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {coauthorWarnings.slice(0, 15).map((w, i) => (
                <Badge key={i} variant="outline" className="border-amber-400 text-amber-800 text-xs">
                  {w.name} ({w.coauthorCount} shared)
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {candidates.length > 0 && (
        <>
          <div>
            <h3 className="text-lg font-semibold">{candidates.length} reviewer suggestions</h3>
            <p className="text-sm text-gray-500">
              For editorial consideration — verify suitability before invitation
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {candidates.map((reviewer) => (
              <Card
                key={reviewer.id}
                className={
                  reviewer.coiSummary?.hasConflict
                    ? getCardBorderClass(reviewer.coiSummary.worstSeverity, true)
                    : ""
                }
              >
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-start gap-2">
                      <div className="bg-gray-100 rounded-full p-2">
                        <User className="h-4 w-4 text-gray-600" />
                      </div>
                      <div>
                        <h4 className="font-semibold text-sm">{reviewer.name}</h4>
                        {reviewer.affiliation && (
                          <p className="text-xs text-gray-500 flex items-center gap-1">
                            <Building className="h-3 w-3" />
                            {reviewer.affiliation}
                          </p>
                        )}
                      </div>
                    </div>
                    {reviewer.coiSummary && (
                      <COIBadge
                        severity={reviewer.coiSummary.worstSeverity}
                        conflictCount={reviewer.coiSummary.conflictCount}
                        size="sm"
                      />
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {getSourceBadge(reviewer.source)}
                    {reviewer.hIndex != null && (
                      <Badge variant="secondary" className="text-xs">
                        h-index: {reviewer.hIndex}
                      </Badge>
                    )}
                  </div>
                  {(reviewer.worksCount || reviewer.citedByCount) && (
                    <div className="grid grid-cols-2 gap-2 text-center text-xs">
                      {reviewer.worksCount != null && (
                        <div className="bg-gray-50 rounded p-2">
                          <p className="font-semibold">{reviewer.worksCount}</p>
                          <p className="text-gray-500">Publications</p>
                        </div>
                      )}
                      {reviewer.citedByCount != null && (
                        <div className="bg-gray-50 rounded p-2">
                          <p className="font-semibold">
                            {reviewer.citedByCount.toLocaleString()}
                          </p>
                          <p className="text-gray-500">Citations</p>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
