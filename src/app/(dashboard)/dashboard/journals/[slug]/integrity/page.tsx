"use client";

import { useState, Suspense } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  AlertTriangle, 
  CheckCircle, 
  Search, 
  Loader2, 
  FileText, 
  AlertCircle,
  Info,
  Shield,
  BookOpen,
  Sparkles,
  User,
  Mail,
  Building,
  Plus,
  Trash2,
  Link,
  XCircle
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ManuscriptSelector } from "@/components/manuscript";

interface TorturedPhraseMatch {
  pattern: {
    id: string;
    torturedPhrase: string;
    originalPhrase: string;
    category: string;
    severity: "high" | "medium" | "low";
  };
  matchedText: string;
  location: {
    startIndex: number;
    endIndex: number;
    context: string;
  };
}

interface TorturedPhrasesResult {
  found: boolean;
  matchCount: number;
  matches: TorturedPhraseMatch[];
  summary: string;
  severity: "none" | "low" | "medium" | "high";
  disclaimer: string;
}

interface AuthorInput {
  name: string;
  email: string;
  orcid: string;
  affiliation: string;
}

interface ReferenceValidation {
  input: { raw: string; doi?: string; pmid?: string };
  doi: {
    found: boolean;
    valid: boolean | null;
    resolvedTitle?: string;
    resolvedAuthors?: string[];
    resolvedYear?: number;
    resolvedJournal?: string;
    issues: string[];
  };
  pmid: {
    found: boolean;
    valid: boolean | null;
    title?: string;
    issues: string[];
  };
  retraction: {
    checked: boolean;
    isRetracted: boolean | null;
    retractionDate?: string;
  };
  status: "valid" | "not_found" | "retracted" | "suspicious" | "unchecked";
  confidence: "high" | "medium" | "low" | "unverified";
  issues: string[];
}

interface ReferenceResult {
  references: ReferenceValidation[];
  summary: {
    total: number;
    valid: number;
    notFound: number;
    retracted: number;
    suspicious: number;
    unchecked: number;
  };
}

interface IdentityResult {
  author: { name: string; email?: string; orcid?: string; affiliation?: string };
  orcid: {
    orcidProvided: boolean;
    orcidExists: boolean | null;
    nameMatch: "exact" | "partial" | "mismatch" | "unknown";
    confidence: "high" | "medium" | "low" | "unverified";
    issues: string[];
    orcidProfile?: { givenName?: string; familyName?: string; worksCount?: number };
  };
  email: {
    emailProvided: boolean;
    domain?: string;
    domainType: "institutional" | "personal" | "disposable" | "unknown";
    matchesAffiliation: boolean | null;
    issues: string[];
  };
  affiliation: {
    affiliationProvided: boolean;
    institutionExists: boolean | null;
    officialName?: string;
    country?: string;
    issues: string[];
  };
  overallConfidence: "high" | "medium" | "low" | "unverified";
  indicatorsFound: number;
  summary: string;
}

