"use client";

import { Suspense } from "react";
import { Loader2, BookOpen, CheckSquare } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormatCheckContent } from "@/components/format/format-check-content";
import { useEditorContext } from "@/hooks/use-editor-context";

function EditorFormatPage() {
  const { hasJournal, journalSlug, publisherId, loading } = useEditorContext();

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
            Contact your administrator before using format checking.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <CheckSquare className="h-6 w-6" />
          Format check
        </h1>
        <p className="text-gray-600 mt-1">
          Verify manuscript formatting and required statements against journal guidelines.
        </p>
      </div>
      <FormatCheckContent journalSlug={journalSlug} publisherId={publisherId ?? undefined} />
    </div>
  );
}

export default function EditorFormatPageWrapper() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64">Loading...</div>}>
      <EditorFormatPage />
    </Suspense>
  );
}
