"use client";

import { Suspense } from "react";
import { Loader2, BookOpen } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ReviewerSearchContent } from "@/components/reviewers/reviewer-search-content";
import { useEditorContext } from "@/hooks/use-editor-context";

function EditorReviewersContent() {
  const { hasJournal, journalSlug, publisherId, journalId, loading } = useEditorContext();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!hasJournal || !journalSlug) {
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
    <ReviewerSearchContent
      journalSlug={journalSlug}
      coiHref="/dashboard/editor/coi"
      publisherId={publisherId}
      journalId={journalId}
    />
  );
}

export default function EditorReviewersPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64">Loading...</div>}>
      <EditorReviewersContent />
    </Suspense>
  );
}
