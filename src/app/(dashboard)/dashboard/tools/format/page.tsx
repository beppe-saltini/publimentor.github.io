"use client";

/**
 * Standalone Journal-Ready Formatter tool. Keeps its own journal picker (the other
 * entry points take the journal from the route) and renders the checker
 * inline once a journal is chosen. With a single journal it jumps straight to
 * that journal's format page.
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { CheckSquare, BookOpen, ArrowRight, Loader2 } from "lucide-react";
import { isSuperuser } from "@/lib/superuser";
import { FormatCheckContent } from "@/components/format";

interface JournalOption {
  id: string;
  slug: string;
  name: string;
}

export default function StandaloneFormatCheckPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [journals, setJournals] = useState<JournalOption[]>([]);
  const [selectedSlug, setSelectedSlug] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchJournals = async () => {
      try {
        const res = await fetch("/api/journals");
        const contentType = res.headers.get("content-type") ?? "";
        if (!res.ok || !contentType.includes("application/json")) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data?.journals)) setJournals(data.journals);
      } catch {
        // The empty state below covers a failed load.
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchJournals();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loading && journals.length === 1) {
      router.push(`/dashboard/journals/${journals[0].slug}/format`);
    }
  }, [loading, journals, router]);

  const selectedJournal = journals.find((j) => j.slug === selectedSlug);

  return (
    <div className="space-y-6">
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckSquare className="h-5 w-5" />
            Journal-Ready Formatter
          </CardTitle>
          <CardDescription>
            Check an accepted manuscript against a journal&apos;s final-file requirements, rebuild it in the
            journal&apos;s structure and assemble the letter to the authors. Pick a journal to start.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : journals.length === 0 ? (
            <div className="text-center py-6 space-y-3">
              <BookOpen className="h-10 w-10 text-gray-400 mx-auto" />
              <p className="text-sm text-gray-600">
                You don&apos;t have any journals yet. Create one to start format checking.
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
                <Label htmlFor="format-journal-select">Select journal</Label>
                <Select value={selectedSlug} onValueChange={setSelectedSlug}>
                  <SelectTrigger id="format-journal-select">
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
              {selectedJournal && (
                <Button
                  variant="outline"
                  onClick={() => router.push(`/dashboard/journals/${selectedJournal.slug}/format`)}
                  className="w-full"
                >
                  Open the {selectedJournal.name} format page
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {selectedSlug && <FormatCheckContent key={selectedSlug} journalSlug={selectedSlug} hideHeading />}
    </div>
  );
}
