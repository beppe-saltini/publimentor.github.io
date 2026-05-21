"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Loader2,
  Search,
  AlertTriangle,
  Users,
  Clock,
  FileText,
} from "lucide-react";
import { toast } from "sonner";

interface ManuscriptDetail {
  id: string;
  title?: string;
  abstract?: string;
  keywords: string[];
  status: string;
  workflowStatus: string;
  fileName: string;
  wordCount?: number;
  authorCount?: number;
  createdAt: string;
  updatedAt: string;
}

export default function EditorManuscriptDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [loading, setLoading] = useState(true);
  const [manuscript, setManuscript] = useState<ManuscriptDetail | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/manuscripts/${id}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load");
        setManuscript(data.manuscript);
        sessionStorage.setItem("active_manuscript_id", id);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to load manuscript");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  const continueFindReviewers = () => {
    sessionStorage.setItem("active_manuscript_id", id);
    router.push(`/dashboard/editor/reviewers?manuscriptId=${id}`);
  };

  const openCoi = () => {
    sessionStorage.setItem("active_manuscript_id", id);
    sessionStorage.setItem("coi_manuscript_id", id);
    router.push("/dashboard/editor/coi");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!manuscript) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-gray-600">Manuscript not found.</p>
          <Button variant="outline" className="mt-4" asChild>
            <Link href="/dashboard/editor/manuscripts">Back to list</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link href="/dashboard/editor/manuscripts">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to manuscripts
        </Link>
      </Button>

      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          {manuscript.title || manuscript.fileName}
        </h1>
        <div className="flex flex-wrap gap-2 mt-2">
          <Badge variant="secondary">{manuscript.workflowStatus.replace(/_/g, " ")}</Badge>
          <Badge variant="outline">{manuscript.status}</Badge>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button onClick={continueFindReviewers}>
          <Search className="h-4 w-4 mr-2" />
          Find reviewers
        </Button>
        <Button variant="outline" onClick={openCoi}>
          <AlertTriangle className="h-4 w-4 mr-2" />
          COI check
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="flex flex-wrap gap-4 text-gray-600">
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              Updated {new Date(manuscript.updatedAt).toLocaleDateString()}
            </span>
            {manuscript.wordCount != null && (
              <span>{manuscript.wordCount.toLocaleString()} words</span>
            )}
            {manuscript.authorCount != null && manuscript.authorCount > 0 && (
              <span className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                {manuscript.authorCount} authors
              </span>
            )}
          </div>

          {manuscript.abstract && (
            <div>
              <p className="font-medium text-gray-900 mb-1">Abstract</p>
              <p className="text-gray-600 whitespace-pre-wrap line-clamp-6">
                {manuscript.abstract}
              </p>
            </div>
          )}

          {manuscript.keywords.length > 0 && (
            <div>
              <p className="font-medium text-gray-900 mb-2">Keywords</p>
              <div className="flex flex-wrap gap-1">
                {manuscript.keywords.map((kw) => (
                  <Badge key={kw} variant="outline" className="text-xs">
                    {kw}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-amber-50 border-amber-200">
        <CardContent className="py-3 text-sm text-amber-800">
          For the full reviewer shortlist, format checks, and advanced tools, use the actions
          above or open this manuscript from the full dashboard if needed.
        </CardContent>
      </Card>
    </div>
  );
}
