"use client";

import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { 
  Upload, FileText, CheckCircle, XCircle, Loader2, 
  AlertCircle, FileType, Clock, Users, BookOpen
} from "lucide-react";
import { toast } from "sonner";

interface UploadFormProps {
  publisherId: string;
  journalId?: string;
  onUploadComplete?: (manuscriptId: string) => void;
}

interface ProcessingStatus {
  id: string;
  status: string;
  progress: number;
  stage: string;
  title?: string;
  wordCount?: number;
  pageCount?: number;
  authorCount?: number;
  referenceCount?: number;
  isComplete: boolean;
  hasError: boolean;
  processingDuration?: number;
}

export function ManuscriptUploadForm({ 
  publisherId, 
  journalId, 
  onUploadComplete 
}: UploadFormProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [manuscriptId, setManuscriptId] = useState<string | null>(null);
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Poll for processing status
  const pollStatus = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/manuscripts/${id}/status`);
      if (!response.ok) {
        throw new Error("Failed to get status");
      }
      
      const status: ProcessingStatus = await response.json();
      setProcessingStatus(status);
      
      // Continue polling if not complete
      if (!status.isComplete && !status.hasError) {
        setTimeout(() => pollStatus(id), 2000);
      } else if (status.isComplete) {
        onUploadComplete?.(id);
      }
    } catch (err) {
      console.error("Error polling status:", err);
    }
  }, [onUploadComplete]);

  // Handle file upload
  const handleUpload = async (file: File) => {
    setUploading(true);
    setUploadProgress(0);
    setError(null);
    setProcessingStatus(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("publisherId", publisherId);
      if (journalId) {
        formData.append("journalId", journalId);
      }

      // Simulate upload progress
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => Math.min(prev + 10, 90));
      }, 200);

      const response = await fetch("/api/manuscripts/upload", {
        method: "POST",
        body: formData,
      });

      clearInterval(progressInterval);
      setUploadProgress(100);

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Upload failed");
      }

      setManuscriptId(data.manuscriptId);
      toast.success("File uploaded successfully!");
      
      // Start polling for processing status
      pollStatus(data.manuscriptId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setError(message);
      toast.error(message);
    } finally {
      setUploading(false);
    }
  };

  // Dropzone configuration
  const { getRootProps, getInputProps, isDragActive, acceptedFiles } = useDropzone({
    onDrop: (files) => {
      if (files.length > 0) {
        handleUpload(files[0]);
      }
    },
    accept: {
      "application/pdf": [".pdf"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
    },
    maxFiles: 1,
    maxSize: 50 * 1024 * 1024, // 50MB
    disabled: uploading || !!manuscriptId,
  });

  // Format file size
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  // Reset to upload another
  const handleReset = () => {
    setManuscriptId(null);
    setProcessingStatus(null);
    setError(null);
    setUploadProgress(0);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="h-5 w-5" />
          Upload Manuscript
        </CardTitle>
        <CardDescription>
          Upload a PDF or Word document. The system will extract metadata using AI.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Error display */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
            <XCircle className="h-5 w-5 text-red-500 mt-0.5" />
            <div>
              <p className="font-medium text-red-800">Upload Failed</p>
              <p className="text-sm text-red-600">{error}</p>
              <Button 
                variant="outline" 
                size="sm" 
                className="mt-2"
                onClick={handleReset}
              >
                Try Again
              </Button>
            </div>
          </div>
        )}

        {/* Dropzone */}
        {!manuscriptId && !error && (
          <div
            {...getRootProps()}
            className={`
              border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
              transition-colors duration-200
              ${isDragActive 
                ? "border-blue-500 bg-blue-50" 
                : "border-gray-300 hover:border-gray-400"
              }
              ${uploading ? "opacity-50 cursor-not-allowed" : ""}
            `}
          >
            <input {...getInputProps()} />
            
            {uploading ? (
              <div className="space-y-3">
                <Loader2 className="h-10 w-10 mx-auto text-blue-500 animate-spin" />
                <p className="text-gray-600">Uploading...</p>
                <Progress value={uploadProgress} className="w-48 mx-auto" />
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
                  Supported formats: PDF, DOCX (Max 50MB)
                </p>
              </>
            )}
          </div>
        )}

        {/* Processing status */}
        {processingStatus && (
          <div className="space-y-4">
            {/* Status header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {processingStatus.isComplete ? (
                  <CheckCircle className="h-5 w-5 text-green-500" />
                ) : processingStatus.hasError ? (
                  <XCircle className="h-5 w-5 text-red-500" />
                ) : (
                  <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
                )}
                <span className="font-medium">
                  {processingStatus.isComplete 
                    ? "Processing Complete" 
                    : processingStatus.hasError
                    ? "Processing Failed"
                    : "Processing..."
                  }
                </span>
              </div>
              <Badge 
                variant={
                  processingStatus.isComplete 
                    ? "default" 
                    : processingStatus.hasError 
                    ? "destructive" 
                    : "secondary"
                }
              >
                {processingStatus.status}
              </Badge>
            </div>

            {/* Progress bar */}
            {!processingStatus.isComplete && !processingStatus.hasError && (
              <div className="space-y-1">
                <Progress value={processingStatus.progress} />
                <p className="text-sm text-gray-500">{processingStatus.stage}</p>
              </div>
            )}

            {/* Results */}
            {processingStatus.isComplete && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-3">
                <h4 className="font-medium text-green-800">
                  {processingStatus.title || "Document Processed"}
                </h4>
                
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  {processingStatus.wordCount && (
                    <div className="flex items-center gap-2">
                      <FileType className="h-4 w-4 text-green-600" />
                      <span>{processingStatus.wordCount.toLocaleString()} words</span>
                    </div>
                  )}
                  {processingStatus.pageCount && (
                    <div className="flex items-center gap-2">
                      <BookOpen className="h-4 w-4 text-green-600" />
                      <span>{processingStatus.pageCount} pages</span>
                    </div>
                  )}
                  {processingStatus.authorCount !== undefined && (
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-green-600" />
                      <span>{processingStatus.authorCount} authors</span>
                    </div>
                  )}
                  {processingStatus.referenceCount !== undefined && (
                    <div className="flex items-center gap-2">
                      <BookOpen className="h-4 w-4 text-green-600" />
                      <span>{processingStatus.referenceCount} references</span>
                    </div>
                  )}
                </div>

                {processingStatus.processingDuration && (
                  <div className="flex items-center gap-2 text-sm text-green-600">
                    <Clock className="h-4 w-4" />
                    <span>Processed in {processingStatus.processingDuration}s</span>
                  </div>
                )}

                <div className="flex gap-2 mt-4">
                  <Button 
                    onClick={() => window.location.href = `/dashboard/manuscripts/${manuscriptId}`}
                  >
                    View Manuscript
                  </Button>
                  <Button variant="outline" onClick={handleReset}>
                    Upload Another
                  </Button>
                </div>
              </div>
            )}

            {/* Error state */}
            {processingStatus.hasError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-red-500 mt-0.5" />
                  <div>
                    <p className="font-medium text-red-800">Processing Failed</p>
                    <p className="text-sm text-red-600">{processingStatus.stage}</p>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="mt-2"
                      onClick={handleReset}
                    >
                      Try Again
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Selected file info */}
        {acceptedFiles.length > 0 && !error && (
          <div className="text-sm text-gray-500">
            Selected: {acceptedFiles[0].name} ({formatSize(acceptedFiles[0].size)})
          </div>
        )}
      </CardContent>
    </Card>
  );
}
