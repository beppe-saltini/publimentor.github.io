"use client";

import { Loader2, BookOpen } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EditorManuscriptsList } from "@/components/editor/editor-manuscripts-list";
import { useEditorContext } from "@/hooks/use-editor-context";

export default function EditorManuscriptsPage() {
  const { hasJournal, journalId, loading } = useEditorContext();

  if (loading) {
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
            Contact your administrator to access your manuscript history.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">My manuscripts</h1>
        <p className="text-gray-600 mt-1">
          Manuscripts you have uploaded or worked on as an editor.
        </p>
      </div>
      <EditorManuscriptsList journalId={journalId} />
    </div>
  );
}
