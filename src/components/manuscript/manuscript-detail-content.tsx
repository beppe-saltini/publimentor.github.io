"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  FileText,
  ArrowLeft,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  Users,
  BookOpen,
  Building,
  Mail,
  ExternalLink,
  Download,
  Search,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import { ReviewerResultsList } from "@/components/reviewers/reviewer-results-list";
import {
  type ReviewerDisplay,
  flagsFromReviewerStatuses,
} from "@/components/reviewers/reviewer-display";
import type { ConflictSeverity } from "@/components/reviewers/coi-badge";
import type { ReviewerConflict } from "@/components/reviewers/coi-details";

interface Author {
  id: string;
  fullName: string;
  email?: string;
  orcid?: string;
  authorOrder: number;
  isCorresponding: boolean;
  affiliationNums: number[];
}

interface Affiliation {
  id: string;
  affiliationNumber: number;
  rawText: string;
  institutionName?: string;
  country?: string;
}

interface Reference {
  id: string;
  refNumber: number;
  rawText: string;
  authors?: string;
  title?: string;
  journal?: string;
  year?: number;
  doi?: string;
}

interface Manuscript {
  id: string;
  title?: string;
  abstract?: string;
  keywords: string[];
  manuscriptType?: string;
  language?: string;
  status: string;
  statusMessage?: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  wordCount?: number;
  pageCount?: number;
  figureCount?: number;
  tableCount?: number;
  referenceCount: number;
  chunkCount: number;
  declarations: {
    funding?: string;
    conflictOfInterest?: string;
    dataAvailability?: string;
    ethics?: string;
    authorContributions?: string;
  };
  publisher: { id: string; name: string; slug: string };
  journal?: { id: string; name: string; slug: string };
  uploader: { id: string; name: string; email: string };
  authors: Author[];
  affiliations: Affiliation[];
  references: Reference[];
  processingStarted?: string;
  processingEnded?: string;
  createdAt: string;
  updatedAt: string;
}

interface PersistedReviewer {
  id: string;
  name: string;
  email?: string | null;
  affiliation?: string;
  country?: string;
  hIndex?: number;
  citationCount?: number;
  publicationCount?: number;
  inferredGender?: string;
  status: "SUGGESTED" | "SHORTLISTED" | "REJECTED";
  verificationUrls?: {
    pubmedSearchUrl?: string;
    googleScholarUrl?: string;
    semanticScholarUrl?: string;
    institutionSearchUrl?: string;
    institutionProfileUrl?: string;
  };
  llmAnalysis?: {
    relevanceScore: number;
    reasoning: string;
    topicalMatch: string;
  };
  coiSummary?: {
    hasConflict: boolean;
    worstSeverity?: string;
    conflictCount: number;
  };
  assignedExpertise?: string[];
  sources?: string[];
  recentArticles?: ReviewerDisplay["recentArticles"];
  firstAuthorCount?: number;
  lastAuthorCount?: number;
  seniorAuthorCount?: number;
}

function mapPersistedToDisplay(r: PersistedReviewer): ReviewerDisplay {
  const coiRaw = r.coiSummary as
    | {
        hasConflict: boolean;
        worstSeverity?: ConflictSeverity | null;
        conflictCount: number;
        conflicts?: ReviewerConflict[];
      }
    | undefined;

  return {
    id: r.id,
    name: r.name,
    affiliation: r.affiliation,
    country: r.country,
    email: r.email ?? null,
    hIndex: r.hIndex ?? null,
    citationCount: r.citationCount ?? null,
    publicationCount: r.publicationCount,
    firstAuthorCount: r.firstAuthorCount ?? 0,
    lastAuthorCount: r.lastAuthorCount ?? 0,
    seniorAuthorCount: r.seniorAuthorCount ?? 0,
    sources: (r.sources as string[]) || [],
    recentArticles: r.recentArticles || [],
    verificationUrls: r.verificationUrls,
    llmAnalysis: r.llmAnalysis
      ? {
          relevanceScore: r.llmAnalysis.relevanceScore,
          reasoning: r.llmAnalysis.reasoning,
          topicalMatch: r.llmAnalysis.topicalMatch,
        }
      : undefined,
    coiSummary: coiRaw
      ? {
          hasConflict: coiRaw.hasConflict,
          worstSeverity: coiRaw.worstSeverity ?? null,
          conflictCount: coiRaw.conflictCount,
          conflicts: coiRaw.conflicts || [],
        }
      : undefined,
  };
}

