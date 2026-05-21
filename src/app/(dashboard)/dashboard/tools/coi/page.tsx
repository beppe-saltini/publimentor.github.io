"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { AlertTriangle, BookOpen, ArrowRight, Loader2 } from "lucide-react";
import { isSuperuser } from "@/lib/superuser";

interface JournalOption {
  id: string;
  slug: string;
  name: string;
}

export default function StandaloneCOIPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [journals, setJournals] = useState<JournalOption[]>([]);
  const [selectedSlug, setSelectedSlug] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchJournals = async () => {
      try {
        const res = await fetch("/api/journals");
        const data = await res.json();
        if (res.ok && data.journals) {
          setJournals(data.journals);
        }
      } catch (error) {
        console.error("Failed to fetch journals:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchJournals();
  }, []);

  useEffect(() => {
    if (!loading && journals.length === 1) {
      router.push(`/dashboard/journals/${journals[0].slug}/coi`);
    }
  }, [loading, journals, router]);

  const handleGo = () => {
    if (selectedSlug) {
      router.push(`/dashboard/journals/${selectedSlug}/coi`);
    }
  };

  return (
    <div className="max-w-xl mx-auto py-8">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            COI Screening
          </CardTitle>
          <CardDescription>
            Check for conflicts of interest between authors and potential reviewers
            using OpenAlex co-publication data.
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
                You don&apos;t have any journals yet. Create one to start COI screening.
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
                Open COI Screening
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
