"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Search, BookOpen, ArrowRight, Loader2 } from "lucide-react";
import { isSuperuser } from "@/lib/superuser";

interface JournalOption {
  id: string;
  slug: string;
  name: string;
}

export default function StandaloneReviewerFinderPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [journals, setJournals] = useState<JournalOption[]>([]);
  const [selectedSlug, setSelectedSlug] = useState("");
  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    const fetchJournals = async () => {
      try {
        const res = await fetch("/api/journals");
        const data = await res.json();
        if (res.ok && data.journals) {
          // If exactly one journal, redirect immediately without ever showing the picker
          if (data.journals.length === 1) {
            setRedirecting(true);
            router.replace(`/dashboard/journals/${data.journals[0].slug}/reviewers`);
            return;
          }
          setJournals(data.journals);
          if (data.journals.length === 1) {
            setSelectedSlug(data.journals[0].slug);
          }
        }
      } catch (error) {
        console.error("Failed to fetch journals:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchJournals();
  }, [router]);

  const handleGo = () => {
    if (selectedSlug) {
      router.push(`/dashboard/journals/${selectedSlug}/reviewers`);
    }
  };

  // Show only a spinner while loading or redirecting
  if (loading || redirecting) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto py-8">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Find Reviewers
          </CardTitle>
          <CardDescription>
            Discover expert reviewers from PubMed, OpenAlex, and Semantic Scholar.
            Select a journal context to get started.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {journals.length === 0 ? (
            <div className="text-center py-6 space-y-3">
              <BookOpen className="h-10 w-10 text-gray-400 mx-auto" />
              <p className="text-sm text-gray-600">
                You don&apos;t have any journals yet. Create one to start finding reviewers.
              </p>
              {isSuperuser(session?.user?.email) && (
                <Button onClick={() => router.push("/dashboard/journals/new")}>
                  Create Journal
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label>Select Journal</Label>
                <Select value={selectedSlug} onValueChange={setSelectedSlug}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a journal..." />
                  </SelectTrigger>
                  <SelectContent>
                    {journals.map((j) => (
                      <SelectItem key={j.slug} value={j.slug}>
                        {j.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleGo} disabled={!selectedSlug} className="w-full">
                Open Reviewer Finder
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
