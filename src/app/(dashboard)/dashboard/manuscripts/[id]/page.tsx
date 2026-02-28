"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Separator } from "@/components/ui/separator";
import { 
  FileText, ArrowLeft, Clock, CheckCircle, XCircle, Loader2, 
  Users, BookOpen, Building, Mail, ExternalLink, Download, Search, AlertTriangle,
  Globe, DollarSign, Sparkles, Award, TrendingUp, ThumbsUp, ThumbsDown, MapPin
} from "lucide-react";

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

interface JournalSuggestion {
  id: string;
  name: string;
  publisher: string;
  reasoning: string;
  topicalMatch: "excellent" | "good" | "moderate" | "unknown";
  impactFactor: number | null;
  hIndex: number | null;
  isOpenAccess: boolean;
  isInDoaj: boolean;
  apcUsd: number | null;
  worksCount: number;
  homepageUrl: string | null;
  issnL: string | null;
  countryCode: string | null;
  source: "llm" | "openalex" | "both";
  verified: boolean;
}

interface PersistedReviewer {
  id: string;
  name: string;
  firstName?: string;
  lastName?: string;
  affiliation?: string;
  country?: string;
  hIndex?: number;
  citationCount?: number;
  publicationCount?: number;
  inferredGender?: string;
  sources?: string[];
  recentArticles?: { title: string; journal: string; year: string; pmid: string; position: string }[];
  verificationUrls?: { pubmedSearchUrl: string; googleScholarUrl: string; institutionSearchUrl: string; semanticScholarUrl?: string; openAlexUrl?: string };
  llmAnalysis?: { relevanceScore: number; reasoning: string; topicalMatch: string; recommendation: string; expertise?: string[] };
  coiSummary?: { hasConflict: boolean; worstSeverity: string | null; conflictCount: number };
  status: "SUGGESTED" | "SHORTLISTED" | "REJECTED";
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
  workflowStatus?: string;
  detectedJournal?: string;
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

export default function ManuscriptDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [manuscript, setManuscript] = useState<Manuscript | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [defaultJournalSlug, setDefaultJournalSlug] = useState<string | null>(null);

  // Reviewer state
  const [reviewers, setReviewers] = useState<PersistedReviewer[]>([]);
  const [reviewerCounts, setReviewerCounts] = useState({ total: 0, shortlisted: 0, suggested: 0 });
  const [isLoadingReviewers, setIsLoadingReviewers] = useState(false);
  const [workflowStatus, setWorkflowStatus] = useState<string>("NEW");
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  // Journal suggestion state
  const [journalSuggestions, setJournalSuggestions] = useState<JournalSuggestion[]>([]);
  const [journalSearchStrategy, setJournalSearchStrategy] = useState<string>("");
  const [isSuggestingJournals, setIsSuggestingJournals] = useState(false);
  const [journalSuggestionsLoaded, setJournalSuggestionsLoaded] = useState(false);

