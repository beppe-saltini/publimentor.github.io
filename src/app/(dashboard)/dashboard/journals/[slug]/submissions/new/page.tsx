"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Upload, FileText, Loader2, CheckCircle, AlertCircle, Users } from "lucide-react";
import { toast } from "sonner";
import { useDropzone } from "react-dropzone";

interface Author {
  name: string;
  email: string;
  orcid: string;
  affiliation: string;
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

export default function NewSubmissionPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;

  const [isLoading, setIsLoading] = useState(false);
  const [title, setTitle] = useState("");
  const [abstract, setAbstract] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [authors, setAuthors] = useState<Author[]>([
    { name: "", email: "", orcid: "", affiliation: "" },
  ]);
  
  // Upload and extraction state
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus | null>(null);
  const [manuscriptId, setManuscriptId] = useState<string | null>(null);
  const [defaultPublisherId, setDefaultPublisherId] = useState<string | null>(null);
  const [dataExtracted, setDataExtracted] = useState(false);

  // Fetch default publisher on mount
  useEffect(() => {
    const fetchPublisher = async () => {
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
    fetchPublisher();
  }, []);

  // Poll for processing status
  const pollStatus = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/manuscripts/${id}/status`);
      if (!response.ok) throw new Error("Failed to get status");
      
      const status: ProcessingStatus = await response.json();
      setProcessingStatus(status);
      
      if (!status.isComplete && !status.hasError) {
        setTimeout(() => pollStatus(id), 2000);
      } else if (status.isComplete) {
        // Fetch manuscript details and populate form
        fetchManuscriptDetails(id);
      }
    } catch (err) {
      console.error("Error polling status:", err);
    }
  }, []);

  // Fetch manuscript details and populate form
  const fetchManuscriptDetails = async (id: string) => {
    try {
      const response = await fetch(`/api/manuscripts/${id}`);
      const data = await response.json();
      
      if (response.ok && data.manuscript) {
        const m = data.manuscript;
        
        // Populate form fields
        if (m.title) setTitle(m.title);
        if (m.abstract) setAbstract(m.abstract);
        
        if (m.authors && m.authors.length > 0) {
          setAuthors(m.authors.map((a: any) => ({
            name: a.fullName || "",
            email: a.email || "",
            orcid: a.orcid || "",
            affiliation: m.affiliations?.find((aff: any) => 
              a.affiliationNums?.includes(aff.affiliationNumber)
            )?.rawText || "",
          })));
        }
        
        setDataExtracted(true);
        toast.success("Manuscript data extracted! Review and submit when ready.");
      }
    } catch (error) {
      console.error("Failed to fetch manuscript details:", error);
    }
  };

  // Handle file upload — two-step Supabase direct upload
  const handleUpload = async (file: File) => {
    if (!defaultPublisherId) {
      toast.error("Please wait while we set up your account...");
      return;
    }

    const MAX_SIZE = 50 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      toast.error(`File is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maximum is 50 MB.`);
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setPdfFile(file);

    try {
      // Step 1: Init
      setUploadProgress(5);
      const initRes = await fetch("/api/manuscripts/upload/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publisherId: defaultPublisherId, fileName: file.name, fileSize: file.size }),
      });
      const initText = await initRes.text();
      const initData = JSON.parse(initText);
      if (!initRes.ok) throw new Error(initData.error || "Failed to initialize upload");
      const { manuscriptId: msId, signedUrl } = initData;
      setUploadProgress(10);

      // Step 2: Upload to Supabase
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
        xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (HTTP ${xhr.status})`));
        xhr.onerror = () => reject(new Error("Network error during upload"));
        xhr.send(file);
      });
      setUploadProgress(85);

      // Step 3: Trigger processing
      const processRes = await fetch(`/api/manuscripts/${msId}/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const processText = await processRes.text();
      const processData = JSON.parse(processText);
      if (!processRes.ok) throw new Error(processData.error || "Failed to start processing");
      setUploadProgress(90);

      setManuscriptId(msId);
      toast.success("File uploaded! Processing manuscript...");
      pollStatus(msId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      toast.error(message);
      setPdfFile(null);
    } finally {
      setUploading(false);
    }
  };

  // Dropzone
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (files) => {
      if (files.length > 0) handleUpload(files[0]);
    },
    accept: { "application/pdf": [".pdf"] },
    maxFiles: 1,
    maxSize: 50 * 1024 * 1024,
    disabled: uploading || !!processingStatus,
  });

  const addAuthor = () => {
    setAuthors([...authors, { name: "", email: "", orcid: "", affiliation: "" }]);
  };

  const removeAuthor = (index: number) => {
    if (authors.length > 1) {
      setAuthors(authors.filter((_, i) => i !== index));
    }
  };

  const updateAuthor = (index: number, field: keyof Author, value: string) => {
    const updated = [...authors];
    updated[index][field] = value;
    setAuthors(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!title.trim()) {
      toast.error("Please enter a title");
      return;
    }

    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.append("title", title);
      formData.append("abstract", abstract);
      formData.append("authors", JSON.stringify(authors.filter((a) => a.name)));
      if (pdfFile) {
        formData.append("pdf", pdfFile);
      }
      if (manuscriptId) {
        formData.append("manuscriptId", manuscriptId);
      }

      const response = await fetch(`/api/journals/${slug}/submissions`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create submission");
      }

      toast.success("Submission created successfully");
      router.push(`/dashboard/journals/${slug}/submissions/${data.submission.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create submission");
    } finally {
      setIsLoading(false);
    }
  };

  const resetUpload = () => {
    setPdfFile(null);
    setManuscriptId(null);
    setProcessingStatus(null);
    setUploadProgress(0);
    setDataExtracted(false);
    setTitle("");
    setAbstract("");
    setAuthors([{ name: "", email: "", orcid: "", affiliation: "" }]);
  };

  return (
    <div className="max-w-3xl mx-auto">
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Step 1: Upload PDF */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Step 1: Upload Manuscript
            </CardTitle>
            <CardDescription>
              Upload your PDF and we&apos;ll automatically extract the title, abstract, and authors
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Processing status */}
            {processingStatus && !processingStatus.isComplete && !processingStatus.hasError && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
                  <span className="font-medium">Extracting manuscript data...</span>
                </div>
                <Progress value={processingStatus.progress} />
                <p className="text-sm text-gray-500 mt-1">{processingStatus.stage}</p>
              </div>
            )}

            {/* Success state */}
            {dataExtracted && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4 flex items-start gap-3">
                <CheckCircle className="h-5 w-5 text-green-500 mt-0.5" />
                <div className="flex-1">
                  <p className="font-medium text-green-800">Data extracted successfully!</p>
                  <p className="text-sm text-green-600">Review the information below and submit when ready.</p>
                  <div className="flex gap-2 mt-2">
                    <Badge variant="secondary">{pdfFile?.name}</Badge>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={resetUpload}>
                  Upload Different
                </Button>
              </div>
            )}

            {/* Error state */}
            {processingStatus?.hasError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4 flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-red-500 mt-0.5" />
                <div>
                  <p className="font-medium text-red-800">Processing failed</p>
                  <p className="text-sm text-red-600">Please try again with a different file.</p>
                  <Button variant="outline" size="sm" className="mt-2" onClick={resetUpload}>
                    Try Again
                  </Button>
                </div>
              </div>
            )}

            {/* Dropzone */}
            {!processingStatus && !dataExtracted && (
              <div
                {...getRootProps()}
                className={`
                  border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
                  transition-colors duration-200
                  ${isDragActive ? "border-blue-500 bg-blue-50" : "border-gray-300 hover:border-gray-400"}
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
                      {isDragActive ? "Drop your PDF here..." : "Drag and drop your PDF here, or click to browse"}
                    </p>
                    <p className="text-sm text-gray-400 mt-2">Maximum file size: 50MB</p>
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Step 2: Review/Edit extracted data */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Step 2: Review Submission Details
            </CardTitle>
            <CardDescription>
              {dataExtracted 
                ? "Review the extracted information and make any corrections" 
                : "Upload a PDF above, or fill in the details manually"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                placeholder="Enter the paper title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="abstract">Abstract</Label>
              <Textarea
                id="abstract"
                placeholder="Enter the paper abstract"
                value={abstract}
                onChange={(e) => setAbstract(e.target.value)}
                rows={6}
                disabled={isLoading}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Step 3: Authors
                </CardTitle>
                <CardDescription>
                  {dataExtracted 
                    ? "Review the extracted authors and make any corrections" 
                    : "Add authors in order of contribution"}
                </CardDescription>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addAuthor}>
                <Plus className="h-4 w-4 mr-2" />
                Add Author
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {authors.map((author, index) => (
              <div key={index} className="border rounded-lg p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Author {index + 1}</span>
                  {authors.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeAuthor(index)}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Name</Label>
                    <Input
                      placeholder="Full name"
                      value={author.name}
                      onChange={(e) => updateAuthor(index, "name", e.target.value)}
                      required
                      disabled={isLoading}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <Input
                      type="email"
                      placeholder="email@example.com"
                      value={author.email}
                      onChange={(e) => updateAuthor(index, "email", e.target.value)}
                      disabled={isLoading}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>ORCID</Label>
                    <Input
                      placeholder="0000-0000-0000-0000"
                      value={author.orcid}
                      onChange={(e) => updateAuthor(index, "orcid", e.target.value)}
                      disabled={isLoading}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Affiliation</Label>
                    <Input
                      placeholder="University or institution"
                      value={author.affiliation}
                      onChange={(e) => updateAuthor(index, "affiliation", e.target.value)}
                      disabled={isLoading}
                    />
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="flex gap-4">
          <Button type="submit" disabled={isLoading}>
            {isLoading ? "Submitting..." : "Submit Paper"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={isLoading}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
