"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
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
  Users, Sparkles, Mail, GraduationCap, FlaskConical,
  Download, Info, ThumbsUp, ThumbsDown, FileDown, Check, XCircle
} from "lucide-react";
import { toast } from "sonner";
import { ManuscriptSelector } from "@/components/manuscript";
import { COIBadge, getCardBorderClass } from "./coi-badge";
import { COIDetails, type ReviewerConflict } from "./coi-details";
import type { ConflictSeverity } from "./coi-badge";
import { ReviewerResultsList } from "./reviewer-results-list";
import type { ReviewerDisplay } from "./reviewer-display";
import {
  loadReviewerSearchFormState,
  saveReviewerSearchFormState,
  clearReviewerSearchFormState,
  type ReviewerSearchFormState,
  type ReviewerSearchActiveTab,
} from "@/lib/reviewer-search-form-state";
import {
  normalizeReviewerName,
  buildFlagsFromDbReviewers,
  computeExpertiseCoverage,
  computeFocusKeywords,
  filterActiveReviewers,
  mergeReviewerLists,
  tagNewReviewers,
  sortReviewersDisplayOrder,
  collectKnownReviewerNames,
  type DbReviewerIndex,
} from "@/lib/reviewers/reviewer-list-utils";

interface ReviewerCandidate {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  affiliation?: string;
  isNewThisRun?: boolean;
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
  email: string | null;
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
    institutionProfileUrl?: string;
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
  isNewThisRun?: boolean;
}

type DiscoveryReviewer = AdvancedReviewer;

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

export interface ReviewerSearchContentProps {
  journalSlug: string;
  /** COI route (journal shell vs editor shell) */
  coiHref?: string;
  publisherId?: string | null;
  journalId?: string | null;
}

