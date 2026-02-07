"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Building,
  BookOpen,
  Upload,
  Shield,
  CheckCircle,
  ArrowRight,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

interface OnboardingProps {
  userName?: string;
}

type OnboardingStep = "welcome" | "publisher" | "journal" | "done";

export function Onboarding({ userName }: OnboardingProps) {
  const router = useRouter();
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Publisher form
  const [publisherName, setPublisherName] = useState("");
  const [publisherSlug, setPublisherSlug] = useState("");

  // Journal form
  const [journalName, setJournalName] = useState("");
  const [journalSlug, setJournalSlug] = useState("");
  const [journalDescription, setJournalDescription] = useState("");

  // Created IDs
  const [createdPublisherId, setCreatedPublisherId] = useState<string | null>(null);
  const [createdJournalSlug, setCreatedJournalSlug] = useState<string | null>(null);

  const generateSlug = (name: string) =>
    name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 50);

  const handleCreatePublisher = async () => {
    if (!publisherName.trim()) {
      toast.error("Please enter an organization name");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/publishers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: publisherName,
          slug: publisherSlug || generateSlug(publisherName),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create organization");
      }

      setCreatedPublisherId(data.publisher?.id || data.id);
      toast.success("Organization created successfully!");
      setStep("journal");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create organization");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateJournal = async () => {
    if (!journalName.trim()) {
      toast.error("Please enter a journal name");
      return;
    }

    setIsSubmitting(true);
    try {
      const slug = journalSlug || generateSlug(journalName);
      const response = await fetch("/api/journals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: journalName,
          slug,
          description: journalDescription,
          publisherId: createdPublisherId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create journal");
      }

      setCreatedJournalSlug(slug);
      toast.success("Journal created successfully!");
      setStep("done");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create journal");
    } finally {
      setIsSubmitting(false);
    }
  };

  const steps = [
    { id: "welcome", label: "Welcome", icon: CheckCircle },
    { id: "publisher", label: "Organization", icon: Building },
    { id: "journal", label: "Journal", icon: BookOpen },
    { id: "done", label: "Ready", icon: Shield },
  ];

  const currentStepIndex = steps.findIndex((s) => s.id === step);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Step Progress Bar */}
      <div className="flex items-center justify-center gap-2">
        {steps.map((s, i) => (
          <div key={s.id} className="flex items-center">
            <div
              className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium transition-colors ${
                i <= currentStepIndex
                  ? "bg-blue-600 text-white"
                  : "bg-gray-200 text-gray-500"
              }`}
            >
              {i < currentStepIndex ? (
                <CheckCircle className="h-4 w-4" />
              ) : (
                i + 1
              )}
            </div>
            {i < steps.length - 1 && (
              <div
                className={`w-12 sm:w-20 h-0.5 mx-1 transition-colors ${
                  i < currentStepIndex ? "bg-blue-600" : "bg-gray-200"
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step Content */}
      {step === "welcome" && (
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">
              Welcome to PubliMentor{userName ? `, ${userName}` : ""}!
            </CardTitle>
            <CardDescription className="text-base">
              Let&apos;s set up your editorial workspace in just a few steps.
              You&apos;ll be ready to manage submissions, find reviewers, and run
              integrity checks in under 2 minutes.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <Building className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium">Create your organization</p>
                  <p className="text-xs text-gray-500">
                    Set up your publishing house or research group
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <BookOpen className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium">Create your first journal</p>
                  <p className="text-xs text-gray-500">
                    Configure your journal and invite team members
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <Upload className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium">Upload a manuscript</p>
                  <p className="text-xs text-gray-500">
                    Try uploading a PDF to see automatic metadata extraction
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <Shield className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium">Run integrity checks</p>
                  <p className="text-xs text-gray-500">
                    Screen for tortured phrases, validate references, and more
                  </p>
                </div>
              </div>
            </div>

            <Button
              onClick={() => setStep("publisher")}
              className="w-full"
              size="lg"
            >
              Get Started
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>

            <button
              onClick={() => router.push("/dashboard")}
              className="block mx-auto text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              Skip setup, go to dashboard
            </button>
          </CardContent>
        </Card>
      )}

      {step === "publisher" && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-blue-50 text-blue-700">
                Step 1 of 3
              </Badge>
            </div>
            <CardTitle className="flex items-center gap-2">
              <Building className="h-5 w-5" />
              Create Your Organization
            </CardTitle>
            <CardDescription>
              An organization groups your journals and team members. This can be your
              publishing house, university department, or research group.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="publisherName">Organization Name *</Label>
              <Input
                id="publisherName"
                placeholder="e.g., Acme Academic Publishing"
                value={publisherName}
                onChange={(e) => {
                  setPublisherName(e.target.value);
                  if (!publisherSlug) {
                    setPublisherSlug(generateSlug(e.target.value));
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="publisherSlug">URL Slug</Label>
              <Input
                id="publisherSlug"
                placeholder="acme-academic"
                value={publisherSlug}
                onChange={(e) => setPublisherSlug(e.target.value)}
              />
              <p className="text-xs text-gray-500">
                Used in URLs. Auto-generated from name if left blank.
              </p>
            </div>

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setStep("welcome")}
              >
                Back
              </Button>
              <Button
                onClick={handleCreatePublisher}
                disabled={isSubmitting || !publisherName.trim()}
                className="flex-1"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <ArrowRight className="h-4 w-4 mr-2" />
                )}
                Create & Continue
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "journal" && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-blue-50 text-blue-700">
                Step 2 of 3
              </Badge>
            </div>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              Create Your First Journal
            </CardTitle>
            <CardDescription>
              Set up your journal&apos;s identity. You can always change these
              settings later and add more journals.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="journalName">Journal Name *</Label>
              <Input
                id="journalName"
                placeholder="e.g., Journal of Computational Biology"
                value={journalName}
                onChange={(e) => {
                  setJournalName(e.target.value);
                  if (!journalSlug) {
                    setJournalSlug(generateSlug(e.target.value));
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="journalSlug">URL Slug</Label>
              <Input
                id="journalSlug"
                placeholder="journal-comp-bio"
                value={journalSlug}
                onChange={(e) => setJournalSlug(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="journalDesc">Description (optional)</Label>
              <Input
                id="journalDesc"
                placeholder="A peer-reviewed journal covering..."
                value={journalDescription}
                onChange={(e) => setJournalDescription(e.target.value)}
              />
            </div>

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setStep("publisher")}
              >
                Back
              </Button>
              <Button
                onClick={handleCreateJournal}
                disabled={isSubmitting || !journalName.trim()}
                className="flex-1"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <ArrowRight className="h-4 w-4 mr-2" />
                )}
                Create Journal
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "done" && (
        <Card className="border-green-200 bg-green-50">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <div className="bg-green-100 rounded-full p-4">
                <CheckCircle className="h-10 w-10 text-green-600" />
              </div>
            </div>
            <CardTitle className="text-2xl text-green-800">
              You&apos;re All Set!
            </CardTitle>
            <CardDescription className="text-green-700 text-base">
              Your workspace is ready. Here&apos;s what you can do next:
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <Button
                variant="outline"
                className="h-auto py-4 flex-col items-start text-left"
                onClick={() =>
                  router.push(
                    createdJournalSlug
                      ? `/dashboard/journals/${createdJournalSlug}/submissions/new`
                      : "/dashboard/manuscripts"
                  )
                }
              >
                <Upload className="h-5 w-5 mb-1 text-blue-600" />
                <span className="font-medium">Upload a Manuscript</span>
                <span className="text-xs text-gray-500">
                  Upload a PDF and see metadata extraction
                </span>
              </Button>
              <Button
                variant="outline"
                className="h-auto py-4 flex-col items-start text-left"
                onClick={() =>
                  router.push(
                    createdJournalSlug
                      ? `/dashboard/journals/${createdJournalSlug}/reviewers`
                      : "/dashboard"
                  )
                }
              >
                <BookOpen className="h-5 w-5 mb-1 text-blue-600" />
                <span className="font-medium">Find Reviewers</span>
                <span className="text-xs text-gray-500">
                  Discover expert reviewers from PubMed & OpenAlex
                </span>
              </Button>
              <Button
                variant="outline"
                className="h-auto py-4 flex-col items-start text-left"
                onClick={() =>
                  router.push(
                    createdJournalSlug
                      ? `/dashboard/journals/${createdJournalSlug}/integrity`
                      : "/dashboard"
                  )
                }
              >
                <Shield className="h-5 w-5 mb-1 text-blue-600" />
                <span className="font-medium">Run Integrity Check</span>
                <span className="text-xs text-gray-500">
                  Screen text for tortured phrases and validate references
                </span>
              </Button>
              <Button
                variant="outline"
                className="h-auto py-4 flex-col items-start text-left"
                onClick={() => router.push("/dashboard")}
              >
                <Building className="h-5 w-5 mb-1 text-blue-600" />
                <span className="font-medium">Go to Dashboard</span>
                <span className="text-xs text-gray-500">
                  View your journals and manage your workspace
                </span>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