  useEffect(() => {
    async function fetchManuscript() {
      try {
        const response = await fetch(`/api/manuscripts/${params.id}`);
        const data = await response.json();
        
        if (!response.ok) {
          throw new Error(data.error || "Failed to load manuscript");
        }
        
        setManuscript(data.manuscript);
        if (data.manuscript?.workflowStatus) {
          setWorkflowStatus(data.manuscript.workflowStatus);
        }
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
          setReviewers(data.reviewers || []);
          setReviewerCounts(data.counts || { total: 0, shortlisted: 0, suggested: 0 });
        }
      } catch {
        // Silently fail
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

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "READY":
        return <Badge className="bg-green-100 text-green-700">Ready</Badge>;
      case "PROCESSING":
      case "EXTRACTING":
      case "EMBEDDING":
        return <Badge className="bg-blue-100 text-blue-700">Processing</Badge>;
      case "ERROR":
        return <Badge className="bg-red-100 text-red-700">Error</Badge>;
      default:
        return <Badge className="bg-gray-100 text-gray-700">{status}</Badge>;
    }
  };

  const handleSuggestJournals = async () => {
    if (!manuscript?.abstract) {
      toast.error("This manuscript has no abstract — journal matching requires an abstract");
      return;
    }

    setIsSuggestingJournals(true);
    try {
      const response = await fetch("/api/journals/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          abstract: manuscript.abstract,
          keywords: manuscript.keywords,
          manuscriptType: manuscript.manuscriptType,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to suggest journals");
      }

      setJournalSuggestions(data.suggestions || []);
      setJournalSearchStrategy(data.searchStrategy || "");
      setJournalSuggestionsLoaded(true);
      toast.success(`Found ${data.suggestions?.length || 0} matching journals`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Journal suggestion failed");
    } finally {
      setIsSuggestingJournals(false);
    }
  };

  const getMatchBadge = (match: string) => {
    switch (match) {
      case "excellent":
        return <Badge className="bg-green-100 text-green-700">Excellent Match</Badge>;
      case "good":
        return <Badge className="bg-blue-100 text-blue-700">Good Match</Badge>;
      case "moderate":
        return <Badge className="bg-amber-100 text-amber-700">Moderate Match</Badge>;
      default:
        return null;
    }
  };

  const handleWorkflowStatusChange = async (newStatus: string) => {
    setIsUpdatingStatus(true);
    try {
      const response = await fetch(`/api/manuscripts/${params.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowStatus: newStatus }),
      });
      if (response.ok) {
        setWorkflowStatus(newStatus);
        toast.success(`Status updated to ${newStatus.replace(/_/g, " ").toLowerCase()}`);
      } else {
        toast.error("Failed to update status");
      }
    } catch {
      toast.error("Failed to update status");
    } finally {
      setIsUpdatingStatus(false);
    }
  };

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
            shortlisted: newStatus === "SHORTLISTED"
              ? prev.shortlisted + 1
              : Math.max(0, prev.shortlisted - 1),
            suggested: newStatus === "SUGGESTED"
              ? prev.suggested + 1
              : Math.max(0, prev.suggested - 1),
          }));
        }
      }
    } catch {
      toast.error("Failed to update reviewer");
    }
  };

  const workflowStatusOptions = [
    { value: "NEW", label: "New", color: "bg-gray-100 text-gray-700" },
    { value: "FINDING_REVIEWERS", label: "Finding Reviewers", color: "bg-blue-100 text-blue-700" },
    { value: "REVIEWERS_INVITED", label: "Reviewers Invited", color: "bg-green-100 text-green-700" },
    { value: "CLOSED", label: "Closed", color: "bg-purple-100 text-purple-700" },
  ];

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
            <span>•</span>
            <span>{formatSize(manuscript.fileSize)}</span>
            <span>•</span>
            <span>Uploaded {new Date(manuscript.createdAt).toLocaleDateString()}</span>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <span className="text-sm text-gray-500">Workflow:</span>
            <select
              value={workflowStatus}
              onChange={(e) => handleWorkflowStatusChange(e.target.value)}
              disabled={isUpdatingStatus}
              className="text-sm border rounded-md px-2 py-1 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {workflowStatusOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            {isUpdatingStatus && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
            {reviewerCounts.total > 0 && (
              <Badge variant="outline" className="ml-2">
                <Users className="h-3 w-3 mr-1" />
                {reviewerCounts.shortlisted}/{reviewerCounts.total} reviewers
              </Badge>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline"
            onClick={() => window.open(`/api/manuscripts/${manuscript.id}/download`, '_blank')}
          >
            <Download className="h-4 w-4 mr-2" />
            Download
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              const journalSlug = manuscript.journal?.slug || defaultJournalSlug;
              if (journalSlug) {
                router.push(`/dashboard/journals/${journalSlug}/coi`);
              } else {
                toast.error("Please create a journal first to use COI screening");
              }
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
          <TabsTrigger value="reviewers">
            <Users className="h-4 w-4 mr-1.5" />
            Reviewers ({reviewerCounts.total})
          </TabsTrigger>
          <TabsTrigger value="journals">
            <BookOpen className="h-4 w-4 mr-1.5" />
            Journal Match
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
          {isLoadingReviewers ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Loader2 className="h-8 w-8 mx-auto animate-spin text-gray-400" />
                <p className="mt-2 text-gray-500">Loading reviewers...</p>
              </CardContent>
            </Card>
          ) : reviewers.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Users className="h-12 w-12 mx-auto text-gray-300 mb-4" />
                <h3 className="text-lg font-medium text-gray-700">No reviewers found yet</h3>
                <p className="text-gray-500 mt-1 mb-4">
                  Use the &quot;Find Reviewers&quot; button to discover potential reviewers for this manuscript.
                </p>
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
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold">
                    {reviewerCounts.total} Reviewers
                  </h3>
                  <p className="text-sm text-gray-500">
                    {reviewerCounts.shortlisted} shortlisted · {reviewerCounts.suggested} suggested
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => {
                    const journalSlug = manuscript.journal?.slug || defaultJournalSlug;
                    if (journalSlug) {
                      router.push(`/dashboard/journals/${journalSlug}/reviewers?manuscriptId=${manuscript.id}`);
                    }
                  }}
                >
                  <Search className="h-4 w-4 mr-2" />
                  Find More
                </Button>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                {reviewers.map((reviewer) => (
                  <Card
                    key={reviewer.id}
                    className={`hover:shadow-md transition-shadow ${
                      reviewer.status === "SHORTLISTED" ? "border-green-200 bg-green-50/30" : ""
                    }`}
                  >
                    <CardContent className="py-4">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h4 className="font-semibold text-sm flex items-center gap-1.5">
                            {reviewer.name}
                            {reviewer.inferredGender && (
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                reviewer.inferredGender === "likely_female"
                                  ? "bg-pink-100 text-pink-700"
                                  : reviewer.inferredGender === "likely_male"
                                  ? "bg-sky-100 text-sky-700"
                                  : "bg-gray-100 text-gray-500"
                              }`}>
                                {reviewer.inferredGender === "likely_female" ? "F" : reviewer.inferredGender === "likely_male" ? "M" : "N/A"}
                              </span>
                            )}
                          </h4>
                          {reviewer.affiliation && (
                            <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                              <Building className="h-3 w-3" />
                              {reviewer.affiliation.length > 60
                                ? reviewer.affiliation.slice(0, 60) + "..."
                                : reviewer.affiliation}
                            </p>
                          )}
                          {reviewer.country && (
                            <p className="text-xs text-gray-400 flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {reviewer.country}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <Badge
                            variant="outline"
                            className={`text-xs ${
                              reviewer.status === "SHORTLISTED"
                                ? "bg-green-100 text-green-700 border-green-300"
                                : "bg-gray-100 text-gray-600"
                            }`}
                          >
                            {reviewer.status === "SHORTLISTED" ? "Shortlisted" : "Suggested"}
                          </Badge>
                          <div className="flex gap-1 mt-1">
                            <button
                              onClick={() => handleReviewerStatusChange(
                                reviewer.id,
                                reviewer.status === "SHORTLISTED" ? "SUGGESTED" : "SHORTLISTED"
                              )}
                              className={`p-1 rounded transition-colors ${
                                reviewer.status === "SHORTLISTED"
                                  ? "bg-green-100 text-green-700"
                                  : "text-gray-300 hover:text-green-500 hover:bg-green-50"
                              }`}
                              title={reviewer.status === "SHORTLISTED" ? "Remove from shortlist" : "Shortlist reviewer"}
                            >
                              <ThumbsUp className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => handleReviewerStatusChange(reviewer.id, "REJECTED")}
                              className="p-1 rounded transition-colors text-gray-300 hover:text-red-500 hover:bg-red-50"
                              title="Remove reviewer"
                            >
                              <ThumbsDown className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Metrics row */}
                      <div className="flex gap-3 text-xs mb-2">
                        {reviewer.hIndex != null && (
                          <div className="flex items-center gap-1">
                            <Award className="h-3 w-3 text-amber-600" />
                            <span className="font-medium">h-{reviewer.hIndex}</span>
                          </div>
                        )}
                        {reviewer.publicationCount != null && (
                          <div className="flex items-center gap-1">
                            <BookOpen className="h-3 w-3 text-gray-500" />
                            <span>{reviewer.publicationCount} pubs</span>
                          </div>
                        )}
                        {reviewer.citationCount != null && (
                          <div className="flex items-center gap-1 text-gray-500">
                            {reviewer.citationCount.toLocaleString()} citations
                          </div>
                        )}
                      </div>

                      {/* LLM Analysis */}
                      {reviewer.llmAnalysis && (
                        <div className="p-2 bg-purple-50 rounded border border-purple-200 mb-2">
                          <div className="flex items-center gap-2 mb-1">
                            <Sparkles className="h-3 w-3 text-purple-600" />
                            <span className="text-xs font-medium text-purple-800">
                              {reviewer.llmAnalysis.relevanceScore}% match
                            </span>
                            <Badge variant="outline" className="text-xs bg-purple-100 text-purple-700">
                              {reviewer.llmAnalysis.topicalMatch}
                            </Badge>
                          </div>
                          <p className="text-xs text-purple-700">{reviewer.llmAnalysis.reasoning}</p>
                        </div>
                      )}

                      {/* Verification links */}
                      {reviewer.verificationUrls && (
                        <div className="flex flex-wrap gap-1.5">
                          <a
                            href={reviewer.verificationUrls.pubmedSearchUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-600 hover:underline flex items-center gap-0.5"
                          >
                            <FileText className="h-3 w-3" />
                            PubMed
                          </a>
                          <a
                            href={reviewer.verificationUrls.googleScholarUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-600 hover:underline flex items-center gap-0.5"
                          >
                            <BookOpen className="h-3 w-3" />
                            Scholar
                          </a>
                          {reviewer.verificationUrls.semanticScholarUrl && (
                            <a
                              href={reviewer.verificationUrls.semanticScholarUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-600 hover:underline flex items-center gap-0.5"
                            >
                              <Award className="h-3 w-3" />
                              S2
                            </a>
                          )}
                          <a
                            href={reviewer.verificationUrls.institutionSearchUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-600 hover:underline flex items-center gap-0.5"
                          >
                            <Mail className="h-3 w-3" />
                            Email
                          </a>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </TabsContent>

        {/* Journal Match Tab */}
        <TabsContent value="journals" className="mt-4 space-y-4">
          {!journalSuggestionsLoaded ? (
            <Card>
              <CardContent className="py-12 text-center">
                {isSuggestingJournals ? (
                  <>
                    <Loader2 className="h-10 w-10 mx-auto animate-spin text-blue-500 mb-4" />
                    <h3 className="text-lg font-medium text-gray-700">Analyzing manuscript...</h3>
                    <p className="text-gray-500 mt-1">
                      Using AI and OpenAlex to find matching journals. This may take up to a minute.
                    </p>
                  </>
                ) : (
                  <>
                    <BookOpen className="h-12 w-12 mx-auto text-gray-300 mb-4" />
                    <h3 className="text-lg font-medium text-gray-700">Find Matching Journals</h3>
                    <p className="text-gray-500 mt-1 mb-4 max-w-md mx-auto">
                      Analyze your manuscript&apos;s abstract and keywords to find the best journals
                      for submission, across all publishers.
                    </p>
                    {!manuscript.abstract ? (
                      <p className="text-amber-600 text-sm mb-4">
                        This manuscript has no extracted abstract. Journal matching requires an abstract.
                      </p>
                    ) : null}
                    <Button
                      onClick={handleSuggestJournals}
                      disabled={!manuscript.abstract || isSuggestingJournals}
                      size="lg"
                    >
                      <Sparkles className="h-4 w-4 mr-2" />
                      Find Matching Journals
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Strategy summary */}
              {journalSearchStrategy && (
                <Card className="bg-purple-50 border-purple-200">
                  <CardContent className="py-3">
                    <div className="flex items-start gap-2">
                      <Sparkles className="h-5 w-5 text-purple-600 mt-0.5 flex-shrink-0" />
                      <div className="text-sm text-purple-800">
                        <p className="font-medium">AI Analysis</p>
                        <p className="text-purple-700">{journalSearchStrategy}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Results header */}
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">
                  {journalSuggestions.length} Journals Found
                </h3>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSuggestJournals}
                  disabled={isSuggestingJournals}
                >
                  {isSuggestingJournals ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4 mr-1" />
                  )}
                  Re-analyze
                </Button>
              </div>

              {/* Journal cards */}
              <div className="space-y-3">
                {journalSuggestions.map((journal, index) => (
                  <Card key={journal.id} className="hover:shadow-md transition-shadow">
                    <CardContent className="py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="text-sm font-bold text-gray-400 w-6">
                              {index + 1}.
                            </span>
                            <h4 className="font-semibold text-base">
                              {journal.homepageUrl ? (
                                <a
                                  href={journal.homepageUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="hover:text-blue-600 hover:underline"
                                >
                                  {journal.name}
                                </a>
                              ) : (
                                journal.name
                              )}
                            </h4>
                            {getMatchBadge(journal.topicalMatch)}
                            {journal.isOpenAccess && (
                              <Badge variant="outline" className="bg-green-50 text-green-700 text-xs">
                                Open Access
                              </Badge>
                            )}
                            {journal.isInDoaj && (
                              <Badge variant="outline" className="bg-teal-50 text-teal-700 text-xs">
                                DOAJ
                              </Badge>
                            )}
                            {!journal.verified && (
                              <Badge variant="outline" className="bg-gray-50 text-gray-500 text-xs">
                                Unverified
                              </Badge>
                            )}
                          </div>

                          <p className="text-sm text-gray-500 ml-8">
                            {journal.publisher}
                            {journal.countryCode && ` \u00B7 ${journal.countryCode}`}
                            {journal.issnL && ` \u00B7 ISSN: ${journal.issnL}`}
                          </p>

                          {journal.reasoning && (
                            <p className="text-sm text-gray-600 mt-2 ml-8">
                              {journal.reasoning}
                            </p>
                          )}
                        </div>

                        {/* Metrics column */}
                        <div className="flex-shrink-0 text-right space-y-1">
                          {journal.impactFactor !== null && (
                            <div className="flex items-center gap-1.5 justify-end" title="2-year mean citedness (Impact Factor proxy)">
                              <TrendingUp className="h-3.5 w-3.5 text-amber-600" />
                              <span className="text-sm font-semibold text-amber-700">
                                {journal.impactFactor.toFixed(1)}
                              </span>
                              <span className="text-xs text-gray-400">IF</span>
                            </div>
                          )}
                          {journal.hIndex !== null && journal.hIndex > 0 && (
                            <div className="flex items-center gap-1.5 justify-end" title="H-Index">
                              <Award className="h-3.5 w-3.5 text-blue-600" />
                              <span className="text-sm font-medium text-blue-700">
                                {journal.hIndex}
                              </span>
                              <span className="text-xs text-gray-400">h</span>
                            </div>
                          )}
                          {journal.apcUsd !== null && journal.apcUsd > 0 && (
                            <div className="flex items-center gap-1.5 justify-end" title="Article Processing Charge">
                              <DollarSign className="h-3.5 w-3.5 text-gray-500" />
                              <span className="text-xs text-gray-600">
                                ${journal.apcUsd.toLocaleString()}
                              </span>
                            </div>
                          )}
                          {journal.worksCount > 0 && (
                            <div className="text-xs text-gray-400">
                              {journal.worksCount.toLocaleString()} articles
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Links row */}
                      {(journal.homepageUrl || journal.issnL) && (
                        <>
                          <Separator className="my-2" />
                          <div className="flex gap-2 ml-8">
                            {journal.homepageUrl && (
                              <a
                                href={journal.homepageUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                              >
                                <Globe className="h-3 w-3" />
                                Journal Homepage
                              </a>
                            )}
                            {journal.issnL && (
                              <a
                                href={`https://portal.issn.org/resource/ISSN/${journal.issnL}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                              >
                                <ExternalLink className="h-3 w-3" />
                                ISSN Portal
                              </a>
                            )}
                            {journal.verified && journal.id.startsWith("https://openalex.org/") && (
                              <a
                                href={journal.id}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                              >
                                <ExternalLink className="h-3 w-3" />
                                OpenAlex
                              </a>
                            )}
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>

              {journalSuggestions.length === 0 && (
                <Card>
                  <CardContent className="py-8 text-center text-gray-500">
                    No matching journals found. Try uploading a manuscript with a more detailed abstract.
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
