"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ManuscriptUploadForm } from "@/components/manuscript";
import { 
  FileText, Clock, Loader2, 
  Upload, List, Eye, Trash2, Users, BookOpen
} from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

interface ManuscriptSummary {
  id: string;
  title: string;
  status: string;
  workflowStatus: string;
  statusMessage?: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  wordCount?: number;
  pageCount?: number;
  authorCount: number;
  referenceCount: number;
  publisher: { id: string; name: string; slug: string };
  journal?: { id: string; name: string; slug: string };
  uploader: { id: string; name: string };
  isOwner: boolean;
  createdAt: string;
  updatedAt: string;
}

const WORKFLOW_OPTIONS = [
  { value: "NEW", label: "New" },
  { value: "FINDING_REVIEWERS", label: "Finding Reviewers" },
  { value: "REVIEWERS_INVITED", label: "Reviewers Invited" },
  { value: "CLOSED", label: "Closed" },
];

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function ManuscriptsPage() {
  const router = useRouter();
  const [manuscripts, setManuscripts] = useState<ManuscriptSummary[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("list");
  
  // For demo: use a default publisher (in production, get from context/selection)
  const [defaultPublisherId, setDefaultPublisherId] = useState<string | null>(null);

  // Fetch manuscripts
  const fetchManuscripts = async (page = 1) => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      
      const response = await fetch(`/api/manuscripts?${params}`);
      const data = await response.json();
      
      if (response.ok) {
        setManuscripts(data.manuscripts);
        setPagination(data.pagination);
      }
    } catch (error) {
      console.error("Error fetching manuscripts:", error);
    } finally {
      setLoading(false);
    }
  };

  // Fetch or create default publisher
  const ensureDefaultPublisher = async () => {
    try {
      // Check if user has any publishers
      const response = await fetch("/api/publishers");
      const data = await response.json();
      
      if (response.ok && data.publishers?.length > 0) {
        setDefaultPublisherId(data.publishers[0].id);
      } else {
        // Create a default publisher for the user
        const createResponse = await fetch("/api/publishers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "My Organization",
            slug: `org-${Date.now()}`,
          }),
        });
        
        if (createResponse.ok) {
          const created = await createResponse.json();
          setDefaultPublisherId(created.publisher.id);
        }
      }
    } catch (error) {
      console.error("Error ensuring publisher:", error);
    }
  };

  useEffect(() => {
    fetchManuscripts();
    ensureDefaultPublisher();
  }, []);

  // Handle workflow status change
  const handleWorkflowStatusChange = async (id: string, newStatus: string) => {
    try {
      const response = await fetch(`/api/manuscripts/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowStatus: newStatus }),
      });
      if (response.ok) {
        setManuscripts(prev =>
          prev.map(m => m.id === id ? { ...m, workflowStatus: newStatus } : m)
        );
        toast.success(`Status updated to ${newStatus.replace(/_/g, " ").toLowerCase()}`);
      } else {
        toast.error("Failed to update status");
      }
    } catch {
      toast.error("Failed to update status");
    }
  };

  // Handle delete
  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this manuscript?")) {
      return;
    }

    try {
      const response = await fetch(`/api/manuscripts/${id}`, {
        method: "DELETE",
      });

      if (response.ok) {
        toast.success("Manuscript deleted");
        fetchManuscripts();
      } else {
        const data = await response.json();
        toast.error(data.error || "Failed to delete");
      }
    } catch (error) {
      toast.error("Failed to delete manuscript");
    }
  };

  // Format file size
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };


  return (
    <div className="container mx-auto py-8 px-4 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Manuscripts</h1>
          <p className="text-gray-500">Upload and manage your manuscript documents</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="list">
            <List className="h-4 w-4 mr-2" />
            All Manuscripts
          </TabsTrigger>
          <TabsTrigger value="upload">
            <Upload className="h-4 w-4 mr-2" />
            Upload New
          </TabsTrigger>
        </TabsList>

        {/* Upload Tab */}
        <TabsContent value="upload" className="mt-6">
          {defaultPublisherId ? (
            <ManuscriptUploadForm
              publisherId={defaultPublisherId}
              onUploadComplete={(id) => {
                fetchManuscripts();
                toast.success("Manuscript processed successfully!");
              }}
            />
          ) : (
            <Card>
              <CardContent className="py-8 text-center">
                <Loader2 className="h-8 w-8 mx-auto animate-spin text-gray-400" />
                <p className="mt-2 text-gray-500">Setting up...</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* List Tab */}
        <TabsContent value="list" className="mt-6">
          {loading ? (
            <Card>
              <CardContent className="py-8 text-center">
                <Loader2 className="h-8 w-8 mx-auto animate-spin text-gray-400" />
                <p className="mt-2 text-gray-500">Loading manuscripts...</p>
              </CardContent>
            </Card>
          ) : manuscripts.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <FileText className="h-12 w-12 mx-auto text-gray-300 mb-4" />
                <h3 className="text-lg font-medium text-gray-700">No manuscripts yet</h3>
                <p className="text-gray-500 mb-4">
                  Upload your first manuscript to get started
                </p>
                <Button onClick={() => setActiveTab("upload")}>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload Manuscript
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {manuscripts.map((manuscript) => (
                <Card
                  key={manuscript.id}
                  className="hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => router.push(`/dashboard/manuscripts/${manuscript.id}`)}
                >
                  <CardContent className="py-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2">
                          <FileText className="h-5 w-5 text-gray-400 flex-shrink-0" />
                          <h3 className="font-medium truncate text-blue-700 hover:underline">
                            {manuscript.title || manuscript.fileName}
                          </h3>
                        </div>
                        
                        <div className="flex flex-wrap gap-4 text-sm text-gray-500 ml-8">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" />
                            {new Date(manuscript.createdAt).toLocaleDateString()}
                          </span>
                          {manuscript.wordCount && (
                            <span>{manuscript.wordCount.toLocaleString()} words</span>
                          )}
                          {manuscript.authorCount > 0 && (
                            <span className="flex items-center gap-1">
                              <Users className="h-3.5 w-3.5" />
                              {manuscript.authorCount} authors
                            </span>
                          )}
                          {manuscript.referenceCount > 0 && (
                            <span className="flex items-center gap-1">
                              <BookOpen className="h-3.5 w-3.5" />
                              {manuscript.referenceCount} refs
                            </span>
                          )}
                          <span className="text-gray-400">
                            {formatSize(manuscript.fileSize)}
                          </span>
                        </div>

                        {manuscript.statusMessage && manuscript.status === "ERROR" && (
                          <p className="text-sm text-red-500 mt-2 ml-8">
                            {manuscript.statusMessage}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                        <select
                          value={manuscript.workflowStatus || "NEW"}
                          onChange={(e) => handleWorkflowStatusChange(manuscript.id, e.target.value)}
                          className="h-9 text-sm border rounded-md px-3 py-1 bg-white cursor-pointer border-input hover:bg-accent hover:text-accent-foreground focus:ring-2 focus:ring-ring focus:border-ring"
                        >
                          {WORKFLOW_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => router.push(`/dashboard/manuscripts/${manuscript.id}`)}
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          View
                        </Button>
                        {manuscript.isOwner && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDelete(manuscript.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}

              {/* Pagination */}
              {pagination && pagination.totalPages > 1 && (
                <div className="flex justify-center gap-2 mt-6">
                  <Button
                    variant="outline"
                    disabled={pagination.page === 1}
                    onClick={() => fetchManuscripts(pagination.page - 1)}
                  >
                    Previous
                  </Button>
                  <span className="flex items-center px-4 text-sm text-gray-500">
                    Page {pagination.page} of {pagination.totalPages}
                  </span>
                  <Button
                    variant="outline"
                    disabled={pagination.page === pagination.totalPages}
                    onClick={() => fetchManuscripts(pagination.page + 1)}
                  >
                    Next
                  </Button>
                </div>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
