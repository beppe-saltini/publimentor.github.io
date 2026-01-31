"use client";

import { useState, useEffect, Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { 
  CheckCircle, 
  XCircle, 
  AlertTriangle, 
  Upload, 
  FileText, 
  BookOpen, 
  Hash,
  Loader2,
  Info,
  ClipboardCheck,
  Download,
  ListChecks
} from "lucide-react";
import { toast } from "sonner";

interface FormatIssue {
  ruleId: string;
  ruleName: string;
  severity: "error" | "warning";
  message: string;
  location?: {
    page?: number;
    section?: string;
  };
}

interface FormatResult {
  passed: boolean;
  issues: FormatIssue[];
  stats: {
    wordCount: number;
    pageCount: number;
    referenceCount: number;
    sectionsFound: string[];
  };
}

interface PDFInfo {
  title: string | null;
  author: string | null;
  pages: number;
  wordCount: number;
}

// Required statements checklist for compliance
interface ChecklistItem {
  id: string;
  label: string;
  description: string;
  required: boolean;
  category: "ethics" | "data" | "conflict" | "funding" | "author";
}

const COMPLIANCE_CHECKLIST: ChecklistItem[] = [
  { id: "ethics", label: "Ethics Statement", description: "IRB/ethics committee approval for human/animal research", required: true, category: "ethics" },
  { id: "consent", label: "Informed Consent", description: "Statement about participant consent (if applicable)", required: false, category: "ethics" },
  { id: "data_availability", label: "Data Availability Statement", description: "Where and how data can be accessed", required: true, category: "data" },
  { id: "code_availability", label: "Code Availability", description: "Repository link for any custom code/software", required: false, category: "data" },
  { id: "coi_declaration", label: "Conflict of Interest Declaration", description: "All authors' potential conflicts disclosed", required: true, category: "conflict" },
  { id: "funding", label: "Funding Statement", description: "Grant numbers and funding sources", required: true, category: "funding" },
  { id: "author_contributions", label: "Author Contributions (CRediT)", description: "Contribution of each author", required: true, category: "author" },
  { id: "corresponding_author", label: "Corresponding Author Contact", description: "Email for correspondence", required: true, category: "author" },
  { id: "orcids", label: "Author ORCIDs", description: "ORCID for all authors", required: false, category: "author" },
];

function FormatCheckContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const slug = params.slug as string;
  const submissionId = searchParams.get("submissionId");

  const [file, setFile] = useState<File | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [result, setResult] = useState<FormatResult | null>(null);
  const [pdfInfo, setPdfInfo] = useState<PDFInfo | null>(null);

  // Checklist state
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());

  // Load existing submission PDF if available
  useEffect(() => {
    if (submissionId) {
      // Could fetch and auto-check the submission PDF here
    }
  }, [submissionId]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.type !== "application/pdf") {
        toast.error("Please select a PDF file");
        return;
      }
      setFile(selectedFile);
      setResult(null);
      setPdfInfo(null);
    }
  };

  const handleCheck = async () => {
    if (!file) {
      toast.error("Please select a PDF file");
      return;
    }

    setIsChecking(true);

    try {
      const formData = new FormData();
      formData.append("pdf", file);
      formData.append("journalSlug", slug);
      if (submissionId) {
        formData.append("submissionId", submissionId);
      }

      const response = await fetch("/api/format/check", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Format check failed");
      }

      setResult(data.result);
      setPdfInfo(data.pdfInfo);

      if (data.result.passed) {
        toast.success("Format check passed!");
      } else {
        toast.warning(`Found ${data.result.issues.length} issue(s)`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Format check failed");
    } finally {
      setIsChecking(false);
    }
  };

  const errorCount = result?.issues.filter((i) => i.severity === "error").length || 0;
  const warningCount = result?.issues.filter((i) => i.severity === "warning").length || 0;

  // Checklist handlers
  const toggleItem = (id: string) => {
    const newChecked = new Set(checkedItems);
    if (newChecked.has(id)) {
      newChecked.delete(id);
    } else {
      newChecked.add(id);
    }
    setCheckedItems(newChecked);
  };

  const requiredItems = COMPLIANCE_CHECKLIST.filter(i => i.required);
  const requiredComplete = requiredItems.every(i => checkedItems.has(i.id));
  const completionPercent = Math.round((checkedItems.size / COMPLIANCE_CHECKLIST.length) * 100);

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold">Journal-Ready Formatter & Compliance Checker</h1>
        <p className="text-gray-500">
          Verify your manuscript meets journal requirements before submission
        </p>
      </div>

      {/* Author-facing message */}
      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="py-3">
          <div className="flex items-start gap-2">
            <Info className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-blue-800">
              <p className="font-medium">For Authors</p>
              <p className="text-blue-700">
                We don&apos;t rewrite your paper. We help you submit it correctly.
                Use these tools to check your manuscript against journal requirements before submission.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="format" className="space-y-4">
        <TabsList>
          <TabsTrigger value="format">
            <FileText className="h-4 w-4 mr-2" />
            Format Check
          </TabsTrigger>
          <TabsTrigger value="checklist">
            <ListChecks className="h-4 w-4 mr-2" />
            Compliance Checklist
          </TabsTrigger>
        </TabsList>

        <TabsContent value="format" className="space-y-4">
          <Card>
        <CardHeader>
          <CardTitle>Upload PDF</CardTitle>
          <CardDescription>
            Select a PDF file to check against the journal&apos;s format requirements
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <Input
              id="pdf"
              type="file"
              accept=".pdf"
              onChange={handleFileChange}
              className="hidden"
            />
            <Button
              variant="outline"
              onClick={() => document.getElementById("pdf")?.click()}
              disabled={isChecking}
            >
              <Upload className="h-4 w-4 mr-2" />
              {file ? file.name : "Choose PDF"}
            </Button>
            {file && (
              <>
                <span className="text-sm text-gray-500">
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </span>
                <Button onClick={handleCheck} disabled={isChecking}>
                  {isChecking ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <FileText className="h-4 w-4 mr-2" />
                  )}
                  Check Format
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {result && pdfInfo && (
        <>
          <Card className={result.passed ? "border-green-300 bg-green-50" : "border-red-300 bg-red-50"}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {result.passed ? (
                    <CheckCircle className="h-6 w-6 text-green-600" />
                  ) : (
                    <XCircle className="h-6 w-6 text-red-600" />
                  )}
                  <CardTitle className={result.passed ? "text-green-800" : "text-red-800"}>
                    {result.passed ? "Format Check Passed" : "Format Check Failed"}
                  </CardTitle>
                </div>
                <div className="flex gap-2">
                  {errorCount > 0 && (
                    <Badge variant="destructive">{errorCount} error(s)</Badge>
                  )}
                  {warningCount > 0 && (
                    <Badge variant="secondary">{warningCount} warning(s)</Badge>
                  )}
                </div>
              </div>
            </CardHeader>
          </Card>

          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-gray-500 mb-1">
                  <FileText className="h-4 w-4" />
                  <span className="text-sm">Pages</span>
                </div>
                <p className="text-2xl font-bold">{result.stats.pageCount}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-gray-500 mb-1">
                  <Hash className="h-4 w-4" />
                  <span className="text-sm">Words</span>
                </div>
                <p className="text-2xl font-bold">{result.stats.wordCount.toLocaleString()}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-gray-500 mb-1">
                  <BookOpen className="h-4 w-4" />
                  <span className="text-sm">References</span>
                </div>
                <p className="text-2xl font-bold">{result.stats.referenceCount}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-gray-500 mb-1">
                  <FileText className="h-4 w-4" />
                  <span className="text-sm">Sections</span>
                </div>
                <p className="text-2xl font-bold">{result.stats.sectionsFound.length}</p>
              </CardContent>
            </Card>
          </div>

          {result.issues.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Issues Found</CardTitle>
                <CardDescription>
                  Address these issues to meet the journal&apos;s format requirements
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {result.issues.map((issue, index) => (
                    <div
                      key={index}
                      className={`flex items-start gap-3 p-3 rounded-lg ${
                        issue.severity === "error" 
                          ? "bg-red-50 border border-red-200" 
                          : "bg-amber-50 border border-amber-200"
                      }`}
                    >
                      {issue.severity === "error" ? (
                        <XCircle className="h-5 w-5 text-red-500 mt-0.5" />
                      ) : (
                        <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5" />
                      )}
                      <div>
                        <p className="font-medium">{issue.ruleName}</p>
                        <p className="text-sm text-gray-600">{issue.message}</p>
                        {issue.location?.section && (
                          <p className="text-xs text-gray-500 mt-1">
                            Section: {issue.location.section}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Detected Sections</CardTitle>
              <CardDescription>
                Sections found in the document
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {result.stats.sectionsFound.map((section, index) => (
                  <Badge key={index} variant="outline" className="capitalize">
                    {section}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
        </TabsContent>

        {/* Compliance Checklist Tab */}
        <TabsContent value="checklist" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <ClipboardCheck className="h-5 w-5" />
                    Pre-Submission Compliance Checklist
                  </CardTitle>
                  <CardDescription>
                    Ensure all required statements and information are included
                  </CardDescription>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold">{completionPercent}%</p>
                  <p className="text-xs text-gray-500">Complete</p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {/* Progress bar */}
              <div className="w-full bg-gray-200 rounded-full h-2 mb-6">
                <div 
                  className={`h-2 rounded-full transition-all ${
                    requiredComplete ? "bg-green-500" : "bg-blue-500"
                  }`}
                  style={{ width: `${completionPercent}%` }}
                />
              </div>

              {/* Required items warning */}
              {!requiredComplete && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
                    <div className="text-sm text-amber-800">
                      <p className="font-medium">Required items incomplete</p>
                      <p className="text-amber-700">
                        {requiredItems.filter(i => !checkedItems.has(i.id)).length} required item(s) 
                        must be completed before submission.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {requiredComplete && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
                  <div className="flex items-start gap-2">
                    <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
                    <div className="text-sm text-green-800">
                      <p className="font-medium">All required items complete!</p>
                      <p className="text-green-700">
                        Your manuscript includes all required statements.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <Separator className="my-4" />

              {/* Checklist by category */}
              {["ethics", "data", "conflict", "funding", "author"].map(category => {
                const categoryItems = COMPLIANCE_CHECKLIST.filter(i => i.category === category);
                const categoryLabels: Record<string, string> = {
                  ethics: "Ethics & Consent",
                  data: "Data & Code Availability",
                  conflict: "Conflicts of Interest",
                  funding: "Funding",
                  author: "Author Information",
                };
                
                return (
                  <div key={category} className="mb-6">
                    <h4 className="font-semibold text-sm text-gray-700 mb-3 uppercase tracking-wide">
                      {categoryLabels[category]}
                    </h4>
                    <div className="space-y-3">
                      {categoryItems.map(item => (
                        <div 
                          key={item.id}
                          className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                            checkedItems.has(item.id) 
                              ? "bg-green-50 border-green-200" 
                              : item.required 
                                ? "bg-white border-amber-200" 
                                : "bg-white border-gray-200"
                          }`}
                        >
                          <Checkbox
                            id={item.id}
                            checked={checkedItems.has(item.id)}
                            onCheckedChange={() => toggleItem(item.id)}
                          />
                          <div className="flex-1">
                            <Label 
                              htmlFor={item.id} 
                              className={`cursor-pointer ${
                                checkedItems.has(item.id) ? "line-through text-gray-500" : ""
                              }`}
                            >
                              {item.label}
                              {item.required && (
                                <span className="text-red-500 ml-1">*</span>
                              )}
                            </Label>
                            <p className="text-xs text-gray-500 mt-0.5">{item.description}</p>
                          </div>
                          {checkedItems.has(item.id) && (
                            <CheckCircle className="h-5 w-5 text-green-600" />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              <Separator className="my-4" />

              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500">
                  <span className="text-red-500">*</span> Required for submission
                </p>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => {
                    const report = COMPLIANCE_CHECKLIST.map(item => 
                      `${checkedItems.has(item.id) ? "✓" : "○"} ${item.label}${item.required ? " (Required)" : ""}`
                    ).join("\n");
                    navigator.clipboard.writeText(report);
                    toast.success("Checklist copied to clipboard");
                  }}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Copy Checklist
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Fix before submission report */}
          {!requiredComplete && (
            <Card className="border-amber-300 bg-amber-50">
              <CardHeader>
                <CardTitle className="text-amber-800 flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5" />
                  Fix Before Submission
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-amber-700 mb-3">
                  The following items must be addressed before your manuscript can be submitted:
                </p>
                <ul className="space-y-2">
                  {requiredItems.filter(i => !checkedItems.has(i.id)).map(item => (
                    <li key={item.id} className="flex items-start gap-2 text-sm">
                      <XCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <span className="font-medium">{item.label}</span>
                        <span className="text-amber-600"> — {item.description}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function FormatCheckPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64">Loading...</div>}>
      <FormatCheckContent />
    </Suspense>
  );
}