function sortReviewersForDisplay(
  reviewers: ReviewerDisplay[],
  flagged: Record<string, "up" | "down" | null>
): ReviewerDisplay[] {
  return [...reviewers].sort((a, b) => {
    const rank = (r: ReviewerDisplay) => {
      if (flagged[r.id] === "up") return 0;
      if (flagged[r.id] === "down") return 2;
      return 1;
    };
    return rank(a) - rank(b);
  });
}

export interface ManuscriptDetailRoutes {
  listHref: string;
  reviewersHref: (manuscriptId: string) => string;
  coiHref: string;
  coiReturnUrl: (manuscriptId: string) => string;
}

export interface ManuscriptDetailContentProps {
  manuscriptId: string;
  /** Editor workspace journal; skips fetching default journal when set */
  journalSlug?: string | null;
  routes?: Partial<ManuscriptDetailRoutes>;
  /** Main dashboard uses full container; editor shell uses false */
  showPageContainer?: boolean;
}

function buildRoutes(
  journalSlug: string,
  overrides?: Partial<ManuscriptDetailRoutes>
): ManuscriptDetailRoutes {
  const base: ManuscriptDetailRoutes = {
    listHref: "/dashboard/manuscripts",
    reviewersHref: (id) =>
      `/dashboard/journals/${journalSlug}/reviewers?manuscriptId=${id}`,
    coiHref: `/dashboard/journals/${journalSlug}/coi`,
    coiReturnUrl: (id) => `/dashboard/manuscripts/${id}`,
  };
  return { ...base, ...overrides };
}

