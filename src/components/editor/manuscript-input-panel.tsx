"use client";

import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Upload,
  FileText,
  Loader2,
  Sparkles,
  Tags,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

export interface ManuscriptReadyData {
  manuscriptId?: string;
  title?: string;
  abstract: string;
  keywords: string[];
  authors: Array<{ name: string; email?: string; affiliation?: string }>;
}

interface ManuscriptInputPanelProps {
  publisherId: string | null;
  journalId: string | null;
  onReady: (data: ManuscriptReadyData) => void;
  disabled?: boolean;
}

interface ProcessingStatus {
  id: string;
  status: string;
  progress: number;
  stage: string;
  title?: string;
  isComplete: boolean;
  hasError: boolean;
}

export function ManuscriptInputPanel({
  publisherId,
  journalId,
  onReady,
  disabled = false,
}: ManuscriptInputPanelProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus | null>(null);

  const [abstract, setAbstract] = useState("");
  const [keywordsText, setKeywordsText] = useState("");
  const [isSavingAbstract, setIsSavingAbstract] = useState(false);
  const [isSuggestingKeywords, setIsSuggestingKeywords] = useState(false);

  const pollStatus = useCallback(
    async (id: string) => {
      try {
        const response = await fetch(`/api/manuscripts/${id}/status`);
        if (!response.ok) throw new Error("Failed to get status");
        const status: ProcessingStatus = await response.json();
        setProcessingStatus(status);
        if (!status.isComplete && !status.hasError) {
          setTimeout(() => pollStatus(id), 2000);
        } else if (status.isComplete) {
          const detailRes = await fetch(`/api/manuscripts/${id}`);
          if (detailRes.ok) {
            const payload = await detailRes.json();
            const ms = payload.manuscript ?? payload;
            const authorList = (ms.authors || []).map(
              (a: { fullName?: string; name?: string; email?: string; affiliation?: string }) => ({
                name: a.fullName || a.name || "",
                email: a.email,
                affiliation: a.affiliation,
              })
            );
            onReady({
              manuscriptId: id,
              title: ms.title,
              abstract: ms.abstract || "",
              keywords: ms.keywords || [],
              authors: authorList.filter((a: { name: string }) => a.name),
            });
            toast.success("Manuscript processed — keywords and authors loaded");
          }
        }
      } catch (err) {
        console.error("Error polling status:", err);
      }
    },
    [onReady]
  );

  const handleUpload = async (file: File) => {
    if (!publisherId) {
      toast.error("Upload is not available — no organization assigned");
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setUploadError(null);
    setProcessingStatus(null);

    const MAX_SIZE = 50 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      setUploadError("File is too large. Maximum is 50 MB.");
      toast.error("File too large. Maximum is 50 MB.");
      setUploading(false);
      return;
    }

    try {
      setUploadProgress(5);
      const initRes = await fetch("/api/manuscripts/upload/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publisherId,
          journalId: journalId || undefined,
          fileName: file.name,
          fileSize: file.size,
        }),
      });
      const initData = await initRes.json();
      if (!initRes.ok) throw new Error(initData.error || "Failed to initialize upload");

      const { manuscriptId: msId, signedUrl } = initData;
      setUploadProgress(10);

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", signedUrl, true);
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
        xhr.setRequestHeader("x-upsert", "false");
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setUploadProgress(Math.round(10 + (e.loaded / e.total) * 70));
          }
        };
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error(`Upload failed (HTTP ${xhr.status})`));
        xhr.onerror = () => reject(new Error("Network error during upload"));
        xhr.send(file);
      });
      setUploadProgress(85);

      const processRes = await fetch(`/api/manuscripts/${msId}/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const processData = await processRes.json();
      if (!processRes.ok) throw new Error(processData.error || "Failed to start processing");

      setUploadProgress(90);
      toast.success("File uploaded — processing manuscript...");
      pollStatus(msId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setUploadError(message);
      toast.error(message);
    } finally {
      setUploading(false);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (files) => {
      if (files.length > 0) handleUpload(files[0]);
    },
    accept: {
      "application/pdf": [".pdf"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
    },
    maxFiles: 1,
    maxSize: 50 * 1024 * 1024,
    disabled: disabled || uploading || !publisherId,
  });

  const parseKeywords = (text: string) =>
    text
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);

  const handleSuggestKeywords = async () => {
    const text = abstract.trim();
    if (text.length < 20) {
      toast.error("Enter at least 20 characters of abstract to suggest keywords");
      return;
    }
    setIsSuggestingKeywords(true);
    try {
      const res = await fetch("/api/manuscripts/suggest-keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to suggest keywords");
      if (data.keywords?.length) {
        setKeywordsText(data.keywords.join(", "));
        toast.success(`Suggested ${data.keywords.length} keywords`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to suggest keywords");
    } finally {
      setIsSuggestingKeywords(false);
    }
  };

  const handleSaveAbstract = async () => {
    const abstractTrimmed = abstract.trim();
    const keywords = parseKeywords(keywordsText);

    if (abstractTrimmed.length < 20 && keywords.length === 0) {
      toast.error("Enter an abstract (20+ characters) or at least one keyword");
      return;
    }

    setIsSavingAbstract(true);
    try {
      const res = await fetch("/api/editor/manuscript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          abstract: abstractTrimmed || undefined,
          keywords,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");

      onReady({
        manuscriptId: data.manuscriptId,
        title: data.title,
        abstract: abstractTrimmed,
        keywords,
        authors: [],
      });
      toast.success("Abstract saved — ready to find reviewers");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setIsSavingAbstract(false);
    }
  };

  const handleUseKeywordsOnly = () => {
    const keywords = parseKeywords(keywordsText);
    if (keywords.length === 0) {
      toast.error("Enter at least one keyword");
      return;
    }
    onReady({
      abstract: "",
      keywords,
      authors: [],
    });
    toast.success("Keywords ready — you can search for reviewers below");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Manuscript source
        </CardTitle>
        <CardDescription>
          Upload a file, paste an abstract, or enter keywords to start finding reviewers.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="upload" className="space-y-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="upload" disabled={disabled}>
              <Upload className="h-4 w-4 mr-1.5" />
              Upload
            </TabsTrigger>
            <TabsTrigger value="abstract" disabled={disabled}>
              <FileText className="h-4 w-4 mr-1.5" />
              Abstract
            </TabsTrigger>
            <TabsTrigger value="keywords" disabled={disabled}>
              <Tags className="h-4 w-4 mr-1.5" />
              Keywords
            </TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="space-y-4">
            {!publisherId && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-3">
                File upload requires an organization assignment. Use abstract or keywords instead.
              </p>
            )}
            {uploadError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex gap-2">
                <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
                {uploadError}
              </div>
            )}
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                isDragActive
                  ? "border-blue-400 bg-blue-50"
                  : "border-gray-300 hover:border-gray-400"
              } ${disabled || uploading || !publisherId ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <input {...getInputProps()} />
              {uploading ? (
                <div className="space-y-3">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto text-blue-600" />
                  <p className="text-sm text-gray-600">Uploading...</p>
                  <Progress value={uploadProgress} className="max-w-xs mx-auto" />
                </div>
              ) : processingStatus && !processingStatus.isComplete ? (
                <div className="space-y-3">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto text-blue-600" />
                  <p className="text-sm text-gray-600">{processingStatus.stage || "Processing..."}</p>
                  <Progress value={processingStatus.progress} className="max-w-xs mx-auto" />
                </div>
              ) : processingStatus?.isComplete ? (
                <div className="space-y-2">
                  <CheckCircle className="h-8 w-8 mx-auto text-green-600" />
                  <p className="text-sm font-medium text-green-800">Processing complete</p>
                </div>
              ) : (
                <>
                  <Upload className="h-10 w-10 mx-auto text-gray-400 mb-2" />
                  <p className="text-sm font-medium">Drop PDF or DOCX here, or click to browse</p>
                  <p className="text-xs text-gray-500 mt-1">Maximum 50 MB</p>
                </>
              )}
            </div>
          </TabsContent>

          <TabsContent value="abstract" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="editor-abstract">Abstract</Label>
              <Textarea
                id="editor-abstract"
                placeholder="Paste the manuscript abstract here..."
                value={abstract}
                onChange={(e) => setAbstract(e.target.value)}
                rows={6}
                disabled={disabled}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="editor-keywords-from-abstract">Keywords (optional)</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleSuggestKeywords}
                  disabled={disabled || isSuggestingKeywords || abstract.trim().length < 20}
                >
                  {isSuggestingKeywords ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5 mr-1" />
                  )}
                  Suggest keywords
                </Button>
              </div>
              <Input
                id="editor-keywords-from-abstract"
                placeholder="e.g., tuberculosis, epidemiology, public health"
                value={keywordsText}
                onChange={(e) => setKeywordsText(e.target.value)}
                disabled={disabled}
              />
            </div>
            <Button onClick={handleSaveAbstract} disabled={disabled || isSavingAbstract}>
              {isSavingAbstract ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle className="h-4 w-4 mr-2" />
              )}
              Use abstract for reviewer search
            </Button>
          </TabsContent>

          <TabsContent value="keywords" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="editor-keywords-only">Research keywords (comma-separated)</Label>
              <Input
                id="editor-keywords-only"
                placeholder="e.g., machine learning, neural networks, climate modeling"
                value={keywordsText}
                onChange={(e) => setKeywordsText(e.target.value)}
                disabled={disabled}
                onKeyDown={(e) => e.key === "Enter" && handleUseKeywordsOnly()}
              />
              <p className="text-xs text-gray-500">
                Enter 2–5 keywords that describe the research topic. No file upload required.
              </p>
            </div>
            <Button onClick={handleUseKeywordsOnly} disabled={disabled}>
              <Tags className="h-4 w-4 mr-2" />
              Use keywords for reviewer search
            </Button>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
