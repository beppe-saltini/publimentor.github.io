"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { FileText, User, Building, ExternalLink, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

interface Author {
  id: string;
  name: string;
  email: string | null;
  orcid: string | null;
  affiliation: string | null;
}

interface ReviewAssignment {
  id: string;
  status: string;
  coiCleared: boolean;
  coiReport: Record<string, unknown> | null;
  reviewer: {
    id: string;
    name: string | null;
    email: string | null;
  };
}

interface Submission {
  id: string;
  title: string;
  abstract: string | null;
  pdfUrl: string | null;
  status: string;
  createdAt: string;
  authors: Author[];
  reviewAssignments: ReviewAssignment[];
}

const statusOptions = [
  { value: "SUBMITTED", label: "Submitted" },
  { value: "UNDER_REVIEW", label: "Under Review" },
  { value: "REVISION_REQUESTED", label: "Revision Requested" },
  { value: "ACCEPTED", label: "Accepted" },
  { value: "REJECTED", label: "Rejected" },
];

export default function SubmissionDetailPage() {
  const params = useParams();
  const slug = params.slug as string;
  const submissionId = params.submissionId as string;

  const [submission, setSubmission] = useState<Submission | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    const fetchSubmission = async () => {
      try {
        const response = await fetch(`/api/journals/${slug}/submissions/${submissionId}`);
        const data = await response.json();
        if (response.ok) {
          setSubmission(data.submission);
        }
      } catch (error) {
        console.error("Failed to fetch submission:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSubmission();
  }, [slug, submissionId]);

  const handleStatusChange = async (newStatus: string) => {
    setIsUpdating(true);
    try {
      const response = await fetch(`/api/journals/${slug}/submissions/${submissionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!response.ok) {
        throw new Error("Failed to update status");
      }

      setSubmission((prev) => prev ? { ...prev, status: newStatus } : null);
      toast.success("Status updated");
    } catch (error) {
      toast.error("Failed to update status");
      console.error(error);
    } finally {
      setIsUpdating(false);
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-64">Loading...</div>;
  }

  if (!submission) {
    return <div className="text-center py-12">Submission not found</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{submission.title}</h1>
          <p className="text-gray-500 mt-1">
            Submitted {format(new Date(submission.createdAt), "MMMM d, yyyy")}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Select
            value={submission.status}
            onValueChange={handleStatusChange}
            disabled={isUpdating}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {submission.pdfUrl && (
            <Button asChild>
              <a href={submission.pdfUrl} target="_blank" rel="noopener noreferrer">
                <FileText className="h-4 w-4 mr-2" />
                View PDF
              </a>
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Abstract</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-700 whitespace-pre-wrap">
                {submission.abstract || "No abstract provided"}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Authors ({submission.authors.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {submission.authors.map((author, index) => (
                  <div key={author.id} className="flex items-start gap-4">
                    <div className="bg-gray-100 rounded-full p-2">
                      <User className="h-5 w-5 text-gray-600" />
                    </div>
                    <div>
                      <p className="font-medium">
                        {author.name}
                        {index === 0 && (
                          <Badge variant="secondary" className="ml-2">
                            Corresponding
                          </Badge>
                        )}
                      </p>
                      {author.affiliation && (
                        <p className="text-sm text-gray-500 flex items-center gap-1">
                          <Building className="h-3 w-3" />
                          {author.affiliation}
                        </p>
                      )}
                      {author.email && (
                        <p className="text-sm text-gray-500">{author.email}</p>
                      )}
                      {author.orcid && (
                        <a
                          href={`https://orcid.org/${author.orcid}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-blue-600 hover:underline flex items-center gap-1"
                        >
                          ORCID: {author.orcid}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Review Assignments</CardTitle>
              <CardDescription>
                Manage reviewers for this submission
              </CardDescription>
            </CardHeader>
            <CardContent>
              {submission.reviewAssignments.length === 0 ? (
                <div className="text-center py-4">
                  <p className="text-sm text-gray-500 mb-4">No reviewers assigned yet</p>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/dashboard/journals/${slug}/reviewers?submissionId=${submissionId}`}>
                      Find Reviewers
                    </Link>
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {submission.reviewAssignments.map((assignment) => (
                    <div key={assignment.id} className="border rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">{assignment.reviewer.name}</p>
                          <p className="text-sm text-gray-500">{assignment.reviewer.email}</p>
                        </div>
                        <Badge
                          variant={
                            assignment.status === "COMPLETED"
                              ? "default"
                              : assignment.status === "DECLINED"
                              ? "destructive"
                              : "secondary"
                          }
                        >
                          {assignment.status}
                        </Badge>
                      </div>
                      {!assignment.coiCleared && assignment.coiReport && (
                        <div className="mt-2 flex items-center gap-2 text-amber-600 text-sm">
                          <AlertTriangle className="h-4 w-4" />
                          Potential conflict of interest
                        </div>
                      )}
                    </div>
                  ))}
                  <Separator />
                  <Button asChild variant="outline" size="sm" className="w-full">
                    <Link href={`/dashboard/journals/${slug}/reviewers?submissionId=${submissionId}`}>
                      Add More Reviewers
                    </Link>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button asChild variant="outline" className="w-full justify-start">
                <Link href={`/dashboard/journals/${slug}/coi?submissionId=${submissionId}`}>
                  <AlertTriangle className="h-4 w-4 mr-2" />
                  Check COI
                </Link>
              </Button>
              <Button asChild variant="outline" className="w-full justify-start">
                <Link href={`/dashboard/journals/${slug}/format?submissionId=${submissionId}`}>
                  <FileText className="h-4 w-4 mr-2" />
                  Check Format
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
