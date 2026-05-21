"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, BookOpen } from "lucide-react";
import { ManuscriptInputPanel, type ManuscriptReadyData } from "@/components/editor/manuscript-input-panel";
import { SimpleReviewerFinder } from "@/components/editor/simple-reviewer-finder";

export default function EditorReviewersPage() {
  const [loading, setLoading] = useState(true);
  const [hasJournal, setHasJournal] = useState(false);
  const [publisherId, setPublisherId] = useState<string | null>(null);
  const [journalId, setJournalId] = useState<string | null>(null);
  const [manuscriptData, setManuscriptData] = useState<ManuscriptReadyData | null>(null);

  useEffect(() => {
    const loadContext = async () => {
      try {
        const res = await fetch("/api/editor/context");
        const data = await res.json();
        if (res.ok) {
          setHasJournal(data.hasJournal);
          setPublisherId(data.publisherId ?? null);
          setJournalId(data.journalId ?? null);
        }
      } catch (err) {
        console.error("Failed to load editor context:", err);
      } finally {
        setLoading(false);
      }
    };
    loadContext();
  }, []);

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
