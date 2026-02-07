"use client";

import { useState, useEffect, Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  AlertTriangle, CheckCircle, Search, ExternalLink, Loader2, Plus, Trash2, 
  Calendar, Info, Building, Users, UserCheck, AlertCircle, Star, Download, FileText
} from "lucide-react";
import { toast } from "sonner";
import { ManuscriptSelector } from "@/components/manuscript";

// Author roles with priority levels (scientific convention)
// Last author = PI/senior (most important)
// First author = did the work (second most important)
// Middle authors = decreasing importance by position
type AuthorRole = "corresponding" | "first" | "last" | "middle_early" | "middle_late";

interface Author {
  name: string;
  orcid: string;
  role: AuthorRole;
  position?: number; // Original position in author list
}

interface Reviewer {
  name: string;
  orcid: string;
}

interface ConflictIndicator {
  type: "coauthorship" | "affiliation";
  authorName: string;
  authorRole: AuthorRole;
  authorPosition?: number;
  reviewerName: string;
  details: {
    title?: string;
    year?: number;
    doi?: string;
    openAlexId?: string;
    institutionName?: string;
    affiliationType?: string;
  };
  severity: "critical" | "high" | "medium" | "low";
}

interface BatchCOIResult {
  summary: {
    totalChecks: number;
    conflictsFound: number;
    criticalConflicts: number;
    highConflicts: number;
    mediumConflicts: number;
    lowConflicts: number;
  };
  conflicts: ConflictIndicator[];
  clearPairs: { author: string; reviewer: string }[];
  checkedAt: string;
}

// Priority configuration for author roles (scientific convention)
// Last = most important (PI), First = second most important, Middle = decreasing by position
const ROLE_PRIORITY: Record<AuthorRole, { label: string; severity: "critical" | "high" | "medium"; color: string }> = {
  last: { label: "Last/Senior Author (PI)", severity: "critical", color: "bg-red-100 text-red-800 border-red-300" },
  first: { label: "First Author", severity: "critical", color: "bg-red-100 text-red-800 border-red-300" },
  corresponding: { label: "Corresponding Author", severity: "critical", color: "bg-red-100 text-red-800 border-red-300" },
  middle_early: { label: "Co-Author (2nd-3rd)", severity: "high", color: "bg-orange-100 text-orange-800 border-orange-300" },
  middle_late: { label: "Co-Author", severity: "medium", color: "bg-amber-100 text-amber-800 border-amber-300" },
};

// Generate year options
function generateYearOptions() {
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let year = currentYear; year >= currentYear - 20; year--) {
    years.push(year);
  }
  return years;
}

function COICheckContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const slug = params.slug as string;
  const submissionId = searchParams.get("submissionId");

  // Manuscript source state
  const [selectedManuscriptId, setSelectedManuscriptId] = useState<string | null>(null);

  // Authors state - default to first author for single entry
  const [authors, setAuthors] = useState<Author[]>([
    { name: "", orcid: "", role: "first", position: 1 }
  ]);
  
  // Reviewers state
  const [reviewers, setReviewers] = useState<Reviewer[]>([
    { name: "", orcid: "" }
  ]);
  
  // Settings
  const [fromYear, setFromYear] = useState<string>("");
  const [isChecking, setIsChecking] = useState(false);
  const [batchResult, setBatchResult] = useState<BatchCOIResult | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const yearOptions = generateYearOptions();

  // Load submission authors if submissionId provided
  // Uses scientific convention: last = PI, first = primary, middle = decreasing importance
  useEffect(() => {
    if (submissionId) {
      fetch(`/api/journals/${slug}/submissions/${submissionId}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.submission?.authors) {
            const total = data.submission.authors.length;
            setAuthors(
              data.submission.authors.map((a: { name: string; orcid: string | null }, index: number) => {
                let role: AuthorRole;
                if (index === total - 1) {
                  role = "last"; // PI/senior - most important
                } else if (index === 0) {
                  role = "first"; // Primary author - second most important
                } else if (index <= 2) {
                  role = "middle_early"; // 2nd, 3rd - high priority
                } else {
                  role = "middle_late"; // Others - medium priority
                }
                return {
                  name: a.name,
                  orcid: a.orcid || "",
                  role,
                  position: index + 1,
                };
              })
            );
          }
        })
        .catch(console.error);
    }
  }, [slug, submissionId]);

  // Load imported reviewers/authors from reviewer discovery page (via sessionStorage)
  useEffect(() => {
    const importedReviewers = sessionStorage.getItem("coi_reviewers_import");
    const importedAuthors = sessionStorage.getItem("coi_authors_import");

    if (importedReviewers) {
      const names = importedReviewers.split("\n").filter(n => n.trim());
      if (names.length > 0) {
        setReviewers(names.map(name => ({ name: name.trim(), orcid: "" })));
        toast.success(`Imported ${names.length} reviewers from discovery`);
      }
      sessionStorage.removeItem("coi_reviewers_import");
    }

    if (importedAuthors) {
      const names = importedAuthors.split("\n").filter(n => n.trim()).map(n => n.replace(/\d+/g, "").trim());
      if (names.length > 0) {
        const total = names.length;
        setAuthors(names.map((name, index) => {
          let role: AuthorRole;
          if (index === total - 1) role = "last";
          else if (index === 0) role = "first";
          else if (index <= 2) role = "middle_early";
          else role = "middle_late";
          return { name, orcid: "", role, position: index + 1 };
        }));
      }
      sessionStorage.removeItem("coi_authors_import");
    }
  }, []);

  // Author management
  const addAuthor = () => {
    const newPosition = authors.length + 1;
    // Default new authors to middle_late, user can change
    setAuthors([...authors, { name: "", orcid: "", role: "middle_late", position: newPosition }]);
  };

  const removeAuthor = (index: number) => {
    if (authors.length > 1) {
      setAuthors(authors.filter((_, i) => i !== index));
    }
  };

  const updateAuthor = (index: number, field: keyof Author, value: string) => {
    const updated = [...authors];
    updated[index] = { ...updated[index], [field]: value };
    setAuthors(updated);
  };

  // Reviewer management
  const addReviewer = () => {
    setReviewers([...reviewers, { name: "", orcid: "" }]);
  };

  const removeReviewer = (index: number) => {
    if (reviewers.length > 1) {
      setReviewers(reviewers.filter((_, i) => i !== index));
    }
  };

  const updateReviewer = (index: number, field: keyof Reviewer, value: string) => {
    const updated = [...reviewers];
    updated[index] = { ...updated[index], [field]: value };
    setReviewers(updated);
  };

  // Bulk import handlers - following scientific convention:
  // Last author = most important (PI/senior), First = second most important
  // Middle authors: 2nd, 3rd are more important than 4th, 5th, etc.
  const handleBulkAuthors = (text: string) => {
    const lines = text.split(/[\n,]/).map(l => l.trim()).filter(Boolean);
    if (lines.length > 0) {
      const newAuthors = lines.map((name, index) => {
        let role: AuthorRole;
        const position = index + 1;
        const total = lines.length;
        
        if (index === total - 1) {
          // Last author = PI/senior (most important)
          role = "last";
        } else if (index === 0) {
          // First author = did the work (second most important)
          role = "first";
        } else if (index <= 2) {
          // 2nd and 3rd authors = early middle (high priority)
          role = "middle_early";
        } else {
          // 4th onwards = late middle (medium priority)
          role = "middle_late";
        }
        
        return { name, orcid: "", role, position };
      });
      setAuthors(newAuthors);
      toast.success(`Loaded ${newAuthors.length} authors (Last = PI, First = primary)`);
    }
  };

  const handleBulkReviewers = (text: string) => {
    const lines = text.split(/[\n,]/).map(l => l.trim()).filter(Boolean);
    if (lines.length > 0) {
      const newReviewers = lines.map(name => ({ name, orcid: "" }));
      setReviewers(newReviewers);
      toast.success(`Loaded ${newReviewers.length} reviewers`);
    }
  };

  // Run batch COI check
  const handleBatchCheck = async () => {
    const validAuthors = authors.filter((a) => a.name.trim());
    const validReviewers = reviewers.filter((r) => r.name.trim());

    if (validAuthors.length === 0) {
      toast.error("Please enter at least one author");
      return;
    }

    if (validReviewers.length === 0) {
      toast.error("Please enter at least one reviewer");
      return;
    }

    setIsChecking(true);
    setBatchResult(null);
    
    const totalChecks = validAuthors.length * validReviewers.length;
    setProgress({ current: 0, total: totalChecks });

    try {
      const response = await fetch("/api/coi/batch-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authors: validAuthors.map((a) => ({
            name: a.name,
            orcid: a.orcid || null,
            role: a.role,
          })),
          reviewers: validReviewers.map((r) => ({
            name: r.name,
            orcid: r.orcid || null,
          })),
          fromYear: fromYear && fromYear !== "all" ? parseInt(fromYear) : undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Batch COI check failed");
      }

      setBatchResult(data.result);
      
      if (data.result.summary.conflictsFound > 0) {
        const critical = data.result.summary.criticalConflicts;
        if (critical > 0) {
          toast.error(`⚠️ ${critical} CRITICAL conflict(s) found (corresponding author)`);
        } else {
          toast.warning(`Found ${data.result.summary.conflictsFound} potential conflict(s)`);
        }
      } else {
        toast.info("No conflicts found between authors and reviewers");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Batch check failed");
    } finally {
      setIsChecking(false);
      setProgress({ current: 0, total: 0 });
    }
  };

  // Export results
  const exportResults = () => {
    if (!batchResult) return;

    const lines = [
      "COI Screening Report",
      `Generated: ${new Date(batchResult.checkedAt).toLocaleString()}`,
      `Total Checks: ${batchResult.summary.totalChecks}`,
      "",
      "=== CONFLICTS FOUND ===",
      "",
    ];

    // Group by severity
    const groupedConflicts = {
      critical: batchResult.conflicts.filter(c => c.severity === "critical"),
      high: batchResult.conflicts.filter(c => c.severity === "high"),
      medium: batchResult.conflicts.filter(c => c.severity === "medium"),
      low: batchResult.conflicts.filter(c => c.severity === "low"),
    };

    for (const [severity, conflicts] of Object.entries(groupedConflicts)) {
      if (conflicts.length > 0) {
        lines.push(`--- ${severity.toUpperCase()} PRIORITY (${conflicts.length}) ---`);
        for (const c of conflicts) {
          lines.push(`• ${c.authorName} (${c.authorRole}) ↔ ${c.reviewerName}`);
          lines.push(`  Type: ${c.type}`);
          if (c.details.title) lines.push(`  Paper: ${c.details.title} (${c.details.year})`);
          if (c.details.institutionName) lines.push(`  Institution: ${c.details.institutionName}`);
          lines.push("");
        }
      }
    }

    lines.push("=== CLEAR PAIRS ===");
    for (const pair of batchResult.clearPairs) {
      lines.push(`✓ ${pair.author} ↔ ${pair.reviewer}`);
    }

    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `coi-report-${new Date().toISOString().split("T")[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Report exported");
  };

  // Get severity badge
  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case "critical":
        return <Badge className="bg-red-100 text-red-800 border border-red-300"><AlertCircle className="h-3 w-3 mr-1" />Critical</Badge>;
      case "high":
        return <Badge className="bg-orange-100 text-orange-800 border border-orange-300"><AlertTriangle className="h-3 w-3 mr-1" />High</Badge>;
      case "medium":
        return <Badge className="bg-amber-100 text-amber-800 border border-amber-300">Medium</Badge>;
      default:
        return <Badge className="bg-blue-100 text-blue-800">Low</Badge>;
    }
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold">COI Screening</h1>
        <p className="text-gray-500">
          Batch screen authors against multiple potential reviewers with priority-based results
        </p>
      </div>

      {/* Notices */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="py-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-amber-800">
                <p className="font-medium">Automated Screening Notice</p>
                <p className="text-amber-700">
                  Results are indicators only. All findings require editorial review.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="py-3">
            <div className="flex items-start gap-2">
              <Info className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-blue-800">
                <p className="font-medium">Scientific Convention Priority</p>
                <p className="text-blue-700">
                  <strong>Last author (PI)</strong> and <strong>First author</strong> conflicts are <strong>critical</strong>. 
                  2nd-3rd authors are <strong>high</strong>. Later positions are <strong>medium/low</strong>.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="bulk" className="space-y-4">
        <TabsList>
          <TabsTrigger value="bulk">
            <Users className="h-4 w-4 mr-2" />
            Bulk Import
          </TabsTrigger>
          <TabsTrigger value="individual">
            <UserCheck className="h-4 w-4 mr-2" />
            Individual Entry
          </TabsTrigger>
        </TabsList>

        {/* Individual Entry Tab */}
        <TabsContent value="individual" className="space-y-4">
          {/* Manuscript Source */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Load from Manuscript</CardTitle>
              <CardDescription>
                Optionally load authors directly from an uploaded manuscript
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ManuscriptSelector
                value={selectedManuscriptId || undefined}
                onChange={(m) => setSelectedManuscriptId(m?.id || null)}
                onManuscriptData={(data) => {
                  if (data.authors.length > 0) {
                    const newAuthors: Author[] = data.authors.map((a, i) => ({
                      name: a.name,
                      orcid: "",
                      role: i === 0 ? "first" : i === data.authors.length - 1 ? "last" : "middle_late" as AuthorRole,
                      position: i + 1,
                    }));
                    setAuthors(newAuthors);
                    toast.success(`Loaded ${newAuthors.length} authors from manuscript`);
                  }
                }}
                placeholder="Select manuscript to import authors"
              />
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Authors Panel */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Manuscript Authors ({authors.length})
                  </CardTitle>
                  <Button variant="outline" size="sm" onClick={addAuthor}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add
                  </Button>
                </div>
                <CardDescription>
                  Enter authors with their roles. Corresponding author conflicts are prioritized.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 max-h-[500px] overflow-y-auto">
                {authors.map((author, index) => (
                  <div key={index} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <Select 
                        value={author.role} 
                        onValueChange={(v) => updateAuthor(index, "role", v)}
                      >
                        <SelectTrigger className="w-[200px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="last">
                            <span className="flex items-center gap-1">
                              <Star className="h-3 w-3 text-red-500" />
                              Last/Senior (PI)
                            </span>
                          </SelectItem>
                          <SelectItem value="first">
                            <span className="flex items-center gap-1">
                              <Star className="h-3 w-3 text-red-500" />
                              First Author
                            </span>
                          </SelectItem>
                          <SelectItem value="corresponding">
                            <span className="flex items-center gap-1">
                              <Star className="h-3 w-3 text-red-500" />
                              Corresponding
                            </span>
                          </SelectItem>
                          <SelectItem value="middle_early">2nd-3rd Author</SelectItem>
                          <SelectItem value="middle_late">Other Co-Author</SelectItem>
                        </SelectContent>
                      </Select>
                      {authors.length > 1 && (
                        <Button variant="ghost" size="icon" onClick={() => removeAuthor(index)}>
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      )}
                    </div>
                    <Input
                      placeholder="Author name"
                      value={author.name}
                      onChange={(e) => updateAuthor(index, "name", e.target.value)}
                    />
                    <Input
                      placeholder="ORCID (optional)"
                      value={author.orcid}
                      onChange={(e) => updateAuthor(index, "orcid", e.target.value)}
                      className="text-sm"
                    />
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Reviewers Panel */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <UserCheck className="h-5 w-5" />
                    Potential Reviewers ({reviewers.length})
                  </CardTitle>
                  <Button variant="outline" size="sm" onClick={addReviewer}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add
                  </Button>
                </div>
                <CardDescription>
                  Enter potential reviewers to check against all authors
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 max-h-[500px] overflow-y-auto">
                {reviewers.map((reviewer, index) => (
                  <div key={index} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Reviewer {index + 1}</span>
                      {reviewers.length > 1 && (
                        <Button variant="ghost" size="icon" onClick={() => removeReviewer(index)}>
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      )}
                    </div>
                    <Input
                      placeholder="Reviewer name"
                      value={reviewer.name}
                      onChange={(e) => updateReviewer(index, "name", e.target.value)}
                    />
                    <Input
                      placeholder="ORCID (optional)"
                      value={reviewer.orcid}
                      onChange={(e) => updateReviewer(index, "orcid", e.target.value)}
                      className="text-sm"
                    />
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Bulk Import Tab */}
        <TabsContent value="bulk" className="space-y-4">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Import Authors</CardTitle>
                <CardDescription>
                  Paste author names in order (one per line or comma-separated). 
                  <strong>Last = PI/senior (critical)</strong>, <strong>First = primary author (critical)</strong>, 
                  2nd-3rd = high priority, others = medium.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea
                  placeholder="John Smith&#10;Jane Doe&#10;Robert Johnson"
                  rows={6}
                  onChange={(e) => {
                    if (e.target.value.includes("\n") || e.target.value.includes(",")) {
                      // Only process on blur or if Enter is pressed
                    }
                  }}
                  onBlur={(e) => handleBulkAuthors(e.target.value)}
                />
                <p className="text-xs text-gray-500">
                  Current: {authors.filter(a => a.name).length} authors loaded
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Import Reviewers</CardTitle>
                <CardDescription>
                  Paste potential reviewer names (one per line or comma-separated)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea
                  placeholder="Alice Brown&#10;Bob Wilson&#10;Carol Davis"
                  rows={6}
                  onBlur={(e) => handleBulkReviewers(e.target.value)}
                />
                <p className="text-xs text-gray-500">
                  Current: {reviewers.filter(r => r.name).length} reviewers loaded
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Settings and Run */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Check papers from
              </Label>
              <Select value={fromYear} onValueChange={setFromYear}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All time" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All time</SelectItem>
                  {yearOptions.map((year) => (
                    <SelectItem key={year} value={String(year)}>
                      {year} onwards
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button 
              onClick={handleBatchCheck} 
              disabled={isChecking}
              size="lg"
              className="flex-1 sm:flex-none"
            >
              {isChecking ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Checking {progress.current}/{progress.total}...
                </>
              ) : (
                <>
                  <Search className="h-4 w-4 mr-2" />
                  Run Batch COI Check
                </>
              )}
            </Button>

            {batchResult && (
              <Button variant="outline" onClick={exportResults}>
                <Download className="h-4 w-4 mr-2" />
                Export Report
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {batchResult && (
        <div className="space-y-4">
          {/* Summary */}
          <Card>
            <CardHeader>
              <CardTitle>Screening Summary</CardTitle>
              <CardDescription>
                Checked {batchResult.summary.totalChecks} author-reviewer pairs
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-center">
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-2xl font-bold">{batchResult.summary.totalChecks}</p>
                  <p className="text-xs text-gray-500">Total Pairs</p>
                </div>
                <div className={`rounded-lg p-3 ${batchResult.summary.criticalConflicts > 0 ? "bg-red-100" : "bg-gray-50"}`}>
                  <p className={`text-2xl font-bold ${batchResult.summary.criticalConflicts > 0 ? "text-red-700" : "text-gray-400"}`}>
                    {batchResult.summary.criticalConflicts}
                  </p>
                  <p className="text-xs text-gray-600">Critical</p>
                </div>
                <div className={`rounded-lg p-3 ${batchResult.summary.highConflicts > 0 ? "bg-orange-100" : "bg-gray-50"}`}>
                  <p className={`text-2xl font-bold ${batchResult.summary.highConflicts > 0 ? "text-orange-700" : "text-gray-400"}`}>
                    {batchResult.summary.highConflicts}
                  </p>
                  <p className="text-xs text-gray-600">High</p>
                </div>
                <div className={`rounded-lg p-3 ${batchResult.summary.mediumConflicts > 0 ? "bg-amber-100" : "bg-gray-50"}`}>
                  <p className={`text-2xl font-bold ${batchResult.summary.mediumConflicts > 0 ? "text-amber-700" : "text-gray-400"}`}>
                    {batchResult.summary.mediumConflicts}
                  </p>
                  <p className="text-xs text-gray-600">Medium</p>
                </div>
                <div className="bg-green-50 rounded-lg p-3">
                  <p className="text-2xl font-bold text-green-700">{batchResult.clearPairs.length}</p>
                  <p className="text-xs text-green-600">Clear</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Critical Conflicts */}
          {batchResult.summary.criticalConflicts > 0 && (
            <Card className="border-red-300 bg-red-50">
              <CardHeader>
                <CardTitle className="text-red-800 flex items-center gap-2">
                  <AlertCircle className="h-5 w-5" />
                  CRITICAL: Corresponding Author Conflicts ({batchResult.summary.criticalConflicts})
                </CardTitle>
                <CardDescription className="text-red-700">
                  These conflicts involve the corresponding author and require immediate attention
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {batchResult.conflicts
                  .filter(c => c.severity === "critical")
                  .map((conflict, index) => (
                    <div key={index} className="bg-white rounded-lg border border-red-200 p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-semibold">
                            {conflict.authorName} ↔ {conflict.reviewerName}
                          </p>
                          <Badge className={ROLE_PRIORITY[conflict.authorRole].color}>
                            {ROLE_PRIORITY[conflict.authorRole].label}
                          </Badge>
                        </div>
                        {getSeverityBadge(conflict.severity)}
                      </div>
                      <Separator className="my-2" />
                      <div className="text-sm text-gray-600">
                        <p><strong>Type:</strong> {conflict.type === "coauthorship" ? "Co-authorship" : "Shared Affiliation"}</p>
                        {conflict.details.title && (
                          <p><strong>Paper:</strong> {conflict.details.title} ({conflict.details.year})</p>
                        )}
                        {conflict.details.institutionName && (
                          <p><strong>Institution:</strong> {conflict.details.institutionName}</p>
                        )}
                        {conflict.details.doi && (
                          <a 
                            href={conflict.details.doi} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline flex items-center gap-1 mt-1"
                          >
                            View Paper <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
              </CardContent>
            </Card>
          )}

          {/* High Priority Conflicts */}
          {batchResult.summary.highConflicts > 0 && (
            <Card className="border-orange-300 bg-orange-50">
              <CardHeader>
                <CardTitle className="text-orange-800 flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5" />
                  High Priority Conflicts ({batchResult.summary.highConflicts})
                </CardTitle>
                <CardDescription className="text-orange-700">
                  First or senior author conflicts
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {batchResult.conflicts
                  .filter(c => c.severity === "high")
                  .map((conflict, index) => (
                    <div key={index} className="bg-white rounded-lg border border-orange-200 p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">{conflict.authorName} ↔ {conflict.reviewerName}</p>
                          <p className="text-sm text-gray-500">
                            {conflict.type === "coauthorship" ? "Co-authored" : "Same institution"}
                            {conflict.details.title && `: ${conflict.details.title.slice(0, 50)}...`}
                          </p>
                        </div>
                        <Badge className={ROLE_PRIORITY[conflict.authorRole].color}>
                          {conflict.authorRole}
                        </Badge>
                      </div>
                    </div>
                  ))}
              </CardContent>
            </Card>
          )}

          {/* Medium Priority Conflicts */}
          {batchResult.summary.mediumConflicts > 0 && (
            <Card className="border-amber-200 bg-amber-50">
              <CardHeader>
                <CardTitle className="text-amber-800">
                  Medium Priority Conflicts ({batchResult.summary.mediumConflicts})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {batchResult.conflicts
                    .filter(c => c.severity === "medium")
                    .map((conflict, index) => (
                      <div key={index} className="flex items-center justify-between bg-white rounded p-2 border border-amber-200">
                        <span>{conflict.authorName} ↔ {conflict.reviewerName}</span>
                        <span className="text-sm text-gray-500">{conflict.type}</span>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Clear Pairs */}
          {batchResult.clearPairs.length > 0 && (
            <Card className="border-green-200">
              <CardHeader>
                <CardTitle className="text-green-800 flex items-center gap-2">
                  <CheckCircle className="h-5 w-5" />
                  Clear Pairs ({batchResult.clearPairs.length})
                </CardTitle>
                <CardDescription>
                  No conflicts detected for these author-reviewer combinations
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {batchResult.clearPairs.map((pair, index) => (
                    <Badge key={index} variant="outline" className="bg-green-50">
                      <CheckCircle className="h-3 w-3 mr-1 text-green-600" />
                      {pair.author} ↔ {pair.reviewer}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Disclaimer */}
          <Card className="bg-gray-50">
            <CardContent className="py-3 text-xs text-gray-600 italic">
              This automated screening checks co-authorship history and institutional affiliations.
              All findings require editorial verification. Clear results do not guarantee absence of all conflicts.
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

export default function COICheckPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64">Loading...</div>}>
      <COICheckContent />
    </Suspense>
  );
}
