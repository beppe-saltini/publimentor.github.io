"use client";

// Version stamp — check window.__MS_V in the browser console to verify
// the latest client code is running (should be 8).
if (typeof window !== "undefined") {
  console.warn("[ManuscriptSelector] v8 loaded — Supabase direct upload");
  (window as /* eslint-disable-line @typescript-eslint/no-explicit-any */ any).__MS_V = 8;
}

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FileText, Check, Loader2, Upload, X, Plus, AlertCircle } from "lucide-react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { DuplicateUploadDialog } from "./duplicate-upload-dialog";
import { useManuscriptFileUpload } from "./use-manuscript-file-upload";

interface ManuscriptSummary {
  id: string;
  title: string;
  fileName: string;
  fileType: string;
  status: string;
  wordCount?: number;
  authorCount: number;
  createdAt: string;
}

interface ManuscriptReference {
  refNumber: number;
  rawText: string;
  doi?: string | null;
  pmid?: string | null;
  title?: string | null;
  authors?: string | null;
  journal?: string | null;
  year?: number | null;
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

interface ManuscriptSelectorProps {
  value?: string;
  onChange: (manuscript: ManuscriptSummary | null) => void;
  onManuscriptData?: (data: {
    title: string;
    abstract: string;
    keywords: string[];
    authors: Array<{ name: string; email?: string; affiliation?: string }>;
    references: ManuscriptReference[];
    filePath?: string;
  }) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Publisher ID for uploads - required if allowUpload is true */
  publisherId?: string;
  /** Journal ID for uploads (optional) */
  journalId?: string;
  /** Allow uploading new manuscripts (default: true if publisherId is provided) */
  allowUpload?: boolean;
}

export function ManuscriptSelector({
  value,
  onChange,
  onManuscriptData,
  placeholder = "Select a manuscript",
  disabled = false,
  publisherId: publisherIdProp,
  journalId,
  allowUpload: allowUploadProp,
}: ManuscriptSelectorProps) {
  const [open, setOpen] = useState(false);
  const [manuscripts, setManuscripts] = useState<ManuscriptSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<ManuscriptSummary | null>(null);
  const [activeTab, setActiveTab] = useState<string>("select");
  
  const [uploadProgress, setUploadProgress] = useState(0);
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  
  // Auto-fetch publisherId if not provided
  const [autoPublisherId, setAutoPublisherId] = useState<string | null>(null);
  const publisherId = publisherIdProp || autoPublisherId;
  const allowUpload = allowUploadProp !== undefined ? allowUploadProp : true; // Always allow upload by default

  useEffect(() => {
    if (!publisherIdProp) {
      console.log("[ManuscriptSelector] no publisherIdProp, fetching /api/publishers…");
      fetch("/api/publishers")
        .then(res => res.text())
        .then(text => {
          const data = JSON.parse(text);
          if (data.publishers?.length > 0) {
            console.log("[ManuscriptSelector] auto-resolved publisherId:", data.publishers[0].id);
            setAutoPublisherId(data.publishers[0].id);
          } else {
            console.warn("[ManuscriptSelector] no publishers found — upload will be unavailable");
          }
        })
        .catch((err) => {
          console.error("[ManuscriptSelector] failed to fetch publishers:", err);
        });
    } else {
      console.log("[ManuscriptSelector] publisherIdProp provided:", publisherIdProp);
    }
  }, [publisherIdProp]);

  // Fetch manuscripts when dialog opens
  useEffect(() => {
    if (open) {
      fetchManuscripts();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, journalId]);

  // Fetch selected manuscript details when value changes
  useEffect(() => {
    if (value && !selected) {
      fetchManuscriptDetails(value);
    }
  }, [value]);

  const fetchManuscripts = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status: "READY", limit: "50" });
      if (journalId) {
        params.set("journalId", journalId);
      }
      const response = await fetch(`/api/manuscripts?${params}`);
      const text = await response.text();
      const data = JSON.parse(text);
      if (response.ok) {
        setManuscripts(data.manuscripts);
      }
    } catch (error) {
      console.error("Failed to fetch manuscripts:", error);
    } finally {
      setLoading(false);
    }
  };

  // Poll for processing status
  const pollStatus = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/manuscripts/${id}/status`);
      if (!response.ok) {
        throw new Error("Failed to get status");
      }
      
      const statusText = await response.text();
      const status: ProcessingStatus = JSON.parse(statusText);
      setProcessingStatus(status);
      
      // Continue polling if not complete
      if (!status.isComplete && !status.hasError) {
        setTimeout(() => pollStatus(id), 2000);
      } else if (status.isComplete) {
        // Auto-select the uploaded manuscript
        const newManuscript: ManuscriptSummary = {
          id,
          title: status.title || "Untitled",
          fileName: "",
          fileType: "pdf",
          status: "READY",
          authorCount: 0,
          createdAt: new Date().toISOString(),
        };
        handleSelect(newManuscript);
        toast.success("Manuscript uploaded and processed!");
      }
    } catch (err) {
      console.error("Error polling status:", err);
    }
  }, []);

  const {
    startUpload,
    confirmDuplicateUpload,
    cancelDuplicateUpload,
    duplicatePrompt,
    uploading,
    checkingDuplicate,
    busy,
  } = useManuscriptFileUpload({
    publisherId,
    journalId,
    onProgress: setUploadProgress,
    onUploadComplete: (id) => {
      toast.success("File uploaded! Processing manuscript...");
      pollStatus(id);
    },
  });

  const handleUpload = async (file: File) => {
    if (!publisherId) {
      toast.error("Upload not available — publisher ID not loaded. Try refreshing the page.");
      return;
    }
    setUploadProgress(0);
    setUploadError(null);
    setProcessingStatus(null);
    try {
      await startUpload(file);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setUploadError(message);
      toast.error(message);
    }
  };

  const handleConfirmDuplicate = async () => {
    try {
      await confirmDuplicateUpload();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setUploadError(message);
      toast.error(message);
    }
  };

  // Dropzone configuration — 50 MB limit (Supabase Storage, no Vercel body limit)
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (files) => {
      if (files.length > 0) {
        handleUpload(files[0]);
      }
    },
    onDropRejected: (rejections) => {
      const reason = rejections[0]?.errors?.[0];
      if (reason?.code === "file-too-large") {
        toast.error("File is too large. Maximum size is 50 MB.");
      } else if (reason?.code === "file-invalid-type") {
        toast.error("Invalid file type. Only PDF and DOCX are supported.");
      } else {
        toast.error(reason?.message || "File rejected");
      }
    },
    accept: {
      "application/pdf": [".pdf"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
    },
    maxFiles: 1,
    maxSize: 50 * 1024 * 1024, // 50 MB (Supabase Storage handles the file directly)
    disabled: busy || !!processingStatus,
  });

  const resetUpload = () => {
    cancelDuplicateUpload();
    setUploadProgress(0);
    setProcessingStatus(null);
    setUploadError(null);
  };

  const fetchManuscriptDetails = async (id: string) => {
    try {
      const response = await fetch(`/api/manuscripts/${id}`);
      const text = await response.text();
      let data: Record<string, any>;
      try {
        data = JSON.parse(text);
      } catch {
        console.error("[ManuscriptSelector] Non-JSON response from /api/manuscripts/", id, text.slice(0, 500));
        toast.error("Failed to load manuscript details — server returned an invalid response.");
        return;
      }
      
      if (!response.ok) {
        console.error("[ManuscriptSelector] Failed to fetch manuscript:", response.status, data);
        toast.error(data.error || `Failed to load manuscript (HTTP ${response.status})`);
        return;
      }

      if (data.manuscript) {
        const m = data.manuscript;
        setSelected({
          id: m.id,
          title: m.title || m.fileName,
          fileName: m.fileName,
          fileType: m.fileType,
          status: m.status,
          wordCount: m.wordCount,
          authorCount: m.authors?.length || 0,
          createdAt: m.createdAt,
        });

        // Pass manuscript data to parent
        if (onManuscriptData) {
          const kw = m.keywords || [];
          const authors = m.authors?.map((a: any) => ({
            name: a.fullName,
            email: a.email,
            affiliation: m.affiliations?.find((aff: any) => 
              a.affiliationNums?.includes(aff.affiliationNumber)
            )?.rawText,
          })) || [];

          onManuscriptData({
            title: m.title || "",
            abstract: m.abstract || "",
            keywords: kw,
            authors,
            references: m.references?.map((r: any) => ({
              refNumber: r.refNumber,
              rawText: r.rawText,
              doi: r.doi,
              pmid: r.pmid,
              title: r.title,
              authors: r.authors,
              journal: r.journal,
              year: r.year,
            })) || [],
            filePath: m.filePath,
          });

          if (kw.length > 0 || authors.length > 0) {
            toast.success(`Loaded: ${kw.length} keywords, ${authors.length} authors`);
          } else if (m.status !== "READY") {
            toast.info(`Manuscript selected but still processing (status: ${m.status}). Keywords and authors may not be available yet.`);
          } else {
            toast.info("Manuscript selected but no keywords or authors were extracted.");
          }
        }
      } else {
        toast.error("Manuscript not found.");
      }
    } catch (error) {
      console.error("Failed to fetch manuscript details:", error);
      toast.error("Failed to load manuscript details. Check the console for more info.");
    }
  };

  const handleSelect = async (manuscript: ManuscriptSummary) => {
    setSelected(manuscript);
    onChange(manuscript);
    setOpen(false);

    // Fetch full details for parent
    if (onManuscriptData) {
      fetchManuscriptDetails(manuscript.id);
    }
  };

  const handleClear = () => {
    setSelected(null);
    onChange(null);
  };

  return (
    <div className="space-y-2">
      {selected ? (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-blue-600" />
                <div>
                  <p className="font-medium text-sm">{selected.title}</p>
                  <p className="text-xs text-gray-500">
                    {selected.fileName} • {selected.wordCount?.toLocaleString() || "?"} words
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClear}
                disabled={disabled}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Dialog open={open} onOpenChange={(isOpen) => {
          setOpen(isOpen);
          if (!isOpen) resetUpload();
        }}>
          <DialogTrigger asChild>
            <Button variant="outline" className="w-full justify-start" disabled={disabled}>
              <Upload className="h-4 w-4 mr-2" />
              {placeholder}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Select or Upload Manuscript</DialogTitle>
              <DialogDescription>
                Choose an existing manuscript or upload a new one
              </DialogDescription>
            </DialogHeader>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="select">Select Existing</TabsTrigger>
                <TabsTrigger value="upload">
                  <Plus className="h-4 w-4 mr-1" />
                  Upload New
                </TabsTrigger>
              </TabsList>

              {/* Select Existing Tab */}
              <TabsContent value="select" className="mt-4">
                {loading ? (
                  <div className="py-8 text-center">
                    <Loader2 className="h-8 w-8 mx-auto animate-spin text-gray-400" />
                    <p className="mt-2 text-gray-500">Loading manuscripts...</p>
                  </div>
                ) : manuscripts.length === 0 ? (
                  <div className="py-8 text-center">
                    <FileText className="h-12 w-12 mx-auto text-gray-300 mb-4" />
                    <p className="text-gray-500">No manuscripts available</p>
                    {allowUpload && (
                      <Button 
                        variant="outline" 
                        className="mt-4"
                        onClick={() => setActiveTab("upload")}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Upload a Manuscript
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {manuscripts.map((m) => (
                      <Card
                        key={m.id}
                        className={`cursor-pointer hover:border-blue-300 transition-colors ${
                          value === m.id ? "border-blue-500 bg-blue-50" : ""
                        }`}
                        onClick={() => handleSelect(m)}
                      >
                        <CardContent className="py-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <FileText className="h-5 w-5 text-gray-400" />
                              <div>
                                <p className="font-medium text-sm">{m.title}</p>
                                <p className="text-xs text-gray-500">
                                  {m.fileName} • {m.authorCount} authors • {new Date(m.createdAt).toLocaleDateString()}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="secondary" className="uppercase text-xs">
                                {m.fileType}
                              </Badge>
                              {value === m.id && (
                                <Check className="h-5 w-5 text-blue-600" />
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* Upload New Tab */}
              <TabsContent value="upload" className="mt-4">
                <DuplicateUploadDialog
                  open={!!duplicatePrompt}
                  fileName={duplicatePrompt?.file.name ?? ""}
                  check={duplicatePrompt?.check ?? null}
                  onConfirm={handleConfirmDuplicate}
                  onCancel={cancelDuplicateUpload}
                  confirming={uploading}
                />

                {/* Upload error */}
                {uploadError && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4 flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-red-500 mt-0.5" />
                    <div>
                      <p className="font-medium text-red-800">Upload Failed</p>
                      <p className="text-sm text-red-600">{uploadError}</p>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="mt-2"
                        onClick={resetUpload}
                      >
                        Try Again
                      </Button>
                    </div>
                  </div>
                )}

                {/* Processing status */}
                {processingStatus && !uploadError && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      {processingStatus.isComplete ? (
                        <Check className="h-5 w-5 text-green-500" />
                      ) : processingStatus.hasError ? (
                        <AlertCircle className="h-5 w-5 text-red-500" />
                      ) : (
                        <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
                      )}
                      <span className="font-medium">
                        {processingStatus.isComplete 
                          ? "Processing Complete" 
                          : processingStatus.hasError
                          ? "Processing Failed"
                          : "Processing manuscript..."
                        }
                      </span>
                    </div>
                    {!processingStatus.isComplete && !processingStatus.hasError && (
                      <div className="space-y-1">
                        <Progress value={processingStatus.progress} />
                        <p className="text-sm text-gray-500">{processingStatus.stage}</p>
                      </div>
                    )}
                    {processingStatus.hasError && (
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="mt-2"
                        onClick={resetUpload}
                      >
                        Try Again
                      </Button>
                    )}
                  </div>
                )}

                {/* Dropzone */}
                {!processingStatus && !uploadError && (
                  <div
                    {...getRootProps()}
                    className={`
                      border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
                      transition-colors duration-200
                      ${isDragActive 
                        ? "border-blue-500 bg-blue-50" 
                        : "border-gray-300 hover:border-gray-400"
                      }
                      ${busy ? "opacity-50 cursor-not-allowed" : ""}
                    `}
                  >
                    <input {...getInputProps()} />
                    
                    {busy ? (
                      <div className="space-y-3">
                        <Loader2 className="h-10 w-10 mx-auto text-blue-500 animate-spin" />
                        <p className="text-gray-600">
                          {checkingDuplicate ? "Checking for duplicates…" : "Uploading…"}
                        </p>
                        {!checkingDuplicate && (
                          <Progress value={uploadProgress} className="w-48 mx-auto" />
                        )}
                      </div>
                    ) : (
                      <>
                        <FileText className="h-10 w-10 mx-auto text-gray-400 mb-3" />
                        <p className="text-gray-600">
                          {isDragActive
                            ? "Drop your manuscript here..."
                            : "Drag and drop your manuscript here, or click to browse"
                          }
                        </p>
                        <p className="text-sm text-gray-400 mt-2">
                          Supported formats: PDF, DOCX (Max 50 MB)
                        </p>
                      </>
                    )}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