function IntegrityCheckContent() {
  const params = useParams();
  const slug = params.slug as string;

  // Manuscript source state
  const [selectedManuscriptId, setSelectedManuscriptId] = useState<string | null>(null);

  // Tortured phrases state
  const [text, setText] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<TorturedPhrasesResult | null>(null);

  // Identity verification state
  const [authors, setAuthors] = useState<AuthorInput[]>([
    { name: "", email: "", orcid: "", affiliation: "" }
  ]);
  const [isVerifying, setIsVerifying] = useState(false);
  const [identityResults, setIdentityResults] = useState<IdentityResult[] | null>(null);

  // Reference validation state
  const [referenceText, setReferenceText] = useState("");
  const [isValidatingRefs, setIsValidatingRefs] = useState(false);
  const [referenceResult, setReferenceResult] = useState<ReferenceResult | null>(null);

  const handleAnalyze = async () => {
    if (!text.trim() || text.length < 100) {
      toast.error("Please enter at least 100 characters for meaningful analysis");
      return;
    }

    setIsAnalyzing(true);
    setResult(null);

    try {
      const response = await fetch("/api/integrity/tortured-phrases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Analysis failed");
      }

      setResult(data.result);
      
      if (data.result.found) {
        toast.warning(`${data.result.matchCount} potential indicator(s) found — review required`);
      } else {
        toast.info("No language anomalies detected in automated screening");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Analysis failed");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Identity verification handlers
  const addAuthor = () => {
    setAuthors([...authors, { name: "", email: "", orcid: "", affiliation: "" }]);
  };

  const removeAuthor = (index: number) => {
    if (authors.length > 1) {
      setAuthors(authors.filter((_, i) => i !== index));
    }
  };

  const updateAuthor = (index: number, field: keyof AuthorInput, value: string) => {
    const updated = [...authors];
    updated[index][field] = value;
    setAuthors(updated);
  };

  const handleVerifyIdentity = async () => {
    const validAuthors = authors.filter(a => a.name.trim());
    if (validAuthors.length === 0) {
      toast.error("Please enter at least one author name");
      return;
    }

    setIsVerifying(true);
    setIdentityResults(null);

    try {
      const response = await fetch("/api/integrity/identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authors: validAuthors }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Verification failed");
      }

      setIdentityResults(data.results);
      
      if (data.summary.totalIndicators > 0) {
        toast.warning(`${data.summary.totalIndicators} indicator(s) found for ${data.summary.authorsWithIndicators} author(s)`);
      } else {
        toast.info("No verification issues detected");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Verification failed");
    } finally {
      setIsVerifying(false);
    }
  };

  // Reference validation handler
  const handleValidateReferences = async () => {
    if (!referenceText.trim() || referenceText.length < 50) {
      toast.error("Please paste at least 50 characters of reference text");
      return;
    }

    setIsValidatingRefs(true);
    setReferenceResult(null);

    try {
      const response = await fetch("/api/integrity/references", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: referenceText }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Validation failed");
      }

      setReferenceResult(data);
      
      const { summary } = data;
      if (summary.retracted > 0) {
        toast.error(`⚠️ ${summary.retracted} RETRACTED reference(s) found!`);
      } else if (summary.notFound > 0) {
        toast.warning(`${summary.notFound} reference(s) could not be verified`);
      } else {
        toast.info(`${summary.valid} of ${summary.total} references validated`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Validation failed");
    } finally {
      setIsValidatingRefs(false);
    }
  };

  const getStatusBadge = (status: ReferenceValidation["status"]) => {
    switch (status) {
      case "valid":
        return <Badge className="bg-green-100 text-green-800"><CheckCircle className="h-3 w-3 mr-1" />Valid</Badge>;
      case "not_found":
        return <Badge className="bg-amber-100 text-amber-800"><AlertCircle className="h-3 w-3 mr-1" />Not Found</Badge>;
      case "retracted":
        return <Badge className="bg-red-100 text-red-800"><XCircle className="h-3 w-3 mr-1" />RETRACTED</Badge>;
      case "suspicious":
        return <Badge className="bg-orange-100 text-orange-800"><AlertTriangle className="h-3 w-3 mr-1" />Suspicious</Badge>;
      default:
        return <Badge className="bg-gray-100 text-gray-800">Unchecked</Badge>;
    }
  };

  const getConfidenceBadge = (confidence: "high" | "medium" | "low" | "unverified") => {
    switch (confidence) {
      case "high":
        return <Badge className="bg-green-100 text-green-800">High Confidence</Badge>;
      case "medium":
        return <Badge className="bg-amber-100 text-amber-800">Review Recommended</Badge>;
      case "low":
        return <Badge className="bg-orange-100 text-orange-800">Attention Required</Badge>;
      default:
        return <Badge className="bg-gray-100 text-gray-800">Unverified</Badge>;
    }
  };

  const getSeverityBadge = (severity: "high" | "medium" | "low") => {
    switch (severity) {
      case "high":
        return <Badge className="bg-orange-100 text-orange-800 border-orange-200">High Relevance</Badge>;
      case "medium":
        return <Badge className="bg-amber-100 text-amber-800 border-amber-200">Medium</Badge>;
      case "low":
        return <Badge className="bg-blue-100 text-blue-800 border-blue-200">Low</Badge>;
    }
  };

  const getCategoryBadge = (category: string) => {
    const displayNames: Record<string, string> = {
      ai_ml: "AI/ML",
      statistics: "Statistics",
      methodology: "Methodology",
      biology: "Biology",
      chemistry: "Chemistry",
      physics: "Physics",
      computing: "Computing",
      general_academic: "Academic",
    };
    return <Badge variant="outline">{displayNames[category] || category}</Badge>;
  };

  const getSeverityCardClass = (severity: TorturedPhrasesResult["severity"]) => {
    switch (severity) {
      case "high":
        return "border-orange-300 bg-orange-50";
      case "medium":
        return "border-amber-300 bg-amber-50";
      case "low":
        return "border-blue-200 bg-blue-50";
      default:
        return "border-green-200 bg-green-50";
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold">Research Integrity Screening</h1>
        <p className="text-gray-500">
          Automated screening tools to assist editorial review of manuscripts
        </p>
      </div>

      {/* Automated Screening Notice */}
      <Card className="bg-amber-50 border-amber-200">
        <CardContent className="py-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-amber-800">
              <p className="font-medium">Automated Screening Notice</p>
              <p className="text-amber-700">
                These tools provide automated indicators only and do not constitute accusations or 
                determinations of misconduct. All findings require editorial review and human judgment. 
                Unusual patterns may have legitimate explanations.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Manuscript Source */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Load from Manuscript
          </CardTitle>
          <CardDescription>
            Select an uploaded manuscript to auto-populate text and author data for screening
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ManuscriptSelector
            value={selectedManuscriptId || undefined}
            onChange={(m) => setSelectedManuscriptId(m?.id || null)}
            onManuscriptData={async (data) => {
              // Fetch full manuscript text for analysis
              if (data.abstract) {
                setText(data.abstract);
              }
              // Populate authors
              if (data.authors.length > 0) {
                setAuthors(data.authors.map(a => ({
                  name: a.name,
                  email: a.email || "",
                  orcid: "",
                  affiliation: a.affiliation || "",
                })));
              }
              // Populate references for validation
              if (data.references && data.references.length > 0) {
                const refText = data.references
                  .map(r => r.rawText)
                  .join("\n\n");
                setReferenceText(refText);
              }
              // Summary notification
              const parts = [];
              if (data.authors.length > 0) parts.push(`${data.authors.length} authors`);
              if (data.references && data.references.length > 0) parts.push(`${data.references.length} references`);
              if (data.abstract) parts.push("abstract");
              if (parts.length > 0) {
                toast.success(`Loaded ${parts.join(", ")} from manuscript`);
              }
            }}
            placeholder="Select manuscript for integrity screening"
          />
        </CardContent>
      </Card>

      <Tabs defaultValue="tortured-phrases" className="space-y-4">
        <TabsList>
          <TabsTrigger value="tortured-phrases">
            <FileText className="h-4 w-4 mr-2" />
            Language Anomalies
          </TabsTrigger>
          <TabsTrigger value="identity">
            <User className="h-4 w-4 mr-2" />
            Author Identity
          </TabsTrigger>
          <TabsTrigger value="references">
            <Link className="h-4 w-4 mr-2" />
            References
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tortured-phrases" className="space-y-4">
          {/* Explanation Card */}
          <Card className="bg-blue-50 border-blue-200">
            <CardContent className="py-3">
              <div className="flex items-start gap-2">
                <Info className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-blue-800">
                  <p className="font-medium">About Tortured Phrases</p>
                  <p className="text-blue-700">
                    "Tortured phrases" are unusual word substitutions that may indicate text processed 
                    through synonym replacement tools, sometimes associated with paper mills. Examples: 
                    "profound learning" (deep learning), "counterfeit consciousness" (artificial intelligence).
                    Detection is based on research by Cabanac, Labbé, and colleagues.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                Language Anomaly Detection
              </CardTitle>
              <CardDescription>
                Paste manuscript text to screen for known tortured phrase patterns. 
                This tool assists editorial review — it does not make determinations.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="text">Manuscript Text</Label>
                <Textarea
                  id="text"
                  placeholder="Paste the manuscript abstract, introduction, or full text here for analysis..."
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={10}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-gray-500">
                  {text.length.toLocaleString()} characters • Minimum 100 characters required
                </p>
              </div>

              <Button 
                onClick={handleAnalyze} 
                disabled={isAnalyzing || text.length < 100}
                size="lg"
              >
                {isAnalyzing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Search className="h-4 w-4 mr-2" />
                )}
                Run Screening
              </Button>
            </CardContent>
          </Card>

          {/* Results */}
          {result && (
            <Card className={getSeverityCardClass(result.severity)}>
              <CardHeader>
                <div className="flex items-center gap-2">
                  {result.found ? (
                    <AlertCircle className="h-6 w-6 text-amber-600" />
                  ) : (
                    <CheckCircle className="h-6 w-6 text-green-600" />
                  )}
                  <CardTitle className={result.found ? "text-amber-800" : "text-green-800"}>
                    {result.found 
                      ? `⚠️ ${result.matchCount} Potential Indicator(s) — Editorial Review Recommended`
                      : "No Indicators Found in Automated Screening"
                    }
                  </CardTitle>
                </div>
                <CardDescription className={result.found ? "text-amber-700" : "text-green-700"}>
                  {result.summary}
                </CardDescription>
              </CardHeader>

              {result.found && (
                <CardContent className="space-y-4">
                  {/* Disclaimer */}
                  <div className="bg-white/50 rounded-lg p-3 text-sm text-gray-700 italic">
                    {result.disclaimer}
                  </div>

                  <Separator />

                  {/* Matches */}
                  <div className="space-y-3">
                    <h4 className="font-semibold text-gray-900">Detected Patterns</h4>
                    {result.matches.map((match, index) => (
                      <div
                        key={index}
                        className="bg-white rounded-lg border p-4 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {getSeverityBadge(match.pattern.severity)}
                            {getCategoryBadge(match.pattern.category)}
                          </div>
                        </div>
                        
                        <div className="grid md:grid-cols-2 gap-4">
                          <div>
                            <p className="text-xs text-gray-500 mb-1">Detected Phrase</p>
                            <p className="font-medium text-red-700">
                              "{match.matchedText}"
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 mb-1">Possible Original</p>
                            <p className="font-medium text-green-700">
                              "{match.pattern.originalPhrase}"
                            </p>
                          </div>
                        </div>

                        <div>
                          <p className="text-xs text-gray-500 mb-1">Context</p>
                          <p className="text-sm text-gray-600 bg-gray-50 p-2 rounded font-mono">
                            {match.location.context}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <Separator />

                  {/* Category Breakdown */}
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-2">Category Breakdown</h4>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(
                        result.matches.reduce((acc, m) => {
                          acc[m.pattern.category] = (acc[m.pattern.category] || 0) + 1;
                          return acc;
                        }, {} as Record<string, number>)
                      ).map(([category, count]) => (
                        <Badge key={category} variant="secondary">
                          {category.replace("_", " ")}: {count}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </CardContent>
              )}

              {!result.found && (
                <CardContent>
                  <p className="text-sm text-green-700">
                    No known tortured phrase patterns were detected in the provided text. 
                    This automated check may not capture all potential issues. 
                    Editorial discretion is advised for comprehensive review.
                  </p>
                </CardContent>
              )}
            </Card>
          )}

          {/* Reference Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <BookOpen className="h-4 w-4" />
                References & Background
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-gray-600 space-y-2">
              <p>
                Tortured phrase detection is based on research documenting unusual word 
                substitutions in potentially problematic papers:
              </p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>
                  Cabanac, G., Labbé, C., & Magazinov, A. (2021). "Tortured phrases: 
                  A dubious writing style emerging in science." arXiv:2107.06751
                </li>
                <li>
                  Problematic Paper Screener - Community detection efforts
                </li>
              </ul>
              <p className="text-xs text-gray-500 mt-3">
                This tool is provided for editorial assistance. Results should always be 
                verified by human reviewers before any editorial decisions are made.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Identity Verification Tab */}
        <TabsContent value="identity" className="space-y-4">
          <Card className="bg-blue-50 border-blue-200">
            <CardContent className="py-3">
              <div className="flex items-start gap-2">
                <Info className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-blue-800">
                  <p className="font-medium">About Identity Verification</p>
                  <p className="text-blue-700">
                    Validates author details against ORCID registry and ROR (Research Organization Registry).
                    Checks ORCID existence, name matching, email domain classification, and institution verification.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <User className="h-5 w-5" />
                    Author Identity Verification
                  </CardTitle>
                  <CardDescription>
                    Enter author details to verify against public registries
                  </CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={addAuthor}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Author
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {authors.map((author, index) => (
                <div key={index} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">Author {index + 1}</span>
                    {authors.length > 1 && (
                      <Button variant="ghost" size="sm" onClick={() => removeAuthor(index)}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    )}
                  </div>
                  <div className="grid md:grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Name *</Label>
                      <Input
                        placeholder="Full name"
                        value={author.name}
                        onChange={(e) => updateAuthor(index, "name", e.target.value)}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Email</Label>
                      <Input
                        type="email"
                        placeholder="email@institution.edu"
                        value={author.email}
                        onChange={(e) => updateAuthor(index, "email", e.target.value)}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">ORCID</Label>
                      <Input
                        placeholder="0000-0000-0000-0000"
                        value={author.orcid}
                        onChange={(e) => updateAuthor(index, "orcid", e.target.value)}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Affiliation</Label>
                      <Input
                        placeholder="Institution name"
                        value={author.affiliation}
                        onChange={(e) => updateAuthor(index, "affiliation", e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              ))}

              <Button onClick={handleVerifyIdentity} disabled={isVerifying} size="lg">
                {isVerifying ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Shield className="h-4 w-4 mr-2" />
                )}
                Verify Author Identity
              </Button>
            </CardContent>
          </Card>

          {/* Identity Results */}
          {identityResults && identityResults.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Verification Results</h3>
              
              {identityResults.map((result, index) => (
                <Card 
                  key={index}
                  className={
                    result.overallConfidence === "high" ? "border-green-200 bg-green-50" :
                    result.overallConfidence === "medium" ? "border-amber-200 bg-amber-50" :
                    result.overallConfidence === "low" ? "border-orange-200 bg-orange-50" :
                    "border-gray-200 bg-gray-50"
                  }
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        <User className="h-4 w-4" />
                        {result.author.name}
                      </CardTitle>
                      {getConfidenceBadge(result.overallConfidence)}
                    </div>
                    <CardDescription>{result.summary}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* ORCID Section */}
                    <div className="bg-white rounded-lg border p-3">
                      <h5 className="text-sm font-medium flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="bg-green-50">ORCID</Badge>
                        {result.orcid.orcidExists === true && (
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        )}
                        {result.orcid.orcidExists === false && (
                          <AlertCircle className="h-4 w-4 text-orange-600" />
                        )}
                      </h5>
                      {result.orcid.orcidProvided ? (
                        <div className="text-sm space-y-1">
                          <p>Status: {result.orcid.orcidExists ? "Found in registry" : "Not found"}</p>
                          {result.orcid.orcidProfile && (
                            <>
                              <p>Profile name: {result.orcid.orcidProfile.givenName} {result.orcid.orcidProfile.familyName}</p>
                              <p>Works: {result.orcid.orcidProfile.worksCount || 0}</p>
                            </>
                          )}
                          <p>Name match: <Badge variant="secondary" className="ml-1">{result.orcid.nameMatch}</Badge></p>
                          {result.orcid.issues.length > 0 && (
                            <div className="mt-2 text-orange-700">
                              {result.orcid.issues.map((issue, i) => (
                                <p key={i} className="text-xs">⚠️ {issue}</p>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-500">No ORCID provided</p>
                      )}
                    </div>

                    {/* Email Section */}
                    <div className="bg-white rounded-lg border p-3">
                      <h5 className="text-sm font-medium flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="bg-blue-50">
                          <Mail className="h-3 w-3 mr-1" />
                          Email
                        </Badge>
                      </h5>
                      {result.email.emailProvided ? (
                        <div className="text-sm space-y-1">
                          <p>Domain: {result.email.domain}</p>
                          <p>Type: <Badge variant="secondary" className={
                            result.email.domainType === "institutional" ? "bg-green-100" :
                            result.email.domainType === "personal" ? "bg-amber-100" :
                            result.email.domainType === "disposable" ? "bg-red-100" :
                            ""
                          }>{result.email.domainType}</Badge></p>
                          {result.email.matchesAffiliation !== null && (
                            <p>Matches affiliation: {result.email.matchesAffiliation ? "Yes" : "No"}</p>
                          )}
                          {result.email.issues.length > 0 && (
                            <div className="mt-2 text-orange-700">
                              {result.email.issues.map((issue, i) => (
                                <p key={i} className="text-xs">⚠️ {issue}</p>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-500">No email provided</p>
                      )}
                    </div>

                    {/* Affiliation Section */}
                    <div className="bg-white rounded-lg border p-3">
                      <h5 className="text-sm font-medium flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="bg-purple-50">
                          <Building className="h-3 w-3 mr-1" />
                          Affiliation
                        </Badge>
                        {result.affiliation.institutionExists === true && (
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        )}
                      </h5>
                      {result.affiliation.affiliationProvided ? (
                        <div className="text-sm space-y-1">
                          <p>Status: {result.affiliation.institutionExists ? "Found in ROR" : "Not found in ROR"}</p>
                          {result.affiliation.officialName && (
                            <p>Official name: {result.affiliation.officialName}</p>
                          )}
                          {result.affiliation.country && (
                            <p>Country: {result.affiliation.country}</p>
                          )}
                          {result.affiliation.issues.length > 0 && (
                            <div className="mt-2 text-orange-700">
                              {result.affiliation.issues.map((issue, i) => (
                                <p key={i} className="text-xs">⚠️ {issue}</p>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-500">No affiliation provided</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}

              <Card className="bg-gray-50">
                <CardContent className="py-3 text-xs text-gray-600 italic">
                  These results are automated indicators only. Identity verification involves many factors 
                  that cannot be fully assessed automatically. All findings require editorial review and 
                  human judgment before any action is taken.
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* Reference Validation Tab */}
        <TabsContent value="references" className="space-y-4">
          <Card className="bg-blue-50 border-blue-200">
            <CardContent className="py-3">
              <div className="flex items-start gap-2">
                <Info className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-blue-800">
                  <p className="font-medium">About Reference Validation</p>
                  <p className="text-blue-700">
                    Validates DOIs and PubMed IDs against Crossref and PubMed databases. 
                    Checks for retracted papers. Cannot verify citation context or relevance.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Link className="h-5 w-5" />
                Reference Validation
              </CardTitle>
              <CardDescription>
                Paste the reference list from the manuscript to validate DOIs and check for retractions
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="refText">Reference List</Label>
                <Textarea
                  id="refText"
                  placeholder="Paste the reference list here. Each reference should be on a new line. DOIs and PMIDs will be automatically extracted..."
                  value={referenceText}
                  onChange={(e) => setReferenceText(e.target.value)}
                  rows={10}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-gray-500">
                  {referenceText.length.toLocaleString()} characters
                </p>
              </div>

              <Button 
                onClick={handleValidateReferences} 
                disabled={isValidatingRefs || referenceText.length < 50}
                size="lg"
              >
                {isValidatingRefs ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Search className="h-4 w-4 mr-2" />
                )}
                Validate References
              </Button>
            </CardContent>
          </Card>

          {/* Reference Results */}
          {referenceResult && (
            <div className="space-y-4">
              {/* Summary */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Validation Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-center">
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-2xl font-bold">{referenceResult.summary.total}</p>
                      <p className="text-xs text-gray-500">Total</p>
                    </div>
                    <div className="bg-green-50 rounded-lg p-3">
                      <p className="text-2xl font-bold text-green-700">{referenceResult.summary.valid}</p>
                      <p className="text-xs text-green-600">Valid</p>
                    </div>
                    <div className="bg-amber-50 rounded-lg p-3">
                      <p className="text-2xl font-bold text-amber-700">{referenceResult.summary.notFound}</p>
                      <p className="text-xs text-amber-600">Not Found</p>
                    </div>
                    <div className={`rounded-lg p-3 ${referenceResult.summary.retracted > 0 ? "bg-red-100" : "bg-gray-50"}`}>
                      <p className={`text-2xl font-bold ${referenceResult.summary.retracted > 0 ? "text-red-700" : "text-gray-400"}`}>
                        {referenceResult.summary.retracted}
                      </p>
                      <p className={`text-xs ${referenceResult.summary.retracted > 0 ? "text-red-600 font-medium" : "text-gray-500"}`}>
                        Retracted
                      </p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-2xl font-bold text-gray-500">{referenceResult.summary.unchecked}</p>
                      <p className="text-xs text-gray-500">Unchecked</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Retracted papers warning */}
              {referenceResult.summary.retracted > 0 && (
                <Card className="border-red-300 bg-red-50">
                  <CardContent className="py-4">
                    <div className="flex items-start gap-2">
                      <XCircle className="h-5 w-5 text-red-600 mt-0.5" />
                      <div>
                        <p className="font-medium text-red-800">⚠️ Retracted Reference(s) Detected</p>
                        <p className="text-sm text-red-700">
                          {referenceResult.summary.retracted} reference(s) appear to cite retracted papers. 
                          This requires immediate editorial attention.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Individual references */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Reference Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {referenceResult.references.map((ref, index) => (
                    <div 
                      key={index} 
                      className={`rounded-lg border p-3 ${
                        ref.status === "retracted" ? "border-red-300 bg-red-50" :
                        ref.status === "valid" ? "bg-white" :
                        ref.status === "not_found" ? "border-amber-200 bg-amber-50" :
                        "bg-gray-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-700 line-clamp-2">{ref.input.raw}</p>
                          {ref.doi.resolvedTitle && (
                            <p className="text-xs text-gray-500 mt-1">
                              Resolved: {ref.doi.resolvedTitle}
                            </p>
                          )}
                          {ref.input.doi && (
                            <p className="text-xs text-blue-600 mt-1">
                              DOI: {ref.input.doi}
                            </p>
                          )}
                          {ref.retraction.isRetracted && (
                            <p className="text-xs text-red-700 font-medium mt-1">
                              ⚠️ This paper was RETRACTED
                              {ref.retraction.retractionDate && ` on ${ref.retraction.retractionDate}`}
                            </p>
                          )}
                          {ref.issues.length > 0 && (
                            <div className="mt-1">
                              {ref.issues.map((issue, i) => (
                                <p key={i} className="text-xs text-orange-700">{issue}</p>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex-shrink-0">
                          {getStatusBadge(ref.status)}
                        </div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="bg-gray-50">
                <CardContent className="py-3 text-xs text-gray-600 italic">
                  Reference validation checks DOIs and PMIDs against Crossref and PubMed databases. 
                  It cannot verify citation context, relevance, or accuracy of claims. 
                  Retraction checks may not be comprehensive. All findings require editorial review.
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function IntegrityCheckPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64">Loading...</div>}>
      <IntegrityCheckContent />
    </Suspense>
  );
}
