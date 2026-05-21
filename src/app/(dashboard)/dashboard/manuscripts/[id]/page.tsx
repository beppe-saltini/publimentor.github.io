"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { 
  FileText, ArrowLeft, Clock, CheckCircle, XCircle, Loader2, 
  Users, BookOpen, Building, Mail, ExternalLink, Download, Search, AlertTriangle,
  Award, MapPin, ThumbsUp, ThumbsDown, Sparkles, Check, GraduationCap
} from "lucide-react";
import { COIBadge, COIDetails, getCardBorderClass, type ConflictSeverity } from "@/components/reviewers";

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
}

export default function ManuscriptDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [manuscript, setManuscript] = useState<Manuscript | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [defaultJournalSlug, setDefaultJournalSlug] = useState<string | null>(null);
  const [reviewers, setReviewers] = useState<PersistedReviewer[]>([]);
  const [reviewerCounts, setReviewerCounts] = useState({ total: 0, shortlisted: 0, suggested: 0 });
  const [isLoadingReviewers, setIsLoadingReviewers] = useState(false);
  const [assignedExpertise, setAssignedExpertise] = useState<Record<string, string[]>>({});

  useEffect(() => {
    async function fetchManuscript() {
      try {
        const response = await fetch(`/api/manuscripts/${params.id}`);
        const data = await response.json();
        
        if (!response.ok) {
          throw new Error(data.error || "Failed to load manuscript");
        }
        
        setManuscript(data.manuscript);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load manuscript");
      } finally {
        setLoading(false);
      }
    }

    async function fetchDefaultJournal() {
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
        const response = await fetch(`/api/manuscripts/${params.id}/reviewers`);
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

    if (params.id) {
      fetchManuscript();
      fetchDefaultJournal();
      fetchReviewers();
    }
  }, [params.id]);

  const handleReviewerStatusChange = async (reviewerId: string, newStatus: "SHORTLISTED" | "REJECTED" | "SUGGESTED") => {
    try {
      const response = await fetch(`/api/manuscripts/${params.id}/reviewers/${reviewerId}`, {
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

  const toggleExpertise = (reviewerId: string, expertise: string) => {
    setAssignedExpertise(prev => {
      const current = prev[reviewerId] || [];
      const updated = current.includes(expertise)
        ? current.filter(e => e !== expertise)
        : [...current, expertise];
      const next = { ...prev, [reviewerId]: updated };
      fetch(`/api/manuscripts/${params.id}/reviewers/${reviewerId}`, {
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

  if (loading) {
    return (
      <div className="container mx-auto py-8 px-4 max-w-6xl">
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
      <div className="container mx-auto py-8 px-4 max-w-6xl">
        <Card>
          <CardContent className="py-12 text-center">
            <XCircle className="h-12 w-12 mx-auto text-red-400 mb-4" />
            <h3 className="text-lg font-medium text-gray-700">{error || "Manuscript not found"}</h3>
            <Button variant="outline" className="mt-4" onClick={() => router.back()}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Go Back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4 max-w-6xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <Button variant="ghost" size="sm" onClick={() => router.back()} className="mb-2">
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
          <Button
            variant="outline"
            onClick={() => {
              const journalSlug = manuscript.journal?.slug || defaultJournalSlug;
              if (!journalSlug) {
                toast.error("Please create a journal first to use COI screening");
                return;
              }
              if (manuscript.authors?.length > 0) {
                sessionStorage.setItem("coi_authors_import",
                  manuscript.authors.map(a => a.fullName).join("\n"));
              }
              if (reviewers.length > 0) {
                sessionStorage.setItem("coi_reviewers_import",
                  reviewers.map(r => r.name).join("\n"));
              }
              sessionStorage.setItem("coi_return_url",
                `/dashboard/manuscripts/${manuscript.id}`);
              router.push(`/dashboard/journals/${journalSlug}/coi`);
            }}
          >
            <AlertTriangle className="h-4 w-4 mr-2" />
            COI Check
          </Button>
          <Button
            onClick={() => {
              const journalSlug = manuscript.journal?.slug || defaultJournalSlug;
              if (journalSlug) {
                router.push(`/dashboard/journals/${journalSlug}/reviewers?manuscriptId=${manuscript.id}`);
              } else {
                toast.error("Please create a journal first to find reviewers");
              }
            }}
          >
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
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const journalSlug = manuscript.journal?.slug || defaultJournalSlug;
                      if (journalSlug) {
                        router.push(`/dashboard/journals/${journalSlug}/reviewers?manuscriptId=${manuscript.id}`);
                      } else {
                        toast.error("Please create a journal first to find reviewers");
                      }
                    }}
                  >
                    <Search className="h-4 w-4 mr-1" />
                    {reviewerCounts.total > 0 ? "Find More" : "Find Reviewers"}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {isLoadingReviewers ? (
                <div className="text-center py-6">
                  <Loader2 className="h-6 w-6 mx-auto animate-spin text-gray-400" />
                  <p className="text-sm text-gray-500 mt-2">Loading reviewers...</p>
                </div>
              ) : reviewers.length === 0 ? (
                <div className="text-center py-6 text-gray-500">
                  <Users className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                  <p className="text-sm">No reviewers found yet</p>
                  <p className="text-xs text-gray-400 mt-1">Use &quot;Find Reviewers&quot; to discover suitable reviewers</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {reviewers.slice(0, 6).map((reviewer) => (
                    <div key={reviewer.id} className={`border rounded-lg p-3 space-y-2 ${
                      reviewer.coiSummary?.hasConflict
                        ? getCardBorderClass(reviewer.coiSummary.worstSeverity as ConflictSeverity, true)
                        : ""
                    }`}>
                      <div className="flex items-start justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <p className="font-medium truncate">{reviewer.name}</p>
                            <COIBadge
                              severity={(reviewer.coiSummary?.worstSeverity as ConflictSeverity) || null}
                              conflictCount={reviewer.coiSummary?.conflictCount || 0}
                              size="sm"
                            />
                          </div>
                          {reviewer.affiliation && (
                            <p className="text-xs text-gray-500 truncate flex items-center gap-1">
                              <Building className="h-3 w-3 shrink-0" />
                              {reviewer.affiliation}
                            </p>
                          )}
                        </div>
                        <Badge variant={reviewer.status === "SHORTLISTED" ? "default" : "secondary"} className="text-xs shrink-0 ml-2">
                          {reviewer.status === "SHORTLISTED" ? "Shortlisted" : "Suggested"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-500">
                        {reviewer.hIndex != null && (
                          <span className="flex items-center gap-1" title="h-index">
                            <Award className="h-3 w-3" />h: {reviewer.hIndex}
                          </span>
                        )}
                        {reviewer.publicationCount != null && (
                          <span>{reviewer.publicationCount} pubs</span>
                        )}
                        {reviewer.citationCount != null && (
                          <span>{reviewer.citationCount.toLocaleString()} cits</span>
                        )}
                      </div>
                      {manuscriptExpertise.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {manuscriptExpertise.map(exp => {
                            const isChecked = (assignedExpertise[reviewer.id] || []).includes(exp);
                            return (
                              <button key={exp}
                                onClick={() => toggleExpertise(reviewer.id, exp)}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors ${
                                  isChecked
                                    ? "bg-green-100 text-green-800 border-green-300"
                                    : "bg-white text-gray-500 border-gray-300 hover:border-blue-400 hover:text-blue-700"
                                }`}>
                                <div className={`w-3 h-3 rounded border flex items-center justify-center flex-shrink-0 ${
                                  isChecked ? "bg-green-600 border-green-600" : "border-gray-400"
                                }`}>
                                  {isChecked && <Check className="h-2 w-2 text-white" />}
                                </div>
                                {exp}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      <div className="flex gap-1">
                        {reviewer.status !== "SHORTLISTED" ? (
                          <Button size="sm" variant="outline" className="h-7 text-xs flex-1"
                            onClick={() => handleReviewerStatusChange(reviewer.id, "SHORTLISTED")}>
                            <ThumbsUp className="h-3 w-3 mr-1" />Shortlist
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" className="h-7 text-xs flex-1"
                            onClick={() => handleReviewerStatusChange(reviewer.id, "SUGGESTED")}>
                            Unshortlist
                          </Button>
                        )}
                        <Button size="sm" variant="outline" className="h-7 text-xs text-red-600 hover:text-red-700"
                          onClick={() => handleReviewerStatusChange(reviewer.id, "REJECTED")}>
                          <ThumbsDown className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {reviewers.length > 6 && (
                <p className="text-xs text-center text-gray-400 mt-3">
                  Showing 6 of {reviewers.length} reviewers. See the Reviewers tab for the full list.
                </p>
              )}
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
            <Button
              size="sm"
              onClick={() => {
                const journalSlug = manuscript.journal?.slug || defaultJournalSlug;
                if (journalSlug) {
                  router.push(`/dashboard/journals/${journalSlug}/reviewers?manuscriptId=${manuscript.id}`);
                } else {
                  toast.error("Please create a journal first to find reviewers");
                }
              }}
            >
              <Search className="h-4 w-4 mr-1" />
              {reviewerCounts.total > 0 ? "Find More" : "Find Reviewers"}
            </Button>
          </div>

          {/* Expertise Coverage Panel */}
          {manuscriptExpertise.length > 0 && reviewers.length > 0 && (
            <Card className="border-blue-200 bg-blue-50/30">
              <CardContent className="py-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <GraduationCap className="h-4 w-4 text-blue-600" />
                    Expertise Coverage
                    <Badge variant="outline" className={`text-xs ${
                      coveredExpertise.length === manuscriptExpertise.length
                        ? "bg-green-100 text-green-700"
                        : coveredExpertise.length > 0
                        ? "bg-amber-100 text-amber-700"
                        : "bg-red-100 text-red-700"
                    }`}>
                      {coveredExpertise.length}/{manuscriptExpertise.length} covered
                    </Badge>
                  </h4>
                </div>
                <div className="flex flex-wrap gap-2">
                  {manuscriptExpertise.map(exp => {
                    const info = expertiseCoverage[exp];
                    const isCovered = info && info.reviewerNames.length > 0;
                    return (
                      <div key={exp} className="group relative">
                        <Badge variant="outline" className={`text-xs cursor-default ${
                          isCovered
                            ? "bg-green-100 text-green-700 border-green-300"
                            : "bg-amber-50 text-amber-700 border-amber-300"
                        }`}>
                          {isCovered ? <Check className="h-3 w-3 mr-1" /> : <AlertTriangle className="h-3 w-3 mr-1" />}
                          {exp}
                          {isCovered && <span className="ml-1 text-green-600">({info.reviewerNames.length})</span>}
                        </Badge>
                        {isCovered && (
                          <div className="absolute bottom-full left-0 mb-1 hidden group-hover:block z-10 bg-white shadow-lg rounded p-2 text-xs border min-w-[150px]">
                            <p className="font-medium mb-1">Covered by:</p>
                            {info.reviewerNames.map((n, i) => <p key={i} className="text-gray-600">{n}</p>)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {isLoadingReviewers ? (
            <Card>
              <CardContent className="py-8 text-center">
                <Loader2 className="h-6 w-6 mx-auto animate-spin text-gray-400" />
                <p className="text-sm text-gray-500 mt-2">Loading reviewers...</p>
              </CardContent>
            </Card>
          ) : reviewers.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Users className="h-10 w-10 mx-auto mb-3 text-gray-300" />
                <h3 className="font-medium text-gray-700">No reviewers yet</h3>
                <p className="text-sm text-gray-500 mt-1">Use the &quot;Find Reviewers&quot; button to discover suitable reviewers for this manuscript.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {reviewers.map((reviewer) => (
                <Card key={reviewer.id} className={
                  reviewer.coiSummary?.hasConflict
                    ? getCardBorderClass(reviewer.coiSummary.worstSeverity as ConflictSeverity, true)
                    : ""
                }>
                  <CardContent className="py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-medium">{reviewer.name}</h4>
                          <Badge variant={reviewer.status === "SHORTLISTED" ? "default" : "secondary"} className="text-xs">
                            {reviewer.status === "SHORTLISTED" ? "Shortlisted" : "Suggested"}
                          </Badge>
                          <COIBadge
                            severity={(reviewer.coiSummary?.worstSeverity as ConflictSeverity) || null}
                            conflictCount={reviewer.coiSummary?.conflictCount || 0}
                            size="sm"
                          />
                        </div>

                        {reviewer.affiliation && (
                          <p className="text-sm text-gray-500 flex items-center gap-1">
                            <Building className="h-3.5 w-3.5 shrink-0" />
                            {reviewer.affiliation}
                          </p>
                        )}
                        {reviewer.country && (
                          <p className="text-sm text-gray-400 flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5 shrink-0" />
                            {reviewer.country}
                          </p>
                        )}

                        <div className="flex items-center gap-4 text-sm text-gray-500 pt-1">
                          {reviewer.hIndex != null && (
                            <span className="flex items-center gap-1" title="h-index">
                              <Award className="h-3.5 w-3.5" />h-index: {reviewer.hIndex}
                            </span>
                          )}
                          {reviewer.publicationCount != null && (
                            <span>{reviewer.publicationCount} publications</span>
                          )}
                          {reviewer.citationCount != null && (
                            <span>{reviewer.citationCount.toLocaleString()} citations</span>
                          )}
                        </div>

                        {reviewer.llmAnalysis && (
                          <div className="mt-2 bg-gray-50 rounded p-2 text-sm">
                            <div className="flex items-center gap-1 text-gray-600 mb-1">
                              <Sparkles className="h-3.5 w-3.5" />
                              <span className="font-medium">Relevance: {reviewer.llmAnalysis.relevanceScore}/10</span>
                              {reviewer.llmAnalysis.topicalMatch && (
                                <span className="text-xs text-gray-400 ml-1">— {reviewer.llmAnalysis.topicalMatch}</span>
                              )}
                            </div>
                            {reviewer.llmAnalysis.reasoning && (
                              <p className="text-xs text-gray-500">{reviewer.llmAnalysis.reasoning}</p>
                            )}
                          </div>
                        )}

                        {/* Expertise Assignment Checkboxes */}
                        {manuscriptExpertise.length > 0 && (
                          <div className="mt-2 p-2 bg-blue-50/50 rounded-lg border border-blue-200">
                            <p className="text-xs font-medium text-blue-800 mb-1.5">Covers expertise:</p>
                            <div className="flex flex-wrap gap-1.5">
                              {manuscriptExpertise.map(exp => {
                                const isChecked = (assignedExpertise[reviewer.id] || []).includes(exp);
                                return (
                                  <button key={exp}
                                    onClick={() => toggleExpertise(reviewer.id, exp)}
                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors ${
                                      isChecked
                                        ? "bg-green-100 text-green-800 border-green-300"
                                        : "bg-white text-gray-500 border-gray-300 hover:border-blue-400 hover:text-blue-700"
                                    }`}>
                                    <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 ${
                                      isChecked ? "bg-green-600 border-green-600" : "border-gray-400"
                                    }`}>
                                      {isChecked && <Check className="h-2.5 w-2.5 text-white" />}
                                    </div>
                                    {exp}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        <div className="flex flex-col gap-1 text-xs pt-1">
                          <div className="flex items-center gap-1.5">
                            <Mail className="h-3 w-3 text-gray-400 shrink-0" />
                            {reviewer.email ? (
                              <a href={`mailto:${reviewer.email}`} className="text-blue-600 hover:underline truncate">{reviewer.email}</a>
                            ) : (
                              <span className="text-gray-400 italic">No public email</span>
                            )}
                          </div>
                          {reviewer.verificationUrls?.institutionProfileUrl ? (
                            <div className="flex items-center gap-1.5">
                              <Building className="h-3 w-3 text-green-500 shrink-0" />
                              <a href={reviewer.verificationUrls.institutionProfileUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Institution Profile</a>
                            </div>
                          ) : reviewer.verificationUrls?.institutionSearchUrl && (
                            <div className="flex items-center gap-1.5">
                              <Building className="h-3 w-3 text-gray-400 shrink-0" />
                              <a href={reviewer.verificationUrls.institutionSearchUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Search at institution</a>
                            </div>
                          )}
                        </div>

                        {reviewer.verificationUrls && (
                          <div className="flex gap-2 pt-1">
                            {reviewer.verificationUrls.pubmedSearchUrl && (
                              <a href={reviewer.verificationUrls.pubmedSearchUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">PubMed</a>
                            )}
                            {reviewer.verificationUrls.googleScholarUrl && (
                              <a href={reviewer.verificationUrls.googleScholarUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">Scholar</a>
                            )}
                            {reviewer.verificationUrls.semanticScholarUrl && (
                              <a href={reviewer.verificationUrls.semanticScholarUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">Semantic Scholar</a>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col gap-1 shrink-0">
                        {reviewer.status !== "SHORTLISTED" ? (
                          <Button size="sm" variant="outline" className="text-xs"
                            onClick={() => handleReviewerStatusChange(reviewer.id, "SHORTLISTED")}>
                            <ThumbsUp className="h-3 w-3 mr-1" />Shortlist
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" className="text-xs"
                            onClick={() => handleReviewerStatusChange(reviewer.id, "SUGGESTED")}>
                            Unshortlist
                          </Button>
                        )}
                        <Button size="sm" variant="outline" className="text-xs text-red-600 hover:text-red-700"
                          onClick={() => handleReviewerStatusChange(reviewer.id, "REJECTED")}>
                          <ThumbsDown className="h-3 w-3 mr-1" />Reject
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
