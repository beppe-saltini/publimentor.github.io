"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Clock,
  Loader2,
  Eye,
  Users,
} from "lucide-react";

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
  authorCount: number;
  referenceCount: number;
  reviewerCount: number;
  createdAt: string;
  updatedAt: string;
}

const WORKFLOW_LABELS: Record<string, string> = {
  NEW: "New",
  FINDING_REVIEWERS: "Finding reviewers",
  REVIEWERS_INVITED: "Reviewers invited",
  CLOSED: "Closed",
};

interface EditorManuscriptsListProps {
  journalId: string | null;
}

export function EditorManuscriptsList({ journalId }: EditorManuscriptsListProps) {
  const router = useRouter();
  const [manuscripts, setManuscripts] = useState<ManuscriptSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const fetchManuscripts = useCallback(
    async (pageNum = 1) => {
      try {
        setLoading(true);
        const params = new URLSearchParams({
          page: String(pageNum),
          limit: "20",
        });
        if (journalId) {
          params.set("journalId", journalId);
        }

        const response = await fetch(`/api/manuscripts?${params}`);
        const data = await response.json();

        if (response.ok) {
          setManuscripts(data.manuscripts);
          setPage(data.pagination.page);
          setTotalPages(data.pagination.totalPages);
        }
      } catch (error) {
        console.error("Error fetching manuscripts:", error);
      } finally {
        setLoading(false);
      }
    },
    [journalId]
  );

  useEffect(() => {
    fetchManuscripts(1);
  }, [fetchManuscripts]);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  const openManuscript = (id: string) => {
    sessionStorage.setItem("active_manuscript_id", id);
    router.push(`/dashboard/editor/manuscripts/${id}`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (manuscripts.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <FileText className="h-12 w-12 mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-700">No manuscripts yet</h3>
          <p className="text-gray-500 mb-4">
            Manuscripts you upload or create will appear here.
          </p>
          <Button onClick={() => router.push("/dashboard/editor/reviewers")}>
            Start with find reviewers
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {manuscripts.map((manuscript) => (
        <Card
          key={manuscript.id}
          className="hover:shadow-md transition-shadow cursor-pointer"
          onClick={() => openManuscript(manuscript.id)}
        >
          <CardContent className="py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <FileText className="h-5 w-5 text-gray-400 shrink-0" />
                  <h3 className="font-medium text-blue-700 truncate">
                    {manuscript.title || manuscript.fileName}
                  </h3>
                  <Badge variant="secondary" className="text-xs">
                    {WORKFLOW_LABELS[manuscript.workflowStatus] || manuscript.workflowStatus}
                  </Badge>
                  {manuscript.status !== "READY" && (
                    <Badge variant="outline" className="text-xs">
                      {manuscript.status}
                    </Badge>
                  )}
                </div>

                <div className="flex flex-wrap gap-4 text-sm text-gray-500 ml-7">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {new Date(manuscript.updatedAt).toLocaleDateString()}
                  </span>
                  {manuscript.wordCount != null && (
                    <span>{manuscript.wordCount.toLocaleString()} words</span>
                  )}
                  {manuscript.authorCount > 0 && (
                    <span className="flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" />
                      {manuscript.authorCount} authors
                    </span>
                  )}
                  {manuscript.reviewerCount > 0 && (
                    <span>{manuscript.reviewerCount} reviewers saved</span>
                  )}
                  {manuscript.fileType !== "manual" && (
                    <span>{formatSize(manuscript.fileSize)}</span>
                  )}
                </div>
              </div>

              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  openManuscript(manuscript.id);
                }}
              >
                <Eye className="h-4 w-4 mr-1" />
                Open
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}

      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <Button
            variant="outline"
            disabled={page === 1}
            onClick={() => fetchManuscripts(page - 1)}
          >
            Previous
          </Button>
          <span className="flex items-center px-4 text-sm text-gray-500">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            disabled={page === totalPages}
            onClick={() => fetchManuscripts(page + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
