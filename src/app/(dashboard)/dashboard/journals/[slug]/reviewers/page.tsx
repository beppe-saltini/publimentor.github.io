"use client";

import { useState, useEffect, Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { 
  Search, User, Building, BookOpen, Award, Globe, Loader2, 
  ExternalLink, Copy, CheckCircle, FileText, Wand2, AlertTriangle,
  Users, Sparkles, Mail, MapPin, GraduationCap, FlaskConical,
  Download, Info
} from "lucide-react";
import { toast } from "sonner";
import { ManuscriptSelector } from "@/components/manuscript";

interface ParsedAuthor {
  fullName: string;
  surname: string;
  firstName: string;
  pubmedFormat: string;
  scholarFormat: string;
}

interface SearchStrings {
  parsedAuthors: ParsedAuthor[];
  pubmed: { searchString: string; url: string };
  googleScholar: { searchString: string; url: string };
  openAlex: { queries: string[] };
}

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
  orcid?: string;
  coauthorCount?: number;
  topics?: string[];
}

interface CoauthorWarning {
  name: string;
  coauthorCount: number;
}

interface Reviewer {
  id: string;
  name: string;
  orcid: string | null;
  worksCount: number;
  citedByCount: number;
  hIndex: number | null;
  institution: string | null;
  country: string | null;
  topics: string[];
}

interface SearchMeta {
  count: number;
  page: number;
  perPage: number;
  totalPages: number;
}

// Advanced discovery types
interface AdvancedReviewer {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  affiliation: string;
  country: string;
  hIndex: number | null;
  citationCount: number | null;
  publicationCount: number;
  firstAuthorCount: number;
  lastAuthorCount: number;
  correspondingCount: number;
  seniorAuthorCount: number;
  recentArticles: {
    title: string;
    journal: string;
    year: string;
    pmid: string;
    position: "first" | "last" | "middle";
  }[];
  sources: ("PubMed" | "SemanticScholar" | "OpenAlex")[];
  verificationUrls: {
    pubmedSearchUrl: string;
    googleScholarUrl: string;
    institutionSearchUrl: string;
    semanticScholarUrl?: string;
    openAlexUrl?: string;
  };
  // LLM-enhanced fields
  llmAnalysis?: {
    relevanceScore: number;
    reasoning: string;
    topicalMatch: "excellent" | "good" | "moderate" | "weak";
    seniorityAssessment: string;
    recommendation: "highly_recommended" | "recommended" | "consider" | "not_recommended";
    expertise?: string[];
  };
}

interface DiscoverySummary {
  totalFound: number;
  returned: number;
  criteria: {
    minPublications: number;
    maxPublications: number;
    yearsActive: number;
    requireSeniorAuthor: boolean;
  };
  diversity: {
    countries: string[];
    countryCount: number;
  };
  avgPublications: number;
  avgSeniorAuthorships: number;
  llmEnhanced?: boolean;
}

interface DiscoveryResult {
  reviewers: AdvancedReviewer[];
  summary: DiscoverySummary;
  relatedConcepts: { id: string; display_name: string; relevance: number }[];
  disclaimer: string;
  selectionCriteria: Record<string, string | boolean>;
}

function ReviewerSearchContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const slug = params.slug as string;
  const submissionId = searchParams.get("submissionId");

  // Search string generator state
  const [authorList, setAuthorList] = useState("");
  const [keywords, setKeywords] = useState("");
  const [reviewerName, setReviewerName] = useState("");
  const [searchStrings, setSearchStrings] = useState<SearchStrings | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Auto-populated reviewers state
  const [candidateReviewers, setCandidateReviewers] = useState<ReviewerCandidate[]>([]);
  const [coauthorWarnings, setCoauthorWarnings] = useState<CoauthorWarning[]>([]);
  const [isFindingReviewers, setIsFindingReviewers] = useState(false);

  // OpenAlex search state
  const [query, setQuery] = useState("");
  const [minWorks, setMinWorks] = useState("10");
  const [minCitations, setMinCitations] = useState("50");
  const [reviewers, setReviewers] = useState<Reviewer[]>([]);
  const [meta, setMeta] = useState<SearchMeta | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  // Manuscript source state
  const [selectedManuscriptId, setSelectedManuscriptId] = useState<string | null>(null);

  // Advanced discovery state
  const [primaryKeywords, setPrimaryKeywords] = useState("");
  const [secondaryKeywords, setSecondaryKeywords] = useState("");
  const [minHIndex, setMinHIndex] = useState(0);
  const [maxHIndex, setMaxHIndex] = useState(100);
  const [minPublications, setMinPublications] = useState(3);
  const [maxPublications, setMaxPublications] = useState(100);
  const [yearsActive, setYearsActive] = useState(5);
  const [requireSeniorAuthor, setRequireSeniorAuthor] = useState(true);
  const [maxResults, setMaxResults] = useState(10);
  const [diversifyGeo, setDiversifyGeo] = useState(true);
  const [avoidSameInstitution, setAvoidSameInstitution] = useState(true);
  const [useLLM, setUseLLM] = useState(true); // Use AI ranking
  const [discoveryResult, setDiscoveryResult] = useState<DiscoveryResult | null>(null);
  const [isDiscovering, setIsDiscovering] = useState(false);

  // Submission state
  const [submission, setSubmission] = useState<{
    id: string;
    title: string;
    authors: { id: string; name: string; orcid: string | null }[];
  } | null>(null);

  // Load submission if submissionId provided
  useEffect(() => {
    if (submissionId) {
      fetch(`/api/journals/${slug}/submissions/${submissionId}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.submission) {
            setSubmission(data.submission);
            const authorNames = data.submission.authors
              .map((a: { name: string }) => a.name)
              .join(", ");
            setAuthorList(authorNames);
          }
        })
        .catch(console.error);
    }
  }, [slug, submissionId]);

  // Generate search strings
  const handleGenerateStrings = async () => {
    if (!authorList.trim()) {
      toast.error("Please enter an author list");
      return;
    }

    setIsGenerating(true);
    try {
      const response = await fetch("/api/search-string", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authorList: authorList.trim(),
          reviewerName: reviewerName.trim() || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to generate search strings");
      }

      setSearchStrings(data);
      toast.success(`Parsed ${data.parsedAuthors.length} authors`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Generation failed");
    } finally {
      setIsGenerating(false);
    }
  };

  // Find reviewers automatically from PubMed and OpenAlex
  const handleFindReviewers = async () => {
    if (!keywords.trim()) {
      toast.error("Please enter keywords to search for reviewers");
      return;
    }

    setIsFindingReviewers(true);
    setCandidateReviewers([]);
    setCoauthorWarnings([]);

    try {
      const response = await fetch("/api/reviewers/find", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authorList: authorList.trim() || undefined,
          keywords: keywords.split(",").map(k => k.trim()).filter(Boolean),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to find reviewers");
      }

      setCandidateReviewers(data.reviewers);
      setCoauthorWarnings(data.coauthors || []);
      
      toast.success(
        `Found ${data.reviewers.length} potential reviewers from PubMed and OpenAlex`
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Search failed");
    } finally {
      setIsFindingReviewers(false);
    }
  };

  // Advanced reviewer discovery
  const handleAdvancedDiscovery = async () => {
    if (!primaryKeywords.trim()) {
      toast.error("Please enter primary expertise keywords");
      return;
    }

    setIsDiscovering(true);
    setDiscoveryResult(null);

    try {
      const response = await fetch("/api/reviewers/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          primaryKeywords: primaryKeywords.split(",").map(k => k.trim()).filter(Boolean),
          secondaryKeywords: secondaryKeywords 
            ? secondaryKeywords.split(",").map(k => k.trim()).filter(Boolean) 
            : undefined,
          minHIndex,
          maxHIndex,
          minPublications,
          maxPublications,
          yearsActive,
          requireSeniorAuthor,
          maxResults,
          manuscriptAuthors: authorList.trim() || undefined,
          diversifyGeo,
          avoidSameInstitution,
          useLLM,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to discover reviewers");
      }

      setDiscoveryResult(data);
      
      toast.success(
        `Found ${data.reviewers.length} senior reviewers from ${data.summary.diversity.countryCount} countries`
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Discovery failed");
    } finally {
      setIsDiscovering(false);
    }
  };

  // Export discovery results
  const exportDiscoveryResults = () => {
    if (!discoveryResult) return;

    const lines: string[] = [
      "REVIEWER DISCOVERY RESULTS",
      "=" .repeat(60),
      "",
      "SELECTION CRITERIA SATISFIED",
      `-  ${discoveryResult.summary.criteria.minPublications}-${discoveryResult.summary.criteria.maxPublications} publications`,
      `-  Active research in last ${discoveryResult.summary.criteria.yearsActive} years`,
      discoveryResult.summary.criteria.requireSeniorAuthor 
        ? "-  Senior author (first/last) publications required" 
        : "",
      "-  PubMed and Google Scholar verification available",
      "-  No duplicate institutions",
      diversifyGeo ? "-  Geographically diversified" : "",
      "",
      `DIVERSITY: ${discoveryResult.summary.diversity.countryCount} countries represented`,
      `AVERAGE PUBLICATIONS: ${discoveryResult.summary.avgPublications}`,
      `AVERAGE SENIOR AUTHORSHIPS: ${discoveryResult.summary.avgSeniorAuthorships}`,
      "",
      "=" .repeat(60),
      "",
    ];

    discoveryResult.reviewers.forEach((r, i) => {
      lines.push(`${i + 1}. ${r.name}`);
      lines.push(`   Affiliation: ${r.affiliation}`);
      lines.push(`   Country: ${r.country}`);
      lines.push(`   H-Index: ${r.hIndex !== null ? r.hIndex : "N/A"} | Citations: ${r.citationCount !== null ? r.citationCount.toLocaleString() : "N/A"}`);
      lines.push(`   Publications: ${r.publicationCount} | First Author: ${r.firstAuthorCount} | Last/PI: ${r.lastAuthorCount} | Total Senior: ${r.seniorAuthorCount}`);
      lines.push(`   Sources: ${r.sources.join(", ")}`);
      lines.push(`   PubMed: ${r.verificationUrls.pubmedSearchUrl}`);
      lines.push(`   Google Scholar: ${r.verificationUrls.googleScholarUrl}`);
      if (r.verificationUrls.semanticScholarUrl) {
        lines.push(`   Semantic Scholar: ${r.verificationUrls.semanticScholarUrl}`);
      }
      lines.push(`   Find email: ${r.verificationUrls.institutionSearchUrl}`);
      lines.push("");
    });

    lines.push("=" .repeat(60));
    lines.push("DISCLAIMER");
    lines.push(discoveryResult.disclaimer);

    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reviewer-discovery-${new Date().toISOString().split("T")[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Results exported");
  };

  // Copy to clipboard
  const copyToClipboard = async (text: string, field: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopiedField(null), 2000);
  };

  // OpenAlex search
  const handleSearch = async (page = 1) => {
    if (!query.trim()) {
      toast.error("Please enter a search query");
      return;
    }

    setIsSearching(true);

    try {
      const params = new URLSearchParams({
        query: query.trim(),
        page: String(page),
        perPage: "20",
        minWorks,
        minCitations,
      });

      const response = await fetch(`/api/reviewers/search?${params}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Search failed");
      }

      setReviewers(data.reviewers);
      setMeta(data.meta);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Search failed");
    } finally {
      setIsSearching(false);
    }
  };

  // Check if a name is a known co-author (potential COI)
  const isCoauthor = (name: string): number | undefined => {
    const warning = coauthorWarnings.find(
      c => name.toLowerCase().includes(c.name.toLowerCase()) ||
           c.name.toLowerCase().includes(name.toLowerCase())
    );
    return warning?.coauthorCount;
  };

  // Get source badge color
  const getSourceBadge = (source: string) => {
    switch (source) {
      case "both":
        return <Badge className="bg-green-100 text-green-800">PubMed + OpenAlex</Badge>;
      case "pubmed":
        return <Badge className="bg-blue-100 text-blue-800">PubMed</Badge>;
      case "openalex":
        return <Badge className="bg-purple-100 text-purple-800">OpenAlex</Badge>;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Reviewer Recommendations</h1>
        <p className="text-gray-500">
          Discover potential reviewers from PubMed and OpenAlex databases for editorial consideration
        </p>
      </div>

      {/* Automated Screening Notice */}
      <Card className="bg-amber-50 border-amber-200">
        <CardContent className="py-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-amber-800">
              <p className="font-medium">Recommendation Notice</p>
              <p className="text-amber-700">
                These are automated suggestions for editorial consideration, not automated assignments.
                All potential reviewers require verification of independence and suitability before invitation.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {submission && (
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="py-4">
            <p className="text-sm text-blue-800">
              <span className="font-medium">Finding reviewers for:</span>{" "}
              {submission.title}
            </p>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="advanced" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="advanced">
            <FlaskConical className="h-4 w-4 mr-2" />
            Advanced Discovery
          </TabsTrigger>
          <TabsTrigger value="auto-find">
            <Sparkles className="h-4 w-4 mr-2" />
            Quick Find
          </TabsTrigger>
          <TabsTrigger value="generator">
            <Wand2 className="h-4 w-4 mr-2" />
            Search Strings
          </TabsTrigger>
          <TabsTrigger value="openalex">
            <Search className="h-4 w-4 mr-2" />
            Manual Search
          </TabsTrigger>
        </TabsList>

        {/* Advanced Discovery Tab */}
        <TabsContent value="advanced" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FlaskConical className="h-5 w-5" />
                Senior Expert Discovery
              </CardTitle>
              <CardDescription>
                Find senior reviewers with high h-index, recent corresponding author publications in reputable journals,
                diversified by geography and gender. Results include verification links.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Manuscript Source */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Source Manuscript (optional)
                </Label>
                <ManuscriptSelector
                  value={selectedManuscriptId || undefined}
                  onChange={(m) => setSelectedManuscriptId(m?.id || null)}
                  onManuscriptData={(data) => {
                    // Auto-populate keywords from manuscript
                    if (data.keywords.length > 0) {
                      setPrimaryKeywords(data.keywords.slice(0, 3).join(", "));
                      if (data.keywords.length > 3) {
                        setSecondaryKeywords(data.keywords.slice(3).join(", "));
                      }
                    }
                    // Auto-populate author list for COI checking
                    if (data.authors.length > 0) {
                      setAuthorList(data.authors.map(a => a.name).join(", "));
                    }
                  }}
                  placeholder="Select manuscript to extract keywords"
                />
                <p className="text-xs text-gray-500">
                  Keywords and authors will be extracted automatically
                </p>
              </div>

              <Separator />

              {/* Keywords Section */}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="primaryKeywords">Primary Expertise (required)</Label>
                  <Input
                    id="primaryKeywords"
                    placeholder="e.g., tuberculosis epidemiology"
                    value={primaryKeywords}
                    onChange={(e) => setPrimaryKeywords(e.target.value)}
                  />
                  <p className="text-xs text-gray-500">
                    Main research area (comma-separated for multiple)
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="secondaryKeywords">Secondary Expertise (optional)</Label>
                  <Input
                    id="secondaryKeywords"
                    placeholder="e.g., mathematical modelling, transmission dynamics"
                    value={secondaryKeywords}
                    onChange={(e) => setSecondaryKeywords(e.target.value)}
                  />
                  <p className="text-xs text-gray-500">
                    Additional desired skills
                  </p>
                </div>
              </div>

              {/* Manuscript Authors to Exclude */}
              <div className="space-y-2">
                <Label htmlFor="authorListAdvanced">Manuscript Authors (to exclude)</Label>
                <Textarea
                  id="authorListAdvanced"
                  placeholder="e.g., John Smith, Jane Doe PhD, Prof. Robert Johnson"
                  value={authorList}
                  onChange={(e) => setAuthorList(e.target.value)}
                  rows={2}
                  className="font-mono text-sm"
                />
              </div>

              <Separator />

              {/* Criteria Section */}
              <div className="grid gap-6 md:grid-cols-2">
                {/* H-Index Range */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-1">
                      <Award className="h-4 w-4" />
                      H-Index Range
                    </Label>
                    <span className="text-sm font-medium bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                      {minHIndex} - {maxHIndex >= 100 ? "∞" : maxHIndex}
                    </span>
                  </div>
                  <Slider
                    value={[minHIndex, maxHIndex]}
                    onValueChange={(v) => {
                      setMinHIndex(v[0]);
                      setMaxHIndex(v[1]);
                    }}
                    min={0}
                    max={100}
                    step={5}
                    className="w-full"
                  />
                  <p className="text-xs text-gray-500">
                    H-index from Semantic Scholar / OpenAlex
                  </p>
                </div>

                {/* Publications Range */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-1">
                      <BookOpen className="h-4 w-4" />
                      Publications Range
                    </Label>
                    <span className="text-sm font-medium bg-gray-100 px-2 py-0.5 rounded">
                      {minPublications} - {maxPublications >= 100 ? "∞" : maxPublications}
                    </span>
                  </div>
                  <Slider
                    value={[minPublications, maxPublications]}
                    onValueChange={(v) => {
                      setMinPublications(v[0]);
                      setMaxPublications(v[1]);
                    }}
                    min={1}
                    max={100}
                    step={1}
                    className="w-full"
                  />
                  <p className="text-xs text-gray-500">
                    Number of publications in the specified time period
                  </p>
                </div>
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Active in last</Label>
                    <span className="text-sm font-medium bg-gray-100 px-2 py-0.5 rounded">
                      {yearsActive} years
                    </span>
                  </div>
                  <Slider
                    value={[yearsActive]}
                    onValueChange={(v) => setYearsActive(v[0])}
                    min={2}
                    max={10}
                    step={1}
                    className="w-full"
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Results</Label>
                    <span className="text-sm font-medium bg-gray-100 px-2 py-0.5 rounded">
                      {maxResults}
                    </span>
                  </div>
                  <Slider
                    value={[maxResults]}
                    onValueChange={(v) => setMaxResults(v[0])}
                    min={5}
                    max={30}
                    step={5}
                    className="w-full"
                  />
                </div>
              </div>

              <Separator />

              {/* Toggle Options */}
              <div className="grid gap-4 md:grid-cols-4">
                <div className="flex items-center justify-between space-x-2 p-3 bg-purple-50 rounded-lg border border-purple-200">
                  <div>
                    <Label htmlFor="useLLM" className="text-sm font-medium text-purple-800">
                      AI Ranking (Claude)
                    </Label>
                    <p className="text-xs text-purple-600">Smart topical matching</p>
                  </div>
                  <Switch
                    id="useLLM"
                    checked={useLLM}
                    onCheckedChange={setUseLLM}
                  />
                </div>

                <div className="flex items-center justify-between space-x-2 p-3 bg-gray-50 rounded-lg">
                  <div>
                    <Label htmlFor="requireSeniorAuthor" className="text-sm">
                      Senior Author Required
                    </Label>
                    <p className="text-xs text-gray-500">First or last author papers</p>
                  </div>
                  <Switch
                    id="requireSeniorAuthor"
                    checked={requireSeniorAuthor}
                    onCheckedChange={setRequireSeniorAuthor}
                  />
                </div>

                <div className="flex items-center justify-between space-x-2 p-3 bg-gray-50 rounded-lg">
                  <div>
                    <Label htmlFor="diversifyGeo" className="text-sm">
                      Geographic Diversity
                    </Label>
                    <p className="text-xs text-gray-500">Spread across countries</p>
                  </div>
                  <Switch
                    id="diversifyGeo"
                    checked={diversifyGeo}
                    onCheckedChange={setDiversifyGeo}
                  />
                </div>

                <div className="flex items-center justify-between space-x-2 p-3 bg-gray-50 rounded-lg">
                  <div>
                    <Label htmlFor="avoidSameInstitution" className="text-sm">
                      No Duplicate Institutions
                    </Label>
                    <p className="text-xs text-gray-500">One per institution</p>
                  </div>
                  <Switch
                    id="avoidSameInstitution"
                    checked={avoidSameInstitution}
                    onCheckedChange={setAvoidSameInstitution}
                  />
                </div>
              </div>

              <Button 
                onClick={handleAdvancedDiscovery} 
                disabled={isDiscovering} 
                size="lg"
                className="w-full"
              >
                {isDiscovering ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Search className="h-4 w-4 mr-2" />
                )}
                Discover Senior Reviewers
              </Button>
            </CardContent>
          </Card>

          {/* Discovery Results */}
          {discoveryResult && (
            <>
              {/* Summary Card */}
              <Card className={discoveryResult.summary.llmEnhanced ? "bg-purple-50 border-purple-200" : "bg-green-50 border-green-200"}>
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className={`font-semibold ${discoveryResult.summary.llmEnhanced ? "text-purple-800" : "text-green-800"}`}>
                        {discoveryResult.summary.llmEnhanced ? "🤖 AI-Suggested Reviewers" : "Database Search Results"}
                      </h3>
                      <ul className={`text-sm mt-1 space-y-0.5 ${discoveryResult.summary.llmEnhanced ? "text-purple-700" : "text-green-700"}`}>
                        {discoveryResult.summary.llmEnhanced && (
                          <>
                            <li>✓ Claude AI suggested experts in this field</li>
                            <li>✓ Verified against PubMed, Semantic Scholar, OpenAlex</li>
                          </>
                        )}
                        {(discoveryResult.summary as Record<string, unknown>).avgHIndex !== null && (
                          <li>✓ Avg H-index: {(discoveryResult.summary as Record<string, unknown>).avgHIndex as number}</li>
                        )}
                        <li>✓ Avg {discoveryResult.summary.avgPublications} publications per reviewer</li>
                        <li>✓ Avg {discoveryResult.summary.avgSeniorAuthorships} senior author papers</li>
                        <li>✓ {discoveryResult.summary.diversity.countryCount} countries represented</li>
                      </ul>
                      <div className="flex gap-2 mt-2 flex-wrap">
                        {discoveryResult.summary.llmEnhanced && (
                          <Badge variant="outline" className="bg-purple-100 text-purple-700">
                            <Sparkles className="h-3 w-3 mr-1" />
                            AI-Suggested
                          </Badge>
                        )}
                        {(discoveryResult.summary as Record<string, unknown>).dataSources && (
                          <>
                            {((discoveryResult.summary as Record<string, unknown>).dataSources as Record<string, number>).semanticScholar > 0 && (
                              <Badge variant="outline" className="bg-orange-50 text-orange-700">
                                Semantic Scholar
                              </Badge>
                            )}
                            {((discoveryResult.summary as Record<string, unknown>).dataSources as Record<string, number>).openAlex > 0 && (
                              <Badge variant="outline" className="bg-teal-50 text-teal-700">
                                OpenAlex
                              </Badge>
                            )}
                            <Badge variant="outline" className="bg-blue-50 text-blue-700">
                              PubMed
                            </Badge>
                          </>
                        )}
                      </div>
                      {(discoveryResult.summary as Record<string, unknown>).searchStrategy && (
                        <p className="text-xs text-purple-600 mt-2 italic">
                          Strategy: {(discoveryResult.summary as Record<string, unknown>).searchStrategy as string}
                        </p>
                      )}
                    </div>
                    <Button variant="outline" onClick={exportDiscoveryResults}>
                      <Download className="h-4 w-4 mr-2" />
                      Export List
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Results Header */}
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold">
                    {discoveryResult.reviewers.length} Reviewers Found
                  </h3>
                  <p className="text-sm text-gray-500">
                    From {discoveryResult.summary.diversity.countryCount} countries • 
                    Avg publications: {discoveryResult.summary.avgPublications} • 
                    Avg senior authorships: {discoveryResult.summary.avgSeniorAuthorships}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Badge variant="outline" className="bg-blue-50">
                    <Globe className="h-3 w-3 mr-1" />
                    {discoveryResult.summary.diversity.countries.slice(0, 3).join(", ")}
                    {discoveryResult.summary.diversity.countries.length > 3 && " +more"}
                  </Badge>
                </div>
              </div>

              {/* Reviewer Cards */}
              <div className="grid gap-4 md:grid-cols-2">
                {discoveryResult.reviewers.map((reviewer, index) => (
                  <Card key={reviewer.id} className="hover:shadow-md transition-shadow">
                    <CardContent className="pt-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-start gap-3">
                          <div className="bg-blue-100 rounded-full p-2 flex-shrink-0">
                            <span className="text-sm font-bold text-blue-700">{index + 1}</span>
                          </div>
                          <div>
                            <h4 className="font-semibold">{reviewer.name}</h4>
                            <p className="text-sm text-gray-500 flex items-center gap-1">
                              <Building className="h-3 w-3" />
                              {reviewer.affiliation.slice(0, 60)}{reviewer.affiliation.length > 60 ? "..." : ""}
                            </p>
                            <p className="text-sm text-gray-400 flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {reviewer.country}
                            </p>
                          </div>
                        </div>
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
                        ) : (
                          <Badge variant="outline" className="bg-blue-50 text-blue-700 text-xs">
                            PubMed
                          </Badge>
                        )}
                      </div>

                      {/* AI Analysis */}
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
                                <Badge key={i} variant="secondary" className="text-xs bg-purple-100 text-purple-700">
                                  {exp}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Metrics */}
                      <div className="grid grid-cols-5 gap-2 text-center text-xs mb-3">
                        <div className="bg-amber-50 rounded p-2 border border-amber-200" title="H-Index from Semantic Scholar/OpenAlex">
                          <p className="font-bold text-lg text-amber-700">
                            {reviewer.hIndex !== null ? reviewer.hIndex : "—"}
                          </p>
                          <p className="text-gray-500">H-Index</p>
                        </div>
                        <div className="bg-gray-50 rounded p-2">
                          <p className="font-bold text-lg">{reviewer.publicationCount}</p>
                          <p className="text-gray-500">Pubs</p>
                        </div>
                        <div className="bg-blue-50 rounded p-2" title="First author papers">
                          <p className="font-bold text-blue-700">{reviewer.firstAuthorCount}</p>
                          <p className="text-gray-500">1st Auth</p>
                        </div>
                        <div className="bg-purple-50 rounded p-2" title="Last/PI author papers">
                          <p className="font-bold text-purple-700">{reviewer.lastAuthorCount}</p>
                          <p className="text-gray-500">Last/PI</p>
                        </div>
                        <div className="bg-green-50 rounded p-2" title="Total senior author papers">
                          <p className="font-bold text-green-700">{reviewer.seniorAuthorCount}</p>
                          <p className="text-gray-500">Senior</p>
                        </div>
                      </div>
                      
                      {/* Data Sources */}
                      <div className="flex gap-1 mb-2">
                        {reviewer.sources.map((source, i) => (
                          <Badge key={i} variant="outline" className="text-xs">
                            {source}
                          </Badge>
                        ))}
                      </div>

                      {/* Recent Articles */}
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
                                      article.position === "first" ? "bg-blue-50 text-blue-700" :
                                      article.position === "last" ? "bg-purple-50 text-purple-700" :
                                      "bg-gray-100"
                                    }`}
                                  >
                                    {article.position === "first" ? "1st" : article.position === "last" ? "Last" : "Mid"}
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

                      <Separator className="my-3" />

                      {/* Verification Links */}
                      <div className="flex flex-wrap gap-2">
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
                        <Button variant="outline" size="sm" asChild>
                          <a 
                            href={reviewer.verificationUrls.institutionSearchUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                          >
                            <Mail className="h-3 w-3 mr-1" />
                            Find Email
                          </a>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Disclaimer */}
              <Card className="bg-amber-50 border-amber-200">
                <CardContent className="py-3">
                  <div className="flex items-start gap-2">
                    <Info className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
                    <div className="text-sm text-amber-800">
                      <p className="font-medium">Important Notice</p>
                      <p className="text-amber-700">{discoveryResult.disclaimer}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* Auto-Find Reviewers Tab */}
        <TabsContent value="auto-find" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                Automatic Reviewer Discovery
              </CardTitle>
              <CardDescription>
                Enter keywords related to the manuscript topic. The system will search PubMed and OpenAlex 
                to find experts and automatically populate the reviewer list.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="keywords">Research Keywords (comma-separated)</Label>
                <Input
                  id="keywords"
                  placeholder="e.g., machine learning, neural networks, deep learning"
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleFindReviewers()}
                />
                <p className="text-xs text-gray-500">
                  Enter 2-5 keywords that describe the research topic
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="authorListAuto">Manuscript Authors (optional - to exclude)</Label>
                <Textarea
                  id="authorListAuto"
                  placeholder="e.g., John Smith, Jane Doe PhD, Prof. Robert Johnson"
                  value={authorList}
                  onChange={(e) => setAuthorList(e.target.value)}
                  rows={2}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-gray-500">
                  Manuscript authors will be excluded from results and checked for co-authorship conflicts
                </p>
              </div>

              <Button onClick={handleFindReviewers} disabled={isFindingReviewers} size="lg">
                {isFindingReviewers ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Search className="h-4 w-4 mr-2" />
                )}
                Find Reviewers from PubMed & OpenAlex
              </Button>
            </CardContent>
          </Card>

          {/* Co-author Warnings */}
          {coauthorWarnings.length > 0 && (
            <Card className="border-amber-200 bg-amber-50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-amber-800">
                  <AlertTriangle className="h-5 w-5" />
                  Potential Overlap Indicators — Verify Independence
                </CardTitle>
                <CardDescription className="text-amber-700">
                  These researchers appear to have co-authored with manuscript authors. 
                  Editorial review recommended before invitation.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {coauthorWarnings.slice(0, 20).map((warning, i) => (
                    <Badge key={i} variant="outline" className="border-amber-400 text-amber-800">
                      {warning.name} ({warning.coauthorCount} shared papers)
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-amber-600 mt-3 italic">
                  This is automated screening only. Verify before making editorial decisions.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Candidate Reviewers List */}
          {candidateReviewers.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold">
                    {candidateReviewers.length} Reviewer Suggestions
                  </h3>
                  <p className="text-sm text-gray-500">
                    For editorial consideration — verify suitability and independence before invitation
                  </p>
                </div>
                <div className="flex gap-2">
                  <Badge variant="outline" className="bg-green-50">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    {candidateReviewers.filter(r => r.source === "both").length} in both databases
                  </Badge>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {candidateReviewers.map((reviewer) => {
                  const coauthorCount = isCoauthor(reviewer.name);
                  
                  return (
                    <Card 
                      key={reviewer.id} 
                      className={coauthorCount ? "border-amber-300 bg-amber-50" : ""}
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
                          {coauthorCount && (
                            <Badge variant="outline" className="border-amber-400 text-amber-700 text-xs" title="Potential overlap - verify independence">
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              Review
                            </Badge>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-1 mb-3">
                          {getSourceBadge(reviewer.source)}
                          {reviewer.hIndex && (
                            <Badge variant="secondary" className="text-xs">
                              h-index: {reviewer.hIndex}
                            </Badge>
                          )}
                        </div>

                        {(reviewer.worksCount || reviewer.citedByCount) && (
                          <div className="grid grid-cols-2 gap-2 text-center text-xs mb-3">
                            {reviewer.worksCount && (
                              <div className="bg-gray-50 rounded p-2">
                                <p className="font-semibold">{reviewer.worksCount}</p>
                                <p className="text-gray-500">Publications</p>
                              </div>
                            )}
                            {reviewer.citedByCount && (
                              <div className="bg-gray-50 rounded p-2">
                                <p className="font-semibold">{reviewer.citedByCount.toLocaleString()}</p>
                                <p className="text-gray-500">Citations</p>
                              </div>
                            )}
                          </div>
                        )}

                        {reviewer.topics && reviewer.topics.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {reviewer.topics.slice(0, 3).map((topic, i) => (
                              <Badge key={i} variant="outline" className="text-xs">
                                {topic}
                              </Badge>
                            ))}
                          </div>
                        )}

                        {reviewer.orcid && (
                          <p className="mt-2 text-xs text-gray-400">
                            ORCID: {reviewer.orcid.replace("https://orcid.org/", "")}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </>
          )}
        </TabsContent>

        {/* Search String Generator Tab */}
        <TabsContent value="generator" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Author List Input</CardTitle>
              <CardDescription>
                Paste the author list from the manuscript. The tool will parse names and generate search strings for PubMed and Google Scholar.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="authorList">Author List (from manuscript)</Label>
                <Textarea
                  id="authorList"
                  placeholder="e.g., Alan Bronson1, Lady Carina D. Elephant2, Sir Felix Gerald Horton Jr.3, Prof. Pedro Quesadilla-Rodríguez PhD"
                  value={authorList}
                  onChange={(e) => setAuthorList(e.target.value)}
                  rows={4}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-gray-500">
                  Supports various formats: titles (Dr., Prof.), suffixes (Jr., PhD), affiliations (superscript numbers), and special characters
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="reviewerName">Reviewer Name (optional)</Label>
                <Input
                  id="reviewerName"
                  placeholder="e.g., John Smith"
                  value={reviewerName}
                  onChange={(e) => setReviewerName(e.target.value)}
                />
                <p className="text-xs text-gray-500">
                  Enter a specific reviewer name to check for co-authorship
                </p>
              </div>

              <Button onClick={handleGenerateStrings} disabled={isGenerating}>
                {isGenerating ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Wand2 className="h-4 w-4 mr-2" />
                )}
                Generate Search Strings
              </Button>
            </CardContent>
          </Card>

          {searchStrings && (
            <>
              {/* Parsed Authors */}
              <Card>
                <CardHeader>
                  <CardTitle>Parsed Authors ({searchStrings.parsedAuthors.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {searchStrings.parsedAuthors.map((author, i) => (
                      <Badge key={i} variant="secondary" className="py-1">
                        {author.fullName} → {author.pubmedFormat.replace("[au]", "")}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* PubMed */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <FileText className="h-5 w-5" />
                      PubMed Search
                    </CardTitle>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copyToClipboard(searchStrings.pubmed.searchString, "pubmed")}
                      >
                        {copiedField === "pubmed" ? (
                          <CheckCircle className="h-4 w-4 mr-1 text-green-600" />
                        ) : (
                          <Copy className="h-4 w-4 mr-1" />
                        )}
                        Copy
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        asChild
                      >
                        <a href={searchStrings.pubmed.url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-4 w-4 mr-1" />
                          Open
                        </a>
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <pre className="bg-gray-100 p-3 rounded-md text-sm overflow-x-auto whitespace-pre-wrap">
                    {searchStrings.pubmed.searchString}
                  </pre>
                </CardContent>
              </Card>

              {/* Google Scholar */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <BookOpen className="h-5 w-5" />
                      Google Scholar Search
                    </CardTitle>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copyToClipboard(searchStrings.googleScholar.searchString, "scholar")}
                      >
                        {copiedField === "scholar" ? (
                          <CheckCircle className="h-4 w-4 mr-1 text-green-600" />
                        ) : (
                          <Copy className="h-4 w-4 mr-1" />
                        )}
                        Copy
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        asChild
                      >
                        <a href={searchStrings.googleScholar.url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-4 w-4 mr-1" />
                          Open
                        </a>
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <pre className="bg-gray-100 p-3 rounded-md text-sm overflow-x-auto whitespace-pre-wrap">
                    {searchStrings.googleScholar.searchString}
                  </pre>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* Manual OpenAlex Search Tab */}
        <TabsContent value="openalex" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>OpenAlex Academic Search</CardTitle>
              <CardDescription>
                Search for potential reviewers by research topic, keywords, or author name
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex gap-4">
                  <div className="flex-1">
                    <Label htmlFor="query">Search Query</Label>
                    <Input
                      id="query"
                      placeholder="e.g., machine learning, cancer research, quantum computing"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    />
                  </div>
                </div>

                <div className="flex gap-4">
                  <div>
                    <Label htmlFor="minWorks">Min. Publications</Label>
                    <Input
                      id="minWorks"
                      type="number"
                      value={minWorks}
                      onChange={(e) => setMinWorks(e.target.value)}
                      className="w-32"
                    />
                  </div>
                  <div>
                    <Label htmlFor="minCitations">Min. Citations</Label>
                    <Input
                      id="minCitations"
                      type="number"
                      value={minCitations}
                      onChange={(e) => setMinCitations(e.target.value)}
                      className="w-32"
                    />
                  </div>
                  <div className="flex items-end">
                    <Button onClick={() => handleSearch()} disabled={isSearching}>
                      {isSearching ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Search className="h-4 w-4 mr-2" />
                      )}
                      Search
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {meta && (
            <p className="text-sm text-gray-500">
              Found {meta.count.toLocaleString()} potential reviewers
            </p>
          )}

          {reviewers.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2">
              {reviewers.map((reviewer) => (
                <Card key={reviewer.id}>
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <div className="bg-gray-100 rounded-full p-2">
                          <User className="h-5 w-5 text-gray-600" />
                        </div>
                        <div>
                          <h3 className="font-semibold">{reviewer.name}</h3>
                          {reviewer.institution && (
                            <p className="text-sm text-gray-500 flex items-center gap-1">
                              <Building className="h-3 w-3" />
                              {reviewer.institution}
                              {reviewer.country && ` (${reviewer.country})`}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    <Separator className="my-4" />

                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div>
                        <div className="flex items-center justify-center gap-1 text-gray-500">
                          <BookOpen className="h-4 w-4" />
                        </div>
                        <p className="font-semibold">{reviewer.worksCount}</p>
                        <p className="text-xs text-gray-500">Publications</p>
                      </div>
                      <div>
                        <div className="flex items-center justify-center gap-1 text-gray-500">
                          <Globe className="h-4 w-4" />
                        </div>
                        <p className="font-semibold">{reviewer.citedByCount.toLocaleString()}</p>
                        <p className="text-xs text-gray-500">Citations</p>
                      </div>
                      <div>
                        <div className="flex items-center justify-center gap-1 text-gray-500">
                          <Award className="h-4 w-4" />
                        </div>
                        <p className="font-semibold">{reviewer.hIndex || "N/A"}</p>
                        <p className="text-xs text-gray-500">h-index</p>
                      </div>
                    </div>

                    {reviewer.topics.length > 0 && (
                      <div className="mt-4">
                        <p className="text-xs text-gray-500 mb-2">Research Topics</p>
                        <div className="flex flex-wrap gap-1">
                          {reviewer.topics.map((topic, i) => (
                            <Badge key={i} variant="secondary" className="text-xs">
                              {topic}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {reviewer.orcid && (
                      <p className="mt-3 text-xs text-gray-500">
                        ORCID: {reviewer.orcid.replace("https://orcid.org/", "")}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {meta && meta.totalPages > 1 && (
            <div className="flex justify-center gap-2">
              <Button
                variant="outline"
                disabled={meta.page <= 1 || isSearching}
                onClick={() => handleSearch(meta.page - 1)}
              >
                Previous
              </Button>
              <span className="flex items-center px-4 text-sm text-gray-500">
                Page {meta.page} of {meta.totalPages}
              </span>
              <Button
                variant="outline"
                disabled={meta.page >= meta.totalPages || isSearching}
                onClick={() => handleSearch(meta.page + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function ReviewerSearchPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64">Loading...</div>}>
      <ReviewerSearchContent />
    </Suspense>
  );
}
