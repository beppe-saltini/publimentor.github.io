"use client";

import { useState, useEffect, Suspense } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
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
  ExternalLink, CheckCircle, FileText, AlertTriangle,
  Users, Sparkles, Mail, MapPin, GraduationCap, FlaskConical,
  Download, Info, ThumbsUp, ThumbsDown, FileDown, Star
} from "lucide-react";
import { toast } from "sonner";
import { ManuscriptSelector } from "@/components/manuscript";
import { COIBadge, COIDetails, getCardBorderClass, type ReviewerConflict, type ConflictSeverity } from "@/components/reviewers";

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
  coiSummary?: {
    hasConflict: boolean;
    worstSeverity: ConflictSeverity | null;
    conflictCount: number;
    conflicts: ReviewerConflict[];
  };
  inferredGender?: "likely_male" | "likely_female" | "unknown";
}

interface CoauthorWarning {
  name: string;
  coauthorCount: number;
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
  // COI check results
  coiSummary?: {
    hasConflict: boolean;
    worstSeverity: ConflictSeverity | null;
    conflictCount: number;
    conflicts: ReviewerConflict[];
  };
  inferredGender?: "likely_male" | "likely_female" | "unknown";
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
    gender?: { likely_female: number; likely_male: number; unknown: number };
  };
  avgPublications: number;
  avgSeniorAuthorships: number;
  llmEnhanced?: boolean;
  avgHIndex?: number | null;
  dataSources?: {
    semanticScholar: number;
    openAlex: number;
    pubMed?: number;
  };
  searchStrategy?: string;
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
  const router = useRouter();
  const slug = params.slug as string;
  const submissionId = searchParams.get("submissionId");
  const manuscriptIdParam = searchParams.get("manuscriptId");

  // Manuscript author list (used for exclusion and COI export)
  const [authorList, setAuthorList] = useState("");
  // Quick find keywords state
  const [keywords, setKeywords] = useState("");

  // Auto-populated reviewers state
  const [candidateReviewers, setCandidateReviewers] = useState<ReviewerCandidate[]>([]);
  const [coauthorWarnings, setCoauthorWarnings] = useState<CoauthorWarning[]>([]);
  const [isFindingReviewers, setIsFindingReviewers] = useState(false);

  // Manuscript source state
  const [selectedManuscriptId, setSelectedManuscriptId] = useState<string | null>(null);
  const [defaultPublisherId, setDefaultPublisherId] = useState<string | null>(null);
  const [journalId, setJournalId] = useState<string | null>(null);
  const [manuscriptAutoLoaded, setManuscriptAutoLoaded] = useState(false);

  // Fetch journal details (publisherId + id) for manuscript uploads.
  // This uses the journal the user is already viewing, so even editors without
  // a direct publisher membership can upload manuscripts.
  useEffect(() => {
    const fetchJournalInfo = async () => {
      let foundPublisherId: string | null = null;

      try {
        const response = await fetch(`/api/journals/${slug}`);
        const text = await response.text();
        const data = JSON.parse(text);
        if (response.ok && data.journal) {
          setJournalId(data.journal.id);
          if (data.journal.publisherId) {
            foundPublisherId = data.journal.publisherId;
            setDefaultPublisherId(data.journal.publisherId);
          }
          console.log("[Reviewers] journal info loaded, publisherId:", data.journal.publisherId || "none");
        } else {
          console.warn("[Reviewers] journal fetch not ok:", response.status, data);
        }
      } catch (error) {
        console.error("[Reviewers] Error fetching journal info:", error);
      }

      // Fallback: try user's own publisher membership
      if (!foundPublisherId) {
        try {
          const response = await fetch("/api/publishers");
          const text = await response.text();
          const data = JSON.parse(text);
          if (response.ok && data.publishers?.length > 0) {
            foundPublisherId = data.publishers[0].id;
            setDefaultPublisherId(data.publishers[0].id);
            console.log("[Reviewers] publisher fallback loaded:", data.publishers[0].id);
          } else {
            console.warn("[Reviewers] no publishers found, upload will be unavailable");
          }
        } catch (err) {
          console.error("[Reviewers] Error fetching publishers:", err);
        }
      }
    };
    fetchJournalInfo();
  }, [slug]);

  // Auto-load manuscript from URL query parameter (e.g., from "Find Reviewers" button on manuscript page)
  useEffect(() => {
    if (manuscriptIdParam && !manuscriptAutoLoaded) {
      setManuscriptAutoLoaded(true);
      setSelectedManuscriptId(manuscriptIdParam);

      // Fetch manuscript details and auto-populate keywords + authors
      const fetchManuscriptData = async () => {
        try {
          const response = await fetch(`/api/manuscripts/${manuscriptIdParam}`);
          const data = await response.json();
          if (response.ok && data.manuscript) {
            const ms = data.manuscript;
            // Auto-populate keywords from manuscript
            if (ms.keywords && ms.keywords.length > 0) {
              setPrimaryKeywords(ms.keywords.slice(0, 3).join(", "));
              if (ms.keywords.length > 3) {
                setSecondaryKeywords(ms.keywords.slice(3).join(", "));
              }
              setKeywords(ms.keywords.join(", "));
            }
            // Auto-populate author list for COI checking
            if (ms.authors && ms.authors.length > 0) {
              setAuthorList(ms.authors.map((a: { fullName: string }) => a.fullName).join(", "));
            }
            toast.success(
              `Loaded manuscript: ${ms.title || ms.fileName}` +
              (ms.keywords?.length ? ` (${ms.keywords.length} keywords, ${ms.authors?.length || 0} authors)` : "")
            );
          }
        } catch (error) {
          console.error("Error loading manuscript from URL:", error);
          toast.error("Could not auto-load manuscript. Please select it manually.");
        }
      };
      fetchManuscriptData();
    }
  }, [manuscriptIdParam, manuscriptAutoLoaded]);

  // Advanced discovery state
  const [primaryKeywords, setPrimaryKeywords] = useState("");
  const [secondaryKeywords, setSecondaryKeywords] = useState("");
  const [keywordOperator, setKeywordOperator] = useState<"AND" | "OR">("AND");
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

  // Thumbs up flagging state
  const [flaggedReviewers, setFlaggedReviewers] = useState<Record<string, "up" | null>>({});

  // Rejected reviewer names — loaded from DB per manuscript
  const [rejectedNames, setRejectedNames] = useState<Set<string>>(new Set());
  const [isLoadingPersisted, setIsLoadingPersisted] = useState(false);
  const [manuscriptWorkflowStatus, setManuscriptWorkflowStatus] = useState<string | null>(null);

  const isRejected = (name: string) => rejectedNames.has(name.toLowerCase().trim());

  const mapDbReviewerToAdvanced = (r: Record<string, unknown>): AdvancedReviewer => ({
    id: r.id as string,
    name: r.name as string,
    firstName: (r.firstName as string) || "",
    lastName: (r.lastName as string) || "",
    affiliation: (r.affiliation as string) || "",
    country: (r.country as string) || "",
    hIndex: (r.hIndex as number) ?? null,
    citationCount: (r.citationCount as number) ?? null,
    publicationCount: (r.publicationCount as number) || 0,
    firstAuthorCount: 0,
    lastAuthorCount: 0,
    correspondingCount: 0,
    seniorAuthorCount: 0,
    recentArticles: (r.recentArticles as AdvancedReviewer["recentArticles"]) || [],
    sources: (r.sources as AdvancedReviewer["sources"]) || [],
    verificationUrls: (r.verificationUrls as AdvancedReviewer["verificationUrls"]) || {
      pubmedSearchUrl: `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(r.name as string)}`,
      googleScholarUrl: `https://scholar.google.com/scholar?q=author:"${encodeURIComponent(r.name as string)}"`,
      institutionSearchUrl: `https://www.google.com/search?q="${encodeURIComponent(r.name as string)}"+email`,
    },
    llmAnalysis: (r.llmAnalysis as AdvancedReviewer["llmAnalysis"]) || undefined,
    coiSummary: (r.coiSummary as AdvancedReviewer["coiSummary"]) || undefined,
    inferredGender: (r.inferredGender as AdvancedReviewer["inferredGender"]) || undefined,
  });

  const loadPersistedReviewers = async (manuscriptId: string) => {
    setIsLoadingPersisted(true);
    try {
      const response = await fetch(`/api/manuscripts/${manuscriptId}/reviewers?includeRejected=true`);
      const data = await response.json();
      if (response.ok && data.reviewers) {
        const allReviewers = data.reviewers as Record<string, unknown>[];
        const rejected = allReviewers.filter(r => r.status === "REJECTED");
        const active = allReviewers.filter(r => r.status !== "REJECTED");

        setRejectedNames(new Set(rejected.map(r => (r.name as string).toLowerCase().trim())));

        if (active.length > 0) {
          const mapped = active.map(mapDbReviewerToAdvanced);
          const countries = [...new Set(mapped.map(r => r.country).filter(Boolean))];
          setDiscoveryResult(prev => ({
            reviewers: prev
              ? [...prev.reviewers.filter(existing => !mapped.some(m => m.name === existing.name)), ...mapped]
              : mapped,
            summary: prev?.summary || {
              totalFound: mapped.length,
              returned: mapped.length,
              criteria: { minPublications: 0, maxPublications: 100, yearsActive: 5, requireSeniorAuthor: false },
              diversity: { countries, countryCount: countries.length },
              avgPublications: Math.round(mapped.reduce((sum, r) => sum + r.publicationCount, 0) / mapped.length),
              avgSeniorAuthorships: 0,
            },
            relatedConcepts: prev?.relatedConcepts || [],
            disclaimer: prev?.disclaimer || "These are persisted reviewer suggestions. Verify suitability before invitation.",
            selectionCriteria: prev?.selectionCriteria || {},
          }));

          const flags: Record<string, "up" | null> = {};
          active.forEach(r => {
            if (r.status === "SHORTLISTED") flags[r.id as string] = "up";
          });
          setFlaggedReviewers(prev => ({ ...prev, ...flags }));
        } else {
          setRejectedNames(new Set(rejected.map(r => (r.name as string).toLowerCase().trim())));
        }
      }
    } catch (error) {
      console.error("Error loading persisted reviewers:", error);
    } finally {
      setIsLoadingPersisted(false);
    }
  };

  const persistReviewersToDb = async (manuscriptId: string, reviewers: (AdvancedReviewer | ReviewerCandidate)[]) => {
    try {
      const payload = reviewers.map(r => ({
        name: r.name,
        firstName: r.firstName || null,
        lastName: r.lastName || null,
        affiliation: ("affiliation" in r ? r.affiliation : null) || null,
        country: ("country" in r ? (r as AdvancedReviewer).country : null) || null,
        hIndex: r.hIndex ?? null,
        citationCount: ("citationCount" in r ? (r as AdvancedReviewer).citationCount : null) ?? ("citedByCount" in r ? (r as ReviewerCandidate).citedByCount : null) ?? null,
        publicationCount: ("publicationCount" in r ? (r as AdvancedReviewer).publicationCount : null) ?? ("worksCount" in r ? (r as ReviewerCandidate).worksCount : null) ?? null,
        inferredGender: r.inferredGender || null,
        sources: ("sources" in r ? (r as AdvancedReviewer).sources : [(r as ReviewerCandidate).source]) || null,
        recentArticles: ("recentArticles" in r ? (r as AdvancedReviewer).recentArticles : null) || null,
        verificationUrls: ("verificationUrls" in r ? (r as AdvancedReviewer).verificationUrls : null) || null,
        llmAnalysis: ("llmAnalysis" in r ? (r as AdvancedReviewer).llmAnalysis : null) || null,
        coiSummary: r.coiSummary || null,
      }));

      const response = await fetch(`/api/manuscripts/${manuscriptId}/reviewers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewers: payload }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.saved > 0) {
          if (manuscriptWorkflowStatus === "NEW") {
            fetch(`/api/manuscripts/${manuscriptId}/status`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ workflowStatus: "FINDING_REVIEWERS" }),
            })
              .then(() => setManuscriptWorkflowStatus("FINDING_REVIEWERS"))
              .catch(() => {});
          }
          await loadPersistedReviewers(manuscriptId);
        }
      }
    } catch (error) {
      console.error("Error persisting reviewers:", error);
    }
  };

  // Load persisted reviewers and workflow status when manuscript selection changes
  useEffect(() => {
    if (selectedManuscriptId) {
      loadPersistedReviewers(selectedManuscriptId);
      fetch(`/api/manuscripts/${selectedManuscriptId}`)
        .then(r => r.json())
        .then(data => {
          if (data.manuscript?.workflowStatus) {
            setManuscriptWorkflowStatus(data.manuscript.workflowStatus);
          }
        })
        .catch(() => {});
    } else {
      setRejectedNames(new Set());
      setDiscoveryResult(null);
      setManuscriptWorkflowStatus(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedManuscriptId]);

  // Reviewer responsiveness scoring (persisted in localStorage)
  const [reviewerScores, setReviewerScores] = useState<Record<string, { score: 1 | 2 | 3 | 4 | 5; note?: string }>>({});

  // Load reviewer scores from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem("publimentor_reviewer_scores");
      if (stored) {
        setReviewerScores(JSON.parse(stored));
      }
    } catch {
      // Ignore parse errors
    }
  }, []);

  const setReviewerScore = (reviewerName: string, score: 1 | 2 | 3 | 4 | 5, note?: string) => {
    setReviewerScores(prev => {
      const updated = { 
        ...prev, 
        [reviewerName]: { score, note: note || prev[reviewerName]?.note } 
      };
      localStorage.setItem("publimentor_reviewer_scores", JSON.stringify(updated));
      return updated;
    });
  };

  const toggleFlag = (reviewerId: string, reviewerName: string, direction: "up" | "down") => {
    if (direction === "down") {
      // Optimistic update: remove immediately
      setRejectedNames(prev => { const s = new Set(prev); s.add(reviewerName.toLowerCase().trim()); return s; });
      setCandidateReviewers(prev => prev.filter(r => r.id !== reviewerId));
      setDiscoveryResult(prev => {
        if (!prev) return prev;
        return { ...prev, reviewers: prev.reviewers.filter(r => r.id !== reviewerId) };
      });
      toast.success("Reviewer removed \u2014 won\u2019t appear again for this manuscript");
      if (selectedManuscriptId) {
        fetch(`/api/manuscripts/${selectedManuscriptId}/reviewers/${reviewerId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "REJECTED" }),
        }).catch(err => console.error("Error rejecting reviewer:", err));
      }
      return;
    }
    // Thumbs up: toggle
    const newFlag: "up" | null = flaggedReviewers[reviewerId] === "up" ? null : "up";
    setFlaggedReviewers(prev => ({ ...prev, [reviewerId]: newFlag }));
    if (selectedManuscriptId) {
      fetch(`/api/manuscripts/${selectedManuscriptId}/reviewers/${reviewerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newFlag === "up" ? "SHORTLISTED" : "SUGGESTED" }),
      }).catch(err => console.error("Error updating reviewer status:", err));
    }
  };

  // Export reviewers as CSV (rejected reviewers are excluded)
  const exportFlaggedReviewers = () => {
    const allReviewers = [
      ...(discoveryResult?.reviewers || [])
        .filter(r => !isRejected(r.name))
        .map(r => ({
          name: r.name,
          affiliation: r.affiliation || "",
          country: r.country || "",
          hIndex: r.hIndex ?? "",
          publications: r.publicationCount,
          flag: flaggedReviewers[r.id] || "none",
          coiStatus: r.coiSummary?.worstSeverity || "clear",
          responsiveness: reviewerScores[r.name]?.score || "",
        })),
      ...(candidateReviewers || [])
        .filter(r => !isRejected(r.name))
        .map(r => ({
          name: r.name,
          affiliation: r.affiliation || "",
          country: "",
          hIndex: r.hIndex ?? "",
          publications: r.worksCount || 0,
          flag: flaggedReviewers[r.id] || "none",
          coiStatus: r.coiSummary?.worstSeverity || "clear",
          responsiveness: reviewerScores[r.name]?.score || "",
        })),
    ];

    const flaggedOnly = allReviewers.filter(r => r.flag !== "none");
    const rows = (flaggedOnly.length > 0 ? flaggedOnly : allReviewers);

    const csv = [
      "Name,Affiliation,Country,h-Index,Publications,Flag,COI Status,Responsiveness Score",
      ...rows.map(r => 
        `"${r.name}","${r.affiliation}","${r.country}","${r.hIndex}","${r.publications}","${r.flag}","${r.coiStatus}","${r.responsiveness}"`
      ),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reviewers-${flaggedOnly.length > 0 ? "flagged-" : ""}${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(flaggedOnly.length > 0 
      ? `Exported ${flaggedOnly.length} flagged reviewers` 
      : `Exported ${allReviewers.length} reviewers`
    );
  };

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

  // Find reviewers automatically from PubMed and OpenAlex
  const handleFindReviewers = async () => {
    if (!keywords.trim()) {
      toast.error("Please enter keywords to search for reviewers");
      return;
    }

    setIsFindingReviewers(true);

    try {
      const response = await fetch("/api/reviewers/find", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authorList: authorList.trim() || undefined,
          keywords: keywords.split(",").map((k: string) => k.trim()).filter(Boolean),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to find reviewers");
      }

      // Merge new reviewers into existing list (deduplicate by id, exclude rejected)
      setCandidateReviewers(prev => {
        const existingIds = new Set(prev.map(r => r.id));
        const newReviewers = (data.reviewers as ReviewerCandidate[]).filter(
          (r: ReviewerCandidate) => !existingIds.has(r.id) && !isRejected(r.name)
        );
        return [...prev, ...newReviewers];
      });
      setCoauthorWarnings(prev => {
        const existingNames = new Set(prev.map(w => w.name));
        const newWarnings = ((data.coauthors || []) as CoauthorWarning[]).filter((w: CoauthorWarning) => !existingNames.has(w.name));
        return [...prev, ...newWarnings];
      });
      
      toast.success(
        `Found ${data.reviewers.length} potential reviewers from PubMed and OpenAlex`
      );

      if (selectedManuscriptId && data.reviewers?.length > 0) {
        persistReviewersToDb(selectedManuscriptId, data.reviewers as ReviewerCandidate[]);
      }
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

    try {
      const response = await fetch("/api/reviewers/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          primaryKeywords: primaryKeywords.split(",").map(k => k.trim()).filter(Boolean),
          secondaryKeywords: secondaryKeywords 
            ? secondaryKeywords.split(",").map(k => k.trim()).filter(Boolean) 
            : undefined,
          keywordOperator,
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

      // Merge new reviewers into existing results (deduplicate by id, exclude rejected)
      setDiscoveryResult(prev => {
        const incoming = (data.reviewers as AdvancedReviewer[]).filter(
          (r: AdvancedReviewer) => !isRejected(r.name)
        );
        if (!prev) return { ...data, reviewers: incoming };
        const existingIds = new Set(prev.reviewers.map((r: AdvancedReviewer) => r.id));
        const newReviewers = incoming.filter((r: AdvancedReviewer) => !existingIds.has(r.id));
        return {
          ...data,
          reviewers: [...prev.reviewers, ...newReviewers],
        };
      });
      
      toast.success(
        `Found ${data.reviewers.length} senior reviewers from ${data.summary.diversity.countryCount} countries`
      );

      if (selectedManuscriptId && data.reviewers?.length > 0) {
        persistReviewersToDb(selectedManuscriptId, data.reviewers as AdvancedReviewer[]);
      }
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

    discoveryResult.reviewers
      .filter(r => !isRejected(r.name))
      .forEach((r, i) => {
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
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Reviewer Recommendations</h1>
          <p className="text-gray-500">
            Discover potential reviewers from PubMed and OpenAlex databases for editorial consideration
          </p>
        </div>
        {(discoveryResult?.reviewers.length || candidateReviewers.length > 0) && (
          <Button variant="outline" onClick={exportFlaggedReviewers}>
            <FileDown className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        )}
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
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="advanced">
            <FlaskConical className="h-4 w-4 mr-2" />
            Advanced Discovery
          </TabsTrigger>
          <TabsTrigger value="auto-find">
            <Sparkles className="h-4 w-4 mr-2" />
            Quick Find
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
                  placeholder="Select or upload manuscript"
                  publisherId={defaultPublisherId || undefined}
                  journalId={journalId || undefined}
                />
                <p className="text-xs text-gray-500">
                  Keywords and authors will be extracted automatically
                </p>
              </div>

              <Separator />

              {/* Keywords Section */}
              <div className="space-y-3">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="primaryKeywords">Primary Expertise (required)</Label>
                    <Input
                      id="primaryKeywords"
                      placeholder="Primary research area"
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
                      placeholder="Additional skills or methods"
                      value={secondaryKeywords}
                      onChange={(e) => setSecondaryKeywords(e.target.value)}
                    />
                    <p className="text-xs text-gray-500">
                      Additional desired skills
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Label className="text-xs text-gray-500">Keyword matching:</Label>
                  <div className="flex rounded-md border overflow-hidden">
                    <button
                      type="button"
                      className={`px-3 py-1 text-xs font-medium transition-colors ${
                        keywordOperator === "AND" 
                          ? "bg-blue-600 text-white" 
                          : "bg-white text-gray-600 hover:bg-gray-50"
                      }`}
                      onClick={() => setKeywordOperator("AND")}
                    >
                      AND
                    </button>
                    <button
                      type="button"
                      className={`px-3 py-1 text-xs font-medium transition-colors border-l ${
                        keywordOperator === "OR" 
                          ? "bg-blue-600 text-white" 
                          : "bg-white text-gray-600 hover:bg-gray-50"
                      }`}
                      onClick={() => setKeywordOperator("OR")}
                    >
                      OR
                    </button>
                  </div>
                  <span className="text-xs text-gray-400">
                    {keywordOperator === "AND" 
                      ? "Reviewer must match all keywords" 
                      : "Reviewer can match any keyword"}
                  </span>
                </div>
              </div>

              {/* Manuscript Authors to Exclude */}
              <div className="space-y-2">
                <Label htmlFor="authorListAdvanced">Manuscript Authors (to exclude)</Label>
                <Textarea
                  id="authorListAdvanced"
                  placeholder="Comma-separated author names"
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

          {/* Loading persisted reviewers indicator */}
          {isLoadingPersisted && (
            <Card className="bg-blue-50 border-blue-200">
              <CardContent className="py-4 flex items-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                <p className="text-sm text-blue-800">Loading saved reviewers...</p>
              </CardContent>
            </Card>
          )}

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
                        {discoveryResult.summary.avgHIndex !== null && (
                          <li>✓ Avg H-index: {discoveryResult.summary.avgHIndex as number}</li>
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
                        {discoveryResult.summary.dataSources && (
                          <>
                            {discoveryResult.summary.dataSources?.semanticScholar > 0 && (
                              <Badge variant="outline" className="bg-orange-50 text-orange-700">
                                Semantic Scholar
                              </Badge>
                            )}
                            {discoveryResult.summary.dataSources?.openAlex > 0 && (
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
                      {discoveryResult.summary.searchStrategy && (
                        <p className="text-xs text-purple-600 mt-2 italic">
                          Strategy: {discoveryResult.summary.searchStrategy}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={exportDiscoveryResults}>
                        <Download className="h-4 w-4 mr-2" />
                        Export List
                      </Button>
                      <Button 
                        variant="outline"
                        onClick={() => {
                          if (!discoveryResult) return;
                          const reviewerNames = discoveryResult.reviewers.map(r => r.name).join("\n");
                          // Store in sessionStorage and navigate to COI page
                          sessionStorage.setItem("coi_reviewers_import", reviewerNames);
                          if (authorList) {
                            sessionStorage.setItem("coi_authors_import", authorList);
                          }
                          router.push(`/dashboard/journals/${slug}/coi`);
                          toast.success(`${discoveryResult.reviewers.length} reviewers sent to COI check`);
                        }}
                      >
                        <AlertTriangle className="h-4 w-4 mr-2" />
                        COI Check All
                      </Button>
                    </div>
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
                    {discoveryResult.summary.diversity.gender && (
                      <> • <span className="text-pink-600">{discoveryResult.summary.diversity.gender.likely_female}F</span> / <span className="text-sky-600">{discoveryResult.summary.diversity.gender.likely_male}M</span></>
                    )}
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
                  <Card 
                    key={reviewer.id} 
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
                            <h4 className="font-semibold flex items-center gap-1.5">
                              {reviewer.name}
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                reviewer.inferredGender === "likely_female"
                                  ? "bg-pink-100 text-pink-700"
                                  : reviewer.inferredGender === "likely_male"
                                  ? "bg-sky-100 text-sky-700"
                                  : "bg-gray-100 text-gray-500"
                              }`} title={`Gender estimate based on first name (${reviewer.firstName})`}>
                                {reviewer.inferredGender === "likely_female" ? "F" : reviewer.inferredGender === "likely_male" ? "M" : "N/A"}
                              </span>
                            </h4>
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
                          ) : (
                            <Badge variant="outline" className="bg-blue-50 text-blue-700 text-xs">
                              PubMed
                            </Badge>
                          )}
                          {/* COI Badge */}
                          <COIBadge 
                            severity={reviewer.coiSummary?.worstSeverity || null}
                            conflictCount={reviewer.coiSummary?.conflictCount || 0}
                            size="sm"
                          />
                          {/* Thumbs up/down */}
                          <div className="flex gap-1">
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleFlag(reviewer.id, reviewer.name, "up"); }}
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
                              onClick={(e) => { e.stopPropagation(); toggleFlag(reviewer.id, reviewer.name, "down"); }}
                              className="p-1 rounded transition-colors text-gray-300 hover:text-red-500 hover:bg-red-50"
                              title="Remove reviewer"
                            >
                              <ThumbsDown className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          {/* Responsiveness score */}
                          <div className="flex gap-0.5" title="Rate reviewer responsiveness">
                            {[1, 2, 3, 4, 5].map(s => (
                              <button
                                key={s}
                                onClick={(e) => { e.stopPropagation(); setReviewerScore(reviewer.name, s as 1|2|3|4|5); }}
                                className="p-0 transition-colors"
                              >
                                <Star className={`h-3 w-3 ${
                                  (reviewerScores[reviewer.name]?.score || 0) >= s
                                    ? "text-amber-400 fill-amber-400"
                                    : "text-gray-200"
                                }`} />
                              </button>
                            ))}
                          </div>
                        </div>
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

                      {/* COI Details */}
                      {reviewer.coiSummary && reviewer.coiSummary.conflicts.length > 0 && (
                        <COIDetails 
                          conflicts={reviewer.coiSummary.conflicts}
                          worstSeverity={reviewer.coiSummary.worstSeverity}
                          className="mb-3"
                        />
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
              {/* Manuscript Source */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Load from Manuscript (optional)
                </Label>
                <ManuscriptSelector
                  value={selectedManuscriptId || undefined}
                  onChange={(m) => setSelectedManuscriptId(m?.id || null)}
                  onManuscriptData={(data) => {
                    // Auto-populate keywords from manuscript
                    if (data.keywords.length > 0) {
                      setKeywords(data.keywords.join(", "));
                    }
                    // Auto-populate author list for COI checking
                    if (data.authors.length > 0) {
                      setAuthorList(data.authors.map(a => a.name).join(", "));
                    }
                    toast.success(`Loaded ${data.keywords.length} keywords and ${data.authors.length} authors from manuscript`);
                  }}
                  placeholder="Select or upload manuscript"
                  publisherId={defaultPublisherId || undefined}
                  journalId={journalId || undefined}
                />
              </div>

              <Separator />

              <div className="space-y-2">
                <Label htmlFor="keywords">Research Keywords (comma-separated)</Label>
                <Input
                  id="keywords"
                  placeholder="Comma-separated research keywords"
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
                  placeholder="Comma-separated author names"
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
                  const hasCoiConflict = reviewer.coiSummary?.hasConflict;
                  
                  return (
                    <Card 
                      key={reviewer.id} 
                      className={`${
                        hasCoiConflict 
                          ? getCardBorderClass(reviewer.coiSummary?.worstSeverity || null, true)
                          : coauthorCount 
                          ? "border-amber-300 bg-amber-50" 
                          : ""
                      }`}
                    >
                      <CardContent className="pt-4">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-start gap-2">
                            <div className="bg-gray-100 rounded-full p-2">
                              <User className="h-4 w-4 text-gray-600" />
                            </div>
                            <div>
                              <h4 className="font-semibold text-sm flex items-center gap-1.5">
                                {reviewer.name}
                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                  reviewer.inferredGender === "likely_female"
                                    ? "bg-pink-100 text-pink-700"
                                    : reviewer.inferredGender === "likely_male"
                                    ? "bg-sky-100 text-sky-700"
                                    : "bg-gray-100 text-gray-500"
                                }`} title={`Gender estimate based on first name (${reviewer.firstName})`}>
                                  {reviewer.inferredGender === "likely_female" ? "F" : reviewer.inferredGender === "likely_male" ? "M" : "N/A"}
                                </span>
                              </h4>
                              {reviewer.affiliation && (
                                <p className="text-xs text-gray-500 flex items-center gap-1">
                                  <Building className="h-3 w-3" />
                                  {reviewer.affiliation}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            {/* COI Badge from detailed check */}
                            {reviewer.coiSummary && (
                              <COIBadge 
                                severity={reviewer.coiSummary.worstSeverity}
                                conflictCount={reviewer.coiSummary.conflictCount}
                                size="sm"
                              />
                            )}
                            {/* Legacy coauthor warning */}
                            {!reviewer.coiSummary && coauthorCount && (
                              <Badge variant="outline" className="border-amber-400 text-amber-700 text-xs" title="Potential overlap - verify independence">
                                <AlertTriangle className="h-3 w-3 mr-1" />
                                Review
                              </Badge>
                            )}
                            {/* Thumbs up/down */}
                            <div className="flex gap-1">
                              <button
                                onClick={(e) => { e.stopPropagation(); toggleFlag(reviewer.id, reviewer.name, "up"); }}
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
                                onClick={(e) => { e.stopPropagation(); toggleFlag(reviewer.id, reviewer.name, "down"); }}
                                className="p-1 rounded transition-colors text-gray-300 hover:text-red-500 hover:bg-red-50"
                                title="Remove reviewer"
                              >
                                <ThumbsDown className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            {/* Responsiveness score */}
                            <div className="flex gap-0.5" title="Rate reviewer responsiveness">
                              {[1, 2, 3, 4, 5].map(s => (
                                <button
                                  key={s}
                                  onClick={(e) => { e.stopPropagation(); setReviewerScore(reviewer.name, s as 1|2|3|4|5); }}
                                  className="p-0 transition-colors"
                                >
                                  <Star className={`h-3 w-3 ${
                                    (reviewerScores[reviewer.name]?.score || 0) >= s
                                      ? "text-amber-400 fill-amber-400"
                                      : "text-gray-200"
                                  }`} />
                                </button>
                              ))}
                            </div>
                          </div>
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

                        {/* COI Details */}
                        {reviewer.coiSummary && reviewer.coiSummary.conflicts.length > 0 && (
                          <COIDetails 
                            conflicts={reviewer.coiSummary.conflicts}
                            worstSeverity={reviewer.coiSummary.worstSeverity}
                            className="mt-3"
                          />
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

        {/* Search Strings and Manual Search tabs removed per editorial feedback */}
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
