"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, BookOpen } from "lucide-react";
import { ManuscriptInputPanel, type ManuscriptReadyData } from "@/components/editor/manuscript-input-panel";
import { SimpleReviewerFinder } from "@/components/editor/simple-reviewer-finder";
import { useEditorContext } from "@/hooks/use-editor-context";

function EditorReviewersContent() {
  const searchParams = useSearchParams();
  const manuscriptIdParam = searchParams.get("manuscriptId");
  const { hasJournal, publisherId, journalId, loading } = useEditorContext();
  const [manuscriptData, setManuscriptData] = useState<ManuscriptReadyData | null>(null);
  const [loadingManuscript, setLoadingManuscript] = useState(!!manuscriptIdParam);

  useEffect(() => {
    if (!manuscriptIdParam) {
      setLoadingManuscript(false);
      return;
    }

    const load = async () => {
      try {
        const res = await fetch(`/api/manuscripts/${manuscriptIdParam}`);
        const data = await res.json();
        if (res.ok && data.manuscript) {
          const ms = data.manuscript;
          setManuscriptData({
            manuscriptId: ms.id,
            title: ms.title,
            abstract: ms.abstract || "",
            keywords: ms.keywords || [],
            authors: (ms.authors || []).map(
              (a: { fullName?: string; name?: string }) => ({
                name: a.fullName || a.name || "",
              })
            ),
          });
          sessionStorage.setItem("active_manuscript_id", ms.id);
        }
      } catch (err) {
        console.error("Failed to load manuscript:", err);
      } finally {
        setLoadingManuscript(false);
      }
    };
    load();
  }, [manuscriptIdParam]);

  if (loading || loadingManuscript) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!hasJournal) {
    return (
      <Card className="max-w-lg mx-auto mt-12">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            No workspace assigned
          </CardTitle>
          <CardDescription>
            Your account is not linked to an editorial workspace yet. Please contact your
            administrator to be added as an editor.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-600">
            Once assigned, you can upload manuscripts, paste abstracts, or enter keywords to
            find reviewers immediately after signing in.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Find reviewers</h1>
        <p className="text-gray-600 mt-1">
          Provide your manuscript or research topic, then discover matching experts.
        </p>
      </div>

      <ManuscriptInputPanel
        publisherId={publisherId}
        journalId={journalId}
        onReady={(data) => setManuscriptData(data)}
      />

      <SimpleReviewerFinder manuscriptData={manuscriptData} />
    </div>
  );
}

export default function EditorReviewersPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64">Loading...</div>}>
      <EditorReviewersContent />
    </Suspense>
  );
}