export function ReviewerSearchContent({
  journalSlug,
  coiHref,
  publisherId: publisherIdProp,
  journalId,
}: ReviewerSearchContentProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const slug = journalSlug;
  const coiPath = coiHref ?? `/dashboard/journals/${journalSlug}/coi`;
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
  const [selectedManuscriptId, setSelectedManuscriptIdRaw] = useState<string | null>(null);
  const setSelectedManuscriptId = (id: string | null) => {
    setSelectedManuscriptIdRaw(id);
    if (id) sessionStorage.setItem("active_manuscript_id", id);
  };
  const [defaultPublisherId, setDefaultPublisherId] = useState<string | null>(
    publisherIdProp ?? null
  );
  const [manuscriptAutoLoaded, setManuscriptAutoLoaded] = useState(false);

  // Fetch default publisher for uploads when not provided
  useEffect(() => {
    if (publisherIdProp) {
      setDefaultPublisherId(publisherIdProp);
      return;
    }
    const fetchDefaultPublisher = async () => {
      try {
        const response = await fetch("/api/publishers");
        const data = await response.json();
        if (response.ok && data.publishers?.length > 0) {
          setDefaultPublisherId(data.publishers[0].id);
        }
      } catch (error) {
        console.error("Error fetching publisher:", error);
      }
    };
    fetchDefaultPublisher();
  }, [publisherIdProp]);

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
  const [activeTab, setActiveTab] = useState<ReviewerSearchActiveTab>("advanced");
  const [discoveryResult, setDiscoveryResult] = useState<DiscoveryResult | null>(null);
  const [isDiscovering, setIsDiscovering] = useState(false);

  const isRestoringFormRef = useRef(false);
  const restoredManuscriptRef = useRef<string | null>(null);

  // Thumbs up/down flagging state (synced to DB status SHORTLISTED / REJECTED)
  const [flaggedReviewers, setFlaggedReviewers] = useState<Record<string, "up" | "down" | null>>({});
  const [dbReviewerIndex, setDbReviewerIndex] = useState<DbReviewerIndex>({});

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

  const findReviewerNameById = useCallback(
    (reviewerId: string): string | null => {
      const fromDiscovery = discoveryResult?.reviewers.find((r) => r.id === reviewerId);
      if (fromDiscovery) return fromDiscovery.name;
      const fromQuick = candidateReviewers.find((r) => r.id === reviewerId);
      if (fromQuick) return fromQuick.name;
      return null;
    },
    [discoveryResult, candidateReviewers]
  );

  const toggleFlag = async (reviewerId: string, direction: "up" | "down") => {
    const name = findReviewerNameById(reviewerId);
    if (!name) return;

    const current = flaggedReviewers[reviewerId];
    const nextFlag: "up" | "down" | null = current === direction ? null : direction;
    const dbId =
      dbReviewerIndex[normalizeReviewerName(name)]?.id ?? reviewerId;

    if (!selectedManuscriptId) {
      setFlaggedReviewers((prev) => ({
        ...prev,
        [reviewerId]: nextFlag,
      }));
      return;
    }

    const status =
      nextFlag === "up"
        ? "SHORTLISTED"
        : nextFlag === "down"
          ? "REJECTED"
          : "SUGGESTED";

    setFlaggedReviewers((prev) => {
      const updated = { ...prev };
      delete updated[reviewerId];
      if (dbId !== reviewerId) delete updated[dbId];
      if (nextFlag) updated[dbId] = nextFlag;
      return updated;
    });

    try {
      const response = await fetch(
        `/api/manuscripts/${selectedManuscriptId}/reviewers/${dbId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        }
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update reviewer");
      }

      setDbReviewerIndex((prev) => ({
        ...prev,
        [normalizeReviewerName(name)]: { id: dbId, status },
      }));

      if (status === "REJECTED") {
        setDiscoveryResult((prev) =>
          prev
            ? {
                ...prev,
                reviewers: prev.reviewers.filter(
                  (r) => normalizeReviewerName(r.name) !== normalizeReviewerName(name)
                ),
              }
            : null
        );
        setCandidateReviewers((prev) =>
          prev.filter(
            (r) => normalizeReviewerName(r.name) !== normalizeReviewerName(name)
          )
        );
      }
    } catch (err) {
      console.error("[toggleFlag]", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to save reviewer preference"
      );
      if (selectedManuscriptId) {
        loadPersistedReviewers(selectedManuscriptId);
      }
    }
  };

  // Expertise coverage tracking — keyed by reviewer ID
  const [assignedExpertise, setAssignedExpertise] = useState<Record<string, string[]>>({});

  const applySavedFormState = useCallback((saved: ReviewerSearchFormState) => {
    isRestoringFormRef.current = true;
    setActiveTab(saved.activeTab);
    setAuthorList(saved.authorList);
    setKeywords(saved.keywords);
    setPrimaryKeywords(saved.primaryKeywords);
    setSecondaryKeywords(saved.secondaryKeywords);
    setKeywordOperator(saved.keywordOperator);
    setMinHIndex(saved.minHIndex);
    setMaxHIndex(saved.maxHIndex);
    setMinPublications(saved.minPublications);
    setMaxPublications(saved.maxPublications);
    setYearsActive(saved.yearsActive);
    setRequireSeniorAuthor(saved.requireSeniorAuthor);
    setMaxResults(saved.maxResults);
    setDiversifyGeo(saved.diversifyGeo);
    setAvoidSameInstitution(saved.avoidSameInstitution);
    setUseLLM(saved.useLLM);
    setCandidateReviewers(saved.candidateReviewers as ReviewerCandidate[]);
    setCoauthorWarnings(saved.coauthorWarnings);
    setDiscoveryResult(saved.discoveryResult as DiscoveryResult | null);
    setFlaggedReviewers(saved.flaggedReviewers);
    setAssignedExpertise(saved.assignedExpertise);
    isRestoringFormRef.current = false;
  }, []);

  const resetFormToDefaults = useCallback(() => {
    setActiveTab("advanced");
    setAuthorList("");
    setKeywords("");
    setPrimaryKeywords("");
    setSecondaryKeywords("");
    setKeywordOperator("AND");
    setMinHIndex(0);
    setMaxHIndex(100);
    setMinPublications(3);
    setMaxPublications(100);
    setYearsActive(5);
    setRequireSeniorAuthor(true);
    setMaxResults(10);
    setDiversifyGeo(true);
    setAvoidSameInstitution(true);
    setUseLLM(true);
    setCandidateReviewers([]);
    setCoauthorWarnings([]);
    setDiscoveryResult(null);
    setFlaggedReviewers({});
    setAssignedExpertise({});
  }, []);

  const populateFromManuscriptApi = useCallback(async (manuscriptId: string) => {
    try {
      const response = await fetch(`/api/manuscripts/${manuscriptId}`);
      const data = await response.json();
      if (response.ok && data.manuscript) {
        const ms = data.manuscript;
        if (ms.keywords && ms.keywords.length > 0) {
          setPrimaryKeywords(ms.keywords.slice(0, 3).join(", "));
          if (ms.keywords.length > 3) {
            setSecondaryKeywords(ms.keywords.slice(3).join(", "));
          }
          setKeywords(ms.keywords.join(", "));
        }
        if (ms.authors && ms.authors.length > 0) {
          setAuthorList(ms.authors.map((a: { fullName: string }) => a.fullName).join(", "));
        }
        toast.success(
          `Loaded manuscript: ${ms.title || ms.fileName}` +
            (ms.keywords?.length
              ? ` (${ms.keywords.length} keywords, ${ms.authors?.length || 0} authors)`
              : "")
        );
      }
    } catch (error) {
      console.error("Error loading manuscript:", error);
      toast.error("Could not auto-load manuscript. Please select it manually.");
    }
  }, []);

  // Auto-select manuscript from URL param or session
  useEffect(() => {
    const idToLoad = manuscriptIdParam || sessionStorage.getItem("active_manuscript_id");
    if (idToLoad && !manuscriptAutoLoaded) {
      setManuscriptAutoLoaded(true);
      setSelectedManuscriptId(idToLoad);
    }
  }, [manuscriptIdParam, manuscriptAutoLoaded]);

  const manuscriptExpertise = useMemo(() => {
    const all = [
      ...primaryKeywords.split(",").map(k => k.trim()).filter(Boolean),
      ...secondaryKeywords.split(",").map(k => k.trim()).filter(Boolean),
    ];
    return [...new Set(all)];
  }, [primaryKeywords, secondaryKeywords]);

  const quickFindExpertise = useMemo(
    () =>
      [...new Set(keywords.split(",").map((k) => k.trim()).filter(Boolean))],
    [keywords]
  );

  const allReviewersForCoverage = useMemo(
    () => [
      ...(discoveryResult?.reviewers || []),
      ...(candidateReviewers || []),
    ],
    [discoveryResult, candidateReviewers]
  );

  const expertiseCoverageState = useMemo(() => {
    const expertiseList =
      activeTab === "auto-find" ? quickFindExpertise : manuscriptExpertise;
    const namesById: Record<string, string> = {};
    for (const r of allReviewersForCoverage) {
      namesById[r.id] = r.name;
    }
    return computeExpertiseCoverage(
      expertiseList,
      assignedExpertise,
      allReviewersForCoverage.map((r) => r.id),
      namesById
    );
  }, [
    activeTab,
    quickFindExpertise,
    manuscriptExpertise,
    assignedExpertise,
    allReviewersForCoverage,
  ]);

  const expertiseCoverage = expertiseCoverageState.coverage;
  const coveredExpertise = expertiseCoverageState.coveredExpertise;
  const uncoveredExpertise = expertiseCoverageState.uncoveredExpertise;

  const sortOptions = useMemo(
    () => ({
      assignedExpertise,
      flags: flaggedReviewers,
      dbIndex: dbReviewerIndex,
    }),
    [assignedExpertise, flaggedReviewers, dbReviewerIndex]
  );

  const sortedDiscoveryReviewers = useMemo(() => {
    if (!discoveryResult?.reviewers.length) return [];
    return sortReviewersDisplayOrder(
      filterActiveReviewers(discoveryResult.reviewers, flaggedReviewers, dbReviewerIndex),
      sortOptions
    );
  }, [discoveryResult, flaggedReviewers, dbReviewerIndex, sortOptions]);

  const sortedCandidateReviewers = useMemo(() => {
    const active = filterActiveReviewers(
      candidateReviewers,
      flaggedReviewers,
      dbReviewerIndex
    );
    return sortReviewersDisplayOrder(active, sortOptions);
  }, [candidateReviewers, flaggedReviewers, dbReviewerIndex, sortOptions]);

  const getKnownNamesBeforeRun = useCallback(() => {
    return collectKnownReviewerNames([
      ...(discoveryResult?.reviewers || []),
      ...candidateReviewers,
    ]);
  }, [discoveryResult, candidateReviewers]);

  const toggleExpertise = (reviewerId: string, expertise: string) => {
    setAssignedExpertise(prev => {
      const current = prev[reviewerId] || [];
      const updated = current.includes(expertise)
        ? current.filter(e => e !== expertise)
        : [...current, expertise];
      const next = { ...prev, [reviewerId]: updated };
      if (selectedManuscriptId) {
        fetch(`/api/manuscripts/${selectedManuscriptId}/reviewers/${reviewerId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assignedExpertise: updated }),
        }).catch(err => console.error("Error saving expertise:", err));
      }
      return next;
    });
  };

  // Load persisted reviewers from the database when a manuscript is selected
  const [isLoadingPersisted, setIsLoadingPersisted] = useState(false);

  const mapDbReviewerToAdvanced = (r: Record<string, unknown>): AdvancedReviewer => ({
    id: r.id as string,
    name: r.name as string,
    firstName: (r.firstName as string) || "",
    lastName: (r.lastName as string) || "",
    email: (r.email as string) || null,
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
      const response = await fetch(`/api/manuscripts/${manuscriptId}/reviewers`);
      const data = await response.json();
      if (response.ok && data.reviewers) {
        const allReviewers = data.reviewers as Array<{
          id: string;
          name: string;
          status: string;
          assignedExpertise?: string[] | null;
          [key: string]: unknown;
        }>;
        const active = allReviewers.filter((r) => r.status !== "REJECTED");

        const index: DbReviewerIndex = {};
        for (const r of allReviewers) {
          index[normalizeReviewerName(r.name)] = { id: r.id, status: r.status };
        }
        setDbReviewerIndex(index);

        const flags = buildFlagsFromDbReviewers(allReviewers);
        setFlaggedReviewers(flags);

        const expertiseMap: Record<string, string[]> = {};
        allReviewers.forEach((r) => {
          if (r.assignedExpertise && r.assignedExpertise.length > 0) {
            expertiseMap[r.id] = r.assignedExpertise as string[];
          }
        });
        if (Object.keys(expertiseMap).length > 0) {
          setAssignedExpertise((prev) => ({ ...prev, ...expertiseMap }));
        }

        if (active.length > 0) {
          const mapped = active.map(mapDbReviewerToAdvanced);
          const dbByName = new Map(
            mapped.map((r) => [normalizeReviewerName(r.name), r])
          );
          const countries = [...new Set(mapped.map((r) => r.country).filter(Boolean))];

          setDiscoveryResult((prev) => {
            const mergedMap = new Map<string, AdvancedReviewer>();
            for (const db of mapped) {
              mergedMap.set(normalizeReviewerName(db.name), db);
            }
            for (const r of prev?.reviewers ?? []) {
              const key = normalizeReviewerName(r.name);
              const db = dbByName.get(key);
              mergedMap.set(
                key,
                db ? { ...r, ...db, id: db.id } : r
              );
            }
            const mergedList = Array.from(mergedMap.values()).map((r) => ({
              ...r,
              isNewThisRun: false,
            }));
            const reviewers = sortReviewersDisplayOrder(
              filterActiveReviewers(mergedList, flags, index),
              {
                assignedExpertise: { ...expertiseMap },
                flags,
                dbIndex: index,
              }
            );

            return {
              reviewers,
              summary: prev?.summary || {
                totalFound: reviewers.length,
                returned: reviewers.length,
                criteria: {
                  minPublications: 0,
                  maxPublications: 100,
                  yearsActive: 5,
                  requireSeniorAuthor: false,
                },
                diversity: { countries, countryCount: countries.length },
                avgPublications: Math.round(
                  reviewers.reduce((sum, r) => sum + r.publicationCount, 0) /
                    (reviewers.length || 1)
                ),
                avgSeniorAuthorships: 0,
              },
              relatedConcepts: prev?.relatedConcepts || [],
              disclaimer:
                prev?.disclaimer ||
                "These are persisted reviewer suggestions. Verify suitability before invitation.",
              selectionCriteria: prev?.selectionCriteria || {},
            };
          });

          setCandidateReviewers((prev) => {
            const synced = prev.map((r) => {
              const db = dbByName.get(normalizeReviewerName(r.name));
              if (!db) return r;
              return {
                ...r,
                id: db.id,
                hIndex: db.hIndex ?? r.hIndex,
                citedByCount: db.citationCount ?? r.citedByCount,
                worksCount: db.publicationCount ?? r.worksCount,
                affiliation: db.affiliation || r.affiliation,
                coiSummary: db.coiSummary ?? r.coiSummary,
              };
            });
            return sortReviewersDisplayOrder(
              filterActiveReviewers(synced, flags, index),
              { assignedExpertise: expertiseMap, flags, dbIndex: index }
            );
          });
        }
      }
    } catch (error) {
      console.error("Error loading persisted reviewers:", error);
    } finally {
      setIsLoadingPersisted(false);
    }
  };

  // Restore full form state or populate from manuscript; then merge DB reviewers
  useEffect(() => {
    if (!selectedManuscriptId) {
      setDiscoveryResult(null);
      restoredManuscriptRef.current = null;
      return;
    }

    if (restoredManuscriptRef.current !== selectedManuscriptId) {
      restoredManuscriptRef.current = selectedManuscriptId;
      const saved = loadReviewerSearchFormState(selectedManuscriptId);
      if (saved) {
        applySavedFormState(saved);
      } else {
        resetFormToDefaults();
        populateFromManuscriptApi(selectedManuscriptId);
      }
    }

    loadPersistedReviewers(selectedManuscriptId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedManuscriptId,
    applySavedFormState,
    resetFormToDefaults,
    populateFromManuscriptApi,
  ]);

  // Persist full form state (sliders, keywords, in-memory results, flags)
  useEffect(() => {
    if (isRestoringFormRef.current) return;

    const manuscriptKey = selectedManuscriptId;
    const timeout = window.setTimeout(() => {
      saveReviewerSearchFormState({
        version: 1,
        manuscriptId: manuscriptKey,
        activeTab,
        authorList,
        keywords,
        primaryKeywords,
        secondaryKeywords,
        keywordOperator,
        minHIndex,
        maxHIndex,
        minPublications,
        maxPublications,
        yearsActive,
        requireSeniorAuthor,
        maxResults,
        diversifyGeo,
        avoidSameInstitution,
        useLLM,
        candidateReviewers,
        coauthorWarnings,
        discoveryResult,
        flaggedReviewers,
        assignedExpertise,
        savedAt: Date.now(),
      });
    }, 400);

    return () => window.clearTimeout(timeout);
  }, [
    selectedManuscriptId,
    activeTab,
    authorList,
    keywords,
    primaryKeywords,
    secondaryKeywords,
    keywordOperator,
    minHIndex,
    maxHIndex,
    minPublications,
    maxPublications,
    yearsActive,
    requireSeniorAuthor,
    maxResults,
    diversifyGeo,
    avoidSameInstitution,
    useLLM,
    candidateReviewers,
    coauthorWarnings,
    discoveryResult,
    flaggedReviewers,
    assignedExpertise,
  ]);

  // Export flagged reviewers as CSV
  const exportFlaggedReviewers = () => {
    const allReviewers = [
      ...(discoveryResult?.reviewers || []).map(r => ({
        name: r.name,
        affiliation: r.affiliation || "",
        country: r.country || "",
        hIndex: r.hIndex ?? "",
        publications: r.publicationCount,
        flag: flaggedReviewers[r.id] || "none",
        coiStatus: r.coiSummary?.worstSeverity || "clear",
        responsiveness: reviewerScores[r.name]?.score || "",
        expertise: (assignedExpertise[r.id] || []).join("; "),
      })),
      ...(candidateReviewers || []).map(r => ({
        name: r.name,
        affiliation: r.affiliation || "",
        country: "",
        hIndex: r.hIndex ?? "",
        publications: r.worksCount || 0,
        flag: flaggedReviewers[r.id] || "none",
        coiStatus: r.coiSummary?.worstSeverity || "clear",
        responsiveness: reviewerScores[r.name]?.score || "",
        expertise: (assignedExpertise[r.id] || []).join("; "),
      })),
    ];

    const flaggedOnly = allReviewers.filter(r => r.flag !== "none");
    const rows = (flaggedOnly.length > 0 ? flaggedOnly : allReviewers);

    const csv = [
      "Name,Affiliation,Country,h-Index,Publications,Flag,COI Status,Responsiveness Score,Expertise",
      ...rows.map(r => 
        `"${r.name}","${r.affiliation}","${r.country}","${r.hIndex}","${r.publications}","${r.flag}","${r.coiStatus}","${r.responsiveness}","${r.expertise}"`
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

  const clearKeywordsAndAuthors = () => {
    setPrimaryKeywords("");
    setSecondaryKeywords("");
    setKeywords("");
    setAuthorList("");
    if (selectedManuscriptId) {
      clearReviewerSearchFormState(selectedManuscriptId);
    }
  };

  // Find reviewers automatically from PubMed and OpenAlex
  const handleFindReviewers = async () => {
    if (!selectedManuscriptId) {
      toast.error("Please select a manuscript first so reviewers can be saved");
      return;
    }
    if (!keywords.trim()) {
      toast.error("Please enter keywords to search for reviewers");
      return;
    }

    setIsFindingReviewers(true);
    setCoauthorWarnings([]);

    const keywordList = keywords.split(",").map((k: string) => k.trim()).filter(Boolean);
    const namesById: Record<string, string> = {};
    for (const r of candidateReviewers) {
      namesById[r.id] = r.name;
    }
    const quickCoverage = computeExpertiseCoverage(
      quickFindExpertise,
      assignedExpertise,
      candidateReviewers.map((r) => r.id),
      namesById
    );
    const focusKeywords = computeFocusKeywords(
      quickFindExpertise,
      quickCoverage.coveredExpertise,
      quickCoverage.uncoveredExpertise
    );
    if (
      focusKeywords.length > 0 &&
      quickCoverage.uncoveredExpertise.length > 0 &&
      quickCoverage.coveredExpertise.length > 0
    ) {
      toast.info(`Focusing search on: ${focusKeywords.join(", ")}`);
    }
    const knownBefore = getKnownNamesBeforeRun();

    try {
      const response = await fetch("/api/reviewers/find", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authorList: authorList.trim() || undefined,
          keywords: keywordList,
          focusKeywords:
            focusKeywords.length > 0 &&
            quickCoverage.coveredExpertise.length > 0
              ? focusKeywords
              : undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to find reviewers");
      }

      const incoming: ReviewerCandidate[] = (data.reviewers || []).map(
        (r: ReviewerCandidate & { email?: string | null }) => ({
          ...r,
          email: r.email ?? null,
          isNewThisRun: !knownBefore.has(normalizeReviewerName(r.name)),
        })
      );
      const merged = mergeReviewerLists(candidateReviewers, incoming);
      const sorted = sortReviewersDisplayOrder(
        filterActiveReviewers(merged, flaggedReviewers, dbReviewerIndex),
        sortOptions
      );
      setCandidateReviewers(sorted);
      setCoauthorWarnings(data.coauthors || []);

      if (selectedManuscriptId && data.reviewers?.length > 0) {
        try {
          const mapped = sorted.map((r) => ({
            name: r.name,
            firstName: r.firstName,
            lastName: r.lastName,
            email: r.email,
            affiliation: r.affiliation,
            hIndex: r.hIndex,
            citationCount: r.citedByCount,
            publicationCount: r.worksCount,
            sources: r.source ? [r.source] : undefined,
            coiSummary: r.coiSummary,
          }));
          const saveRes = await fetch(`/api/manuscripts/${selectedManuscriptId}/reviewers`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reviewers: mapped }),
          });
          const saveData = await saveRes.json();
          if (saveRes.ok) {
            await loadPersistedReviewers(selectedManuscriptId);
            toast.success(
              `Found ${data.reviewers.length} potential reviewers — ${saveData.saved} saved to manuscript`
            );
          } else {
            toast.error(`Failed to save reviewers: ${saveData.error || saveRes.statusText}`);
          }
        } catch (err) {
          console.error("[AutoSave] Save error:", err);
          toast.error("Found reviewers but failed to save them to the manuscript");
        }
      } else {
        toast.success(
          `Found ${data.reviewers.length} potential reviewers from PubMed and OpenAlex`
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Search failed");
    } finally {
      setIsFindingReviewers(false);
    }
  };

  // Advanced reviewer discovery
  const handleAdvancedDiscovery = async () => {
    if (!selectedManuscriptId) {
      toast.error("Please select a manuscript first so reviewers can be saved");
      return;
    }
    if (!primaryKeywords.trim()) {
      toast.error("Please enter primary expertise keywords");
      return;
    }

    setIsDiscovering(true);

    const primaryList = primaryKeywords.split(",").map((k) => k.trim()).filter(Boolean);
    const focusKeywords = computeFocusKeywords(
      manuscriptExpertise,
      coveredExpertise,
      uncoveredExpertise
    );
    if (
      focusKeywords.length > 0 &&
      uncoveredExpertise.length > 0 &&
      coveredExpertise.length > 0
    ) {
      toast.info(`Focusing search on: ${focusKeywords.join(", ")}`);
    }
    const knownBefore = getKnownNamesBeforeRun();
    const previousReviewers = discoveryResult?.reviewers ?? [];

    try {
      const response = await fetch("/api/reviewers/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          primaryKeywords: primaryList,
          secondaryKeywords: secondaryKeywords
            ? secondaryKeywords.split(",").map((k) => k.trim()).filter(Boolean)
            : undefined,
          focusKeywords:
            coveredExpertise.length > 0 && uncoveredExpertise.length > 0
              ? focusKeywords
              : undefined,
          coveredExpertise:
            coveredExpertise.length > 0 ? coveredExpertise : undefined,
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

      const incoming = tagNewReviewers(
        (data.reviewers || []) as AdvancedReviewer[],
        knownBefore
      );
      const merged = mergeReviewerLists(previousReviewers, incoming);
      const sorted = sortReviewersDisplayOrder(
        filterActiveReviewers(merged, flaggedReviewers, dbReviewerIndex),
        sortOptions
      );
      setDiscoveryResult({
        ...data,
        reviewers: sorted,
      });

      const msId = selectedManuscriptId;
      const revCount = incoming.length;

      if (msId && revCount > 0) {
        try {
          const mapped = sorted.map((r) => ({
            name: r.name,
            firstName: r.firstName,
            lastName: r.lastName,
            email: r.email,
            affiliation: r.affiliation,
            country: r.country,
            hIndex: r.hIndex,
            citationCount: r.citationCount,
            publicationCount: r.publicationCount,
            sources: r.sources,
            recentArticles: r.recentArticles,
            verificationUrls: r.verificationUrls,
            llmAnalysis: r.llmAnalysis,
            coiSummary: r.coiSummary,
            inferredGender: r.inferredGender,
          }));
          const saveRes = await fetch(`/api/manuscripts/${msId}/reviewers`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reviewers: mapped }),
          });
          const saveData = await saveRes.json();
          if (saveRes.ok) {
            await loadPersistedReviewers(msId);
            toast.success(
              `Added ${revCount} reviewers (${sorted.length} total) from ${data.summary.diversity.countryCount} countries — ${saveData.saved} saved`
            );
          } else {
            toast.error(`Failed to save reviewers: ${saveData.error || saveRes.statusText}`);
          }
        } catch (err) {
          console.error("[AutoSave] Save error:", err);
          toast.error("Found reviewers but failed to save them to the manuscript");
        }
      } else {
        toast.success(
          `Found ${revCount} senior reviewers from ${data.summary.diversity.countryCount} countries`
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Discovery failed");
    } finally {
      setIsDiscovering(false);
    }
  };

  const [isSavingReviewers, setIsSavingReviewers] = useState(false);

  const saveReviewersToManuscript = async () => {
    if (!selectedManuscriptId) {
      toast.error("Select a manuscript first to save reviewers");
      return;
    }

    let reviewersToSave: { name: string; firstName?: string; lastName?: string; email?: string | null; affiliation?: string; hIndex?: number | null; citationCount?: number | null; publicationCount?: number; country?: string; sources?: string[]; recentArticles?: Record<string, unknown>[]; verificationUrls?: Record<string, string>; llmAnalysis?: Record<string, unknown>; coiSummary?: Record<string, unknown>; inferredGender?: string }[] = [];

    if (discoveryResult?.reviewers.length) {
      reviewersToSave = discoveryResult.reviewers.map(r => ({
        name: r.name,
        firstName: r.firstName,
        lastName: r.lastName,
        email: r.email,
        affiliation: r.affiliation,
        country: r.country,
        hIndex: r.hIndex,
        citationCount: r.citationCount,
        publicationCount: r.publicationCount,
        sources: r.sources,
        recentArticles: r.recentArticles as Record<string, unknown>[] | undefined,
        verificationUrls: r.verificationUrls,
        llmAnalysis: r.llmAnalysis as Record<string, unknown> | undefined,
        coiSummary: r.coiSummary as Record<string, unknown> | undefined,
        inferredGender: r.inferredGender,
      }));
    } else if (candidateReviewers.length) {
      reviewersToSave = candidateReviewers.map(r => ({
        name: r.name,
        firstName: r.firstName,
        lastName: r.lastName,
        email: r.email,
        affiliation: r.affiliation,
        hIndex: r.hIndex,
        citationCount: r.citedByCount,
        publicationCount: r.worksCount,
        sources: r.source ? [r.source] : undefined,
        coiSummary: r.coiSummary as Record<string, unknown> | undefined,
      }));
    }

    if (reviewersToSave.length === 0) {
      toast.error("No reviewers to save. Run a discovery first.");
      return;
    }

    setIsSavingReviewers(true);
    try {
      const res = await fetch(`/api/manuscripts/${selectedManuscriptId}/reviewers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewers: reviewersToSave }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`${data.saved} reviewer${data.saved !== 1 ? "s" : ""} saved to manuscript`);
      } else {
        toast.error(data.error || "Failed to save reviewers");
      }
    } catch {
      toast.error("Failed to save reviewers");
    } finally {
      setIsSavingReviewers(false);
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
      if (r.verificationUrls.institutionProfileUrl) {
        lines.push(`   Institution Profile: ${r.verificationUrls.institutionProfileUrl}`);
      }
      lines.push(`   Institution Search: ${r.verificationUrls.institutionSearchUrl}`);
      const expertise = assignedExpertise[r.id] || [];
      if (expertise.length > 0) {
        lines.push(`   Assigned Expertise: ${expertise.join(", ")}`);
      }
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
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportFlaggedReviewers}>
              <FileDown className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
          </div>
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

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ReviewerSearchActiveTab)} className="space-y-4">
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
                  Source Manuscript
                </Label>
                <ManuscriptSelector
                  value={selectedManuscriptId || undefined}
                  onChange={(m) => {
                    const prevId = selectedManuscriptId;
                    if (m?.id && m.id !== prevId) {
                      restoredManuscriptRef.current = null;
                    }
                    setSelectedManuscriptId(m?.id || null);
                    if (!m) {
                      if (prevId) clearReviewerSearchFormState(prevId);
                      clearKeywordsAndAuthors();
                      restoredManuscriptRef.current = null;
                    }
                  }}
                  onManuscriptData={(data) => {
                    if (data.keywords.length > 0) {
                      setPrimaryKeywords(data.keywords.slice(0, 3).join(", "));
                      if (data.keywords.length > 3) {
                        setSecondaryKeywords(data.keywords.slice(3).join(", "));
                      }
                    }
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
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Keywords &amp; Authors</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearKeywordsAndAuthors}
                    disabled={!primaryKeywords && !secondaryKeywords && !authorList}
                    className="h-7 text-xs text-gray-500 hover:text-red-600"
                  >
                    <XCircle className="h-3.5 w-3.5 mr-1" />
                    Clear All
                  </Button>
                </div>
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

          {/* Loading persisted reviewers */}
          {isLoadingPersisted && !discoveryResult && (
            <Card className="bg-blue-50 border-blue-200">
              <CardContent className="py-6 text-center">
                <Loader2 className="h-6 w-6 animate-spin text-blue-600 mx-auto mb-2" />
                <p className="text-sm text-blue-700">Loading saved reviewers...</p>
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
                          sessionStorage.setItem("coi_reviewers_import", reviewerNames);
                          if (authorList) {
                            sessionStorage.setItem("coi_authors_import", authorList);
                          }
                          if (selectedManuscriptId) {
                            sessionStorage.setItem("coi_manuscript_id", selectedManuscriptId);
                          }
                          router.push(coiPath);
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

              <ReviewerResultsList
                reviewers={sortedDiscoveryReviewers}
                manuscriptExpertise={manuscriptExpertise}
                expertiseCoverage={expertiseCoverage}
                coveredExpertise={coveredExpertise}
                uncoveredExpertise={uncoveredExpertise}
                assignedExpertise={assignedExpertise}
                flaggedReviewers={flaggedReviewers}
                onToggleExpertise={toggleExpertise}
                onToggleFlag={toggleFlag}
              />

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
                  Source Manuscript
                </Label>
                <ManuscriptSelector
                  value={selectedManuscriptId || undefined}
                  onChange={(m) => {
                    const prevId = selectedManuscriptId;
                    if (m?.id && m.id !== prevId) {
                      restoredManuscriptRef.current = null;
                    }
                    setSelectedManuscriptId(m?.id || null);
                    if (!m) {
                      if (prevId) clearReviewerSearchFormState(prevId);
                      clearKeywordsAndAuthors();
                      restoredManuscriptRef.current = null;
                    }
                  }}
                  onManuscriptData={(data) => {
                    if (data.keywords.length > 0) {
                      setKeywords(data.keywords.join(", "));
                    }
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

              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Keywords &amp; Authors</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearKeywordsAndAuthors}
                  disabled={!keywords && !authorList}
                  className="h-7 text-xs text-gray-500 hover:text-red-600"
                >
                  <XCircle className="h-3.5 w-3.5 mr-1" />
                  Clear All
                </Button>
              </div>

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
                {sortedCandidateReviewers.map((reviewer) => {
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
                              <h4 className="font-semibold text-sm">{reviewer.name}</h4>
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
                                onClick={(e) => { e.stopPropagation(); toggleFlag(reviewer.id, "up"); }}
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
                                onClick={(e) => { e.stopPropagation(); toggleFlag(reviewer.id, "down"); }}
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

                        {/* Expertise Assignment */}
                        {manuscriptExpertise.length > 0 && (
                          <div className="mb-2 p-2 bg-blue-50/50 rounded border border-blue-200">
                            <p className="text-xs font-medium text-blue-800 mb-1">Covers expertise:</p>
                            <div className="flex flex-wrap gap-1">
                              {manuscriptExpertise.map(exp => {
                                const isChecked = (assignedExpertise[reviewer.id] || []).includes(exp);
                                return (
                                  <button
                                    key={exp}
                                    onClick={(e) => { e.stopPropagation(); toggleExpertise(reviewer.id, exp); }}
                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors ${
                                      isChecked
                                        ? "bg-green-100 text-green-800 border-green-300"
                                        : "bg-white text-gray-500 border-gray-300 hover:border-blue-400 hover:text-blue-700"
                                    }`}
                                  >
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