export function ManuscriptDetailContent({
  manuscriptId,
  journalSlug: journalSlugProp,
  routes: routesOverride,
  showPageContainer = true,
}: ManuscriptDetailContentProps) {
  const router = useRouter();
  const [manuscript, setManuscript] = useState<Manuscript | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [defaultJournalSlug, setDefaultJournalSlug] = useState<string | null>(null);
  const [reviewers, setReviewers] = useState<PersistedReviewer[]>([]);
  const [reviewerCounts, setReviewerCounts] = useState({ total: 0, shortlisted: 0, suggested: 0 });
  const [isLoadingReviewers, setIsLoadingReviewers] = useState(false);
  const [assignedExpertise, setAssignedExpertise] = useState<Record<string, string[]>>({});

  const effectiveJournalSlug =
    manuscript?.journal?.slug || journalSlugProp || defaultJournalSlug;

  const routes = useMemo((): ManuscriptDetailRoutes | null => {
    if (
      routesOverride?.listHref &&
      routesOverride?.reviewersHref &&
      routesOverride?.coiHref
    ) {
      return {
        listHref: routesOverride.listHref,
        reviewersHref: routesOverride.reviewersHref,
        coiHref: routesOverride.coiHref,
        coiReturnUrl:
          routesOverride.coiReturnUrl ??
          ((id) => `/dashboard/manuscripts/${id}`),
      };
    }
    if (!effectiveJournalSlug) return null;
    return buildRoutes(effectiveJournalSlug, routesOverride);
  }, [effectiveJournalSlug, routesOverride]);

  useEffect(() => {
    async function fetchManuscript() {
      try {
        const response = await fetch(`/api/manuscripts/${manuscriptId}`);
        const data = await response.json();
        
        if (!response.ok) {
          throw new Error(data.error || "Failed to load manuscript");
        }
        
        setManuscript(data.manuscript);
        sessionStorage.setItem("active_manuscript_id", manuscriptId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load manuscript");
      } finally {
        setLoading(false);
      }
    }

    async function fetchDefaultJournal() {
      if (journalSlugProp) {
        setDefaultJournalSlug(journalSlugProp);
        return;
      }
      try {
        const response = await fetch("/api/journals");
        const data = await response.json();
        if (response.ok && data.journals?.length > 0) {
          setDefaultJournalSlug(data.journals[0].slug);
        }
      } catch {
        // Silently fail
      }
    }

    async function fetchReviewers() {
      setIsLoadingReviewers(true);
      try {
        const response = await fetch(`/api/manuscripts/${manuscriptId}/reviewers`);
        const data = await response.json();
        if (response.ok) {
          const fetchedReviewers = data.reviewers || [];
          setReviewers(fetchedReviewers);
          setReviewerCounts(data.counts || { total: 0, shortlisted: 0, suggested: 0 });
          const expertiseMap: Record<string, string[]> = {};
          for (const r of fetchedReviewers) {
            if (r.assignedExpertise?.length) expertiseMap[r.id] = r.assignedExpertise;
          }
          setAssignedExpertise(expertiseMap);
        }
      } catch (err) {
        console.error("[Manuscript] Error fetching reviewers:", err);
      } finally {
        setIsLoadingReviewers(false);
      }
    }

    if (manuscriptId) {
      fetchManuscript();
      fetchDefaultJournal();
      fetchReviewers();
    }
  }, [manuscriptId, journalSlugProp]);

  const goToReviewers = () => {
    if (!manuscript || !routes) {
      toast.error("Please create a journal first to find reviewers");
      return;
    }
    sessionStorage.setItem("active_manuscript_id", manuscript.id);
    router.push(routes.reviewersHref(manuscript.id));
  };

  const goToCoi = () => {
    if (!manuscript || !routes) {
      toast.error("Please create a journal first to use COI screening");
      return;
    }
    if (manuscript.authors?.length > 0) {
      sessionStorage.setItem(
        "coi_authors_import",
        manuscript.authors.map((a) => a.fullName).join("\n")
      );
    }
    if (reviewers.length > 0) {
      sessionStorage.setItem(
        "coi_reviewers_import",
        reviewers.map((r) => r.name).join("\n")
      );
    }
    sessionStorage.setItem("coi_manuscript_id", manuscript.id);
    sessionStorage.setItem("coi_return_url", routes.coiReturnUrl(manuscript.id));
    sessionStorage.setItem("active_manuscript_id", manuscript.id);
    router.push(routes.coiHref);
  };

  const handleReviewerStatusChange = async (reviewerId: string, newStatus: "SHORTLISTED" | "REJECTED" | "SUGGESTED") => {
    try {
      const response = await fetch(`/api/manuscripts/${manuscriptId}/reviewers/${reviewerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (response.ok) {
        if (newStatus === "REJECTED") {
          setReviewers(prev => prev.filter(r => r.id !== reviewerId));
          setReviewerCounts(prev => ({ ...prev, total: prev.total - 1 }));
        } else {
          setReviewers(prev => prev.map(r => r.id === reviewerId ? { ...r, status: newStatus } : r));
          setReviewerCounts(prev => ({
            total: prev.total,
            shortlisted: newStatus === "SHORTLISTED" ? prev.shortlisted + 1 : Math.max(0, prev.shortlisted - 1),
            suggested: newStatus === "SUGGESTED" ? prev.suggested + 1 : Math.max(0, prev.suggested - 1),
          }));
        }
      }
    } catch {
      toast.error("Failed to update reviewer");
    }
  };

  const manuscriptExpertise = useMemo(() => {
    if (!manuscript?.keywords) return [];
    return [...new Set(manuscript.keywords)];
  }, [manuscript?.keywords]);

  const expertiseCoverage = useMemo(() => {
    const coverage: Record<string, { reviewerIds: string[]; reviewerNames: string[] }> = {};
    for (const exp of manuscriptExpertise) {
      coverage[exp] = { reviewerIds: [], reviewerNames: [] };
    }
    for (const r of reviewers) {
      const assigned = assignedExpertise[r.id] || [];
      for (const exp of assigned) {
        if (coverage[exp]) {
          coverage[exp].reviewerIds.push(r.id);
          coverage[exp].reviewerNames.push(r.name);
        }
      }
    }
    return coverage;
  }, [manuscriptExpertise, assignedExpertise, reviewers]);

  const coveredExpertise = useMemo(
    () => manuscriptExpertise.filter(e => (expertiseCoverage[e]?.reviewerIds.length || 0) > 0),
    [manuscriptExpertise, expertiseCoverage]
  );

  const uncoveredExpertise = useMemo(
    () => manuscriptExpertise.filter(e => (expertiseCoverage[e]?.reviewerIds.length || 0) === 0),
    [manuscriptExpertise, expertiseCoverage]
  );

  const flaggedReviewers = useMemo(
    () => flagsFromReviewerStatuses(reviewers),
    [reviewers]
  );

  const displayReviewers = useMemo(() => {
    const active = reviewers.filter((r) => r.status !== "REJECTED");
    const mapped = active.map(mapPersistedToDisplay);
    return sortReviewersForDisplay(mapped, flaggedReviewers);
  }, [reviewers, flaggedReviewers]);

  const handleToggleFlag = (reviewerId: string, direction: "up" | "down") => {
    const reviewer = reviewers.find((r) => r.id === reviewerId);
    if (!reviewer) return;
    const isActive = flaggedReviewers[reviewerId] === direction;
    if (direction === "up") {
      handleReviewerStatusChange(
        reviewerId,
        isActive ? "SUGGESTED" : "SHORTLISTED"
      );
    } else {
      handleReviewerStatusChange(reviewerId, isActive ? "SUGGESTED" : "REJECTED");
    }
  };

  const toggleExpertise = (reviewerId: string, expertise: string) => {
    setAssignedExpertise(prev => {
      const current = prev[reviewerId] || [];
      const updated = current.includes(expertise)
        ? current.filter(e => e !== expertise)
        : [...current, expertise];
      const next = { ...prev, [reviewerId]: updated };
      fetch(`/api/manuscripts/${manuscriptId}/reviewers/${reviewerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedExpertise: updated }),
      }).catch(err => console.error("Error saving expertise:", err));
      return next;
    });
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "READY":
        return null;
      case "PROCESSING":
      case "EXTRACTING":
      case "EMBEDDING":
        return <Badge className="bg-blue-100 text-blue-700">Processing</Badge>;
      case "ERROR":
        return <Badge className="bg-red-100 text-red-700">Error</Badge>;
      default:
        return null;
    }
  };

  const outerClass = showPageContainer
    ? "container mx-auto py-8 px-4 max-w-6xl"
    : "max-w-6xl";

  const listHref = routes?.listHref ?? "/dashboard/manuscripts";

  if (loading) {
    return (
      <div className={outerClass}>
        <Card>
          <CardContent className="py-12 text-center">
            <Loader2 className="h-8 w-8 mx-auto animate-spin text-gray-400" />
            <p className="mt-2 text-gray-500">Loading manuscript...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !manuscript) {
    return (
      <div className={outerClass}>
        <Card>
          <CardContent className="py-12 text-center">
            <XCircle className="h-12 w-12 mx-auto text-red-400 mb-4" />
            <h3 className="text-lg font-medium text-gray-700">{error || "Manuscript not found"}</h3>
            <Button variant="outline" className="mt-4" onClick={() => router.push(listHref)}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Go Back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={outerClass}>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <Button variant="ghost" size="sm" onClick={() => router.push(listHref)} className="mb-2">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <h1 className="text-2xl font-bold">{manuscript.title || manuscript.fileName}</h1>
          <div className="flex items-center gap-3 mt-2 text-sm text-gray-500">
            {getStatusBadge(manuscript.status)}
            <span>{manuscript.manuscriptType || "Document"}</span>
            {manuscript.fileType !== "manual" && (
              <>
                <span>•</span>
                <span>{formatSize(manuscript.fileSize)}</span>
              </>
            )}
            <span>•</span>
            <span>{manuscript.fileType === "manual" ? "Created" : "Uploaded"} {new Date(manuscript.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
        <div className="flex gap-2">
          {manuscript.fileType !== "manual" && (
            <Button 
              variant="outline"
              onClick={() => window.open(`/api/manuscripts/${manuscript.id}/download`, '_blank')}
            >
              <Download className="h-4 w-4 mr-2" />
              Download
            </Button>
          )}
          <Button variant="outline" onClick={goToCoi}>
            <AlertTriangle className="h-4 w-4 mr-2" />
            COI Check
          </Button>
          <Button onClick={goToReviewers}>
            <Search className="h-4 w-4 mr-2" />
            Find Reviewers
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-2xl font-bold text-blue-600">{manuscript.wordCount?.toLocaleString() || "—"}</p>
            <p className="text-sm text-gray-500">Words</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-2xl font-bold text-blue-600">{manuscript.pageCount || "—"}</p>
            <p className="text-sm text-gray-500">Pages</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-2xl font-bold text-blue-600">{manuscript.authors.length}</p>
            <p className="text-sm text-gray-500">Authors</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-2xl font-bold text-blue-600">{manuscript.referenceCount}</p>
            <p className="text-sm text-gray-500">References</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-2xl font-bold text-blue-600">{manuscript.figureCount || 0}</p>
            <p className="text-sm text-gray-500">Figures</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="authors">Authors ({manuscript.authors.length})</TabsTrigger>
          <TabsTrigger value="references">References ({manuscript.referenceCount})</TabsTrigger>
          <TabsTrigger value="declarations">Declarations</TabsTrigger>
          <TabsTrigger value="reviewers" className="flex items-center gap-1">
            <Users className="h-4 w-4" />
            Reviewers ({reviewerCounts.total})
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="mt-4 space-y-4">
          {manuscript.abstract && (
            <Card>
              <CardHeader>
                <CardTitle>Abstract</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-700 whitespace-pre-wrap">{manuscript.abstract}</p>
              </CardContent>
            </Card>
          )}

          {manuscript.keywords.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Keywords</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {manuscript.keywords.map((keyword, i) => (
                    <Badge key={i} variant="secondary">{keyword}</Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Proposed Reviewers
                </CardTitle>
                <div className="flex items-center gap-2">
                  {reviewerCounts.total > 0 && (
                    <Badge variant="secondary">{reviewerCounts.total} found</Badge>
                  )}
                  <Button size="sm" variant="outline" onClick={goToReviewers}>
                    <Search className="h-4 w-4 mr-1" />
                    {reviewerCounts.total > 0 ? "Find More" : "Find Reviewers"}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ReviewerResultsList
                reviewers={displayReviewers}
                manuscriptExpertise={manuscriptExpertise}
                expertiseCoverage={expertiseCoverage}
                coveredExpertise={coveredExpertise}
                uncoveredExpertise={uncoveredExpertise}
                assignedExpertise={assignedExpertise}
                flaggedReviewers={flaggedReviewers}
                onToggleExpertise={toggleExpertise}
                onToggleFlag={handleToggleFlag}
                isLoading={isLoadingReviewers}
                maxDisplay={6}
                emptyMessage='No reviewers found yet. Use "Find Reviewers" to discover suitable reviewers.'
              />
            </CardContent>
          </Card>

          {manuscript.fileType !== "manual" && (
            <Card>
              <CardHeader>
                <CardTitle>File Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">File Name</span>
                  <span>{manuscript.fileName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">File Type</span>
                  <span className="uppercase">{manuscript.fileType}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">File Size</span>
                  <span>{formatSize(manuscript.fileSize)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Publisher</span>
                  <span>{manuscript.publisher.name}</span>
                </div>
                {manuscript.journal && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Journal</span>
                    <span>{manuscript.journal.name}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-500">Uploaded By</span>
                  <span>{manuscript.uploader.name}</span>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Authors Tab */}
        <TabsContent value="authors" className="mt-4 space-y-4">
          {manuscript.authors.map((author) => (
            <Card key={author.id}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{author.fullName}</span>
                      {author.isCorresponding && (
                        <Badge variant="outline" className="text-xs">Corresponding</Badge>
                      )}
                      <span className="text-gray-400 text-sm">#{author.authorOrder}</span>
                    </div>
                    {author.email && (
                      <div className="flex items-center gap-1 text-sm text-gray-500 mt-1">
                        <Mail className="h-3 w-3" />
                        {author.email}
                      </div>
                    )}
                    {author.affiliationNums.length > 0 && (
                      <div className="text-sm text-gray-500 mt-1">
                        Affiliations: {author.affiliationNums.join(", ")}
                      </div>
                    )}
                  </div>
                  {author.orcid && (
                    <a
                      href={`https://orcid.org/${encodeURIComponent(author.orcid)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-green-600 hover:underline text-sm flex items-center gap-1"
                    >
                      ORCID <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}

          {manuscript.affiliations.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building className="h-5 w-5" />
                  Affiliations
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {manuscript.affiliations.map((aff) => (
                  <div key={aff.id} className="text-sm">
                    <span className="font-medium text-gray-700">{aff.affiliationNumber}.</span>{" "}
                    {aff.rawText}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* References Tab */}
        <TabsContent value="references" className="mt-4">
          <Card>
            <CardContent className="py-4 space-y-3">
              {manuscript.references.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No references extracted</p>
              ) : (
                manuscript.references.map((ref) => (
                  <div key={ref.id} className="text-sm border-b pb-2 last:border-0">
                    <span className="font-medium text-gray-700">[{ref.refNumber}]</span>{" "}
                    <span className="text-gray-600">{ref.rawText}</span>
                    {ref.doi && (
                      <a
                        href={`https://doi.org/${encodeURIComponent(ref.doi)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-2 text-blue-600 hover:underline"
                      >
                        DOI
                      </a>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Declarations Tab */}
        <TabsContent value="declarations" className="mt-4 space-y-4">
          {manuscript.declarations.funding && (
            <Card>
              <CardHeader>
                <CardTitle>Funding</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-700">{manuscript.declarations.funding}</p>
              </CardContent>
            </Card>
          )}

          {manuscript.declarations.conflictOfInterest && (
            <Card>
              <CardHeader>
                <CardTitle>Conflict of Interest</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-700">{manuscript.declarations.conflictOfInterest}</p>
              </CardContent>
            </Card>
          )}

          {manuscript.declarations.ethics && (
            <Card>
              <CardHeader>
                <CardTitle>Ethics Statement</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-700">{manuscript.declarations.ethics}</p>
              </CardContent>
            </Card>
          )}

          {manuscript.declarations.dataAvailability && (
            <Card>
              <CardHeader>
                <CardTitle>Data Availability</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-700">{manuscript.declarations.dataAvailability}</p>
              </CardContent>
            </Card>
          )}

          {manuscript.declarations.authorContributions && (
            <Card>
              <CardHeader>
                <CardTitle>Author Contributions</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-700">{manuscript.declarations.authorContributions}</p>
              </CardContent>
            </Card>
          )}

          {!manuscript.declarations.funding && 
           !manuscript.declarations.conflictOfInterest && 
           !manuscript.declarations.ethics && 
           !manuscript.declarations.dataAvailability &&
           !manuscript.declarations.authorContributions && (
            <Card>
              <CardContent className="py-8 text-center text-gray-500">
                No declarations found in this manuscript
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Reviewers Tab */}
        <TabsContent value="reviewers" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="font-medium">
                {reviewerCounts.total} Reviewer{reviewerCounts.total !== 1 ? "s" : ""}
              </h3>
              {reviewerCounts.shortlisted > 0 && (
                <Badge>{reviewerCounts.shortlisted} shortlisted</Badge>
              )}
            </div>
            <Button size="sm" onClick={goToReviewers}>
              <Search className="h-4 w-4 mr-1" />
              {reviewerCounts.total > 0 ? "Find More" : "Find Reviewers"}
            </Button>
          </div>

          <ReviewerResultsList
            reviewers={displayReviewers}
            manuscriptExpertise={manuscriptExpertise}
            expertiseCoverage={expertiseCoverage}
            coveredExpertise={coveredExpertise}
            uncoveredExpertise={uncoveredExpertise}
            assignedExpertise={assignedExpertise}
            flaggedReviewers={flaggedReviewers}
            onToggleExpertise={toggleExpertise}
            onToggleFlag={handleToggleFlag}
            isLoading={isLoadingReviewers}
            emptyMessage='Use "Find Reviewers" to discover suitable reviewers for this manuscript.'
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
