"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, FileText, Eye } from "lucide-react";
import { format } from "date-fns";

interface Author {
  id: string;
  name: string;
  email: string | null;
}

interface Submission {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  authors: Author[];
  _count: { reviewAssignments: number };
}

const statusColors: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  DRAFT: "outline",
  SUBMITTED: "secondary",
  UNDER_REVIEW: "default",
  REVISION_REQUESTED: "secondary",
  ACCEPTED: "default",
  REJECTED: "destructive",
};

export default function SubmissionsPage() {
  const params = useParams();
  const slug = params.slug as string;
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("all");

  useEffect(() => {
    const fetchSubmissions = async () => {
      try {
        const url = activeTab === "all"
          ? `/api/journals/${slug}/submissions`
          : `/api/journals/${slug}/submissions?status=${activeTab}`;
        const response = await fetch(url);
        const data = await response.json();
        if (response.ok) {
          setSubmissions(data.submissions);
        }
      } catch (error) {
        console.error("Failed to fetch submissions:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSubmissions();
  }, [slug, activeTab]);

  if (isLoading) {
    return <div className="flex items-center justify-center h-64">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Submissions</h1>
          <p className="text-gray-500">Manage paper submissions for this journal</p>
        </div>
        <Button asChild>
          <Link href={`/dashboard/journals/${slug}/submissions/new`}>
            <Plus className="h-4 w-4 mr-2" />
            New Submission
          </Link>
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="SUBMITTED">Submitted</TabsTrigger>
          <TabsTrigger value="UNDER_REVIEW">Under Review</TabsTrigger>
          <TabsTrigger value="ACCEPTED">Accepted</TabsTrigger>
          <TabsTrigger value="REJECTED">Rejected</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-4">
          {submissions.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <FileText className="h-12 w-12 text-gray-400 mb-4" />
                <CardTitle className="text-lg mb-2">No submissions</CardTitle>
                <CardDescription className="text-center mb-4">
                  {activeTab === "all"
                    ? "No submissions have been made to this journal yet"
                    : `No submissions with status "${activeTab.replace("_", " ")}"`}
                </CardDescription>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Authors</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Reviewers</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead className="w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {submissions.map((submission) => (
                    <TableRow key={submission.id}>
                      <TableCell className="font-medium max-w-xs truncate">
                        {submission.title}
                      </TableCell>
                      <TableCell>
                        {submission.authors[0]?.name}
                        {submission.authors.length > 1 && ` +${submission.authors.length - 1}`}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusColors[submission.status] || "secondary"}>
                          {submission.status.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>{submission._count.reviewAssignments}</TableCell>
                      <TableCell>
                        {format(new Date(submission.createdAt), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" asChild>
                          <Link href={`/dashboard/journals/${slug}/submissions/${submission.id}`}>
                            <Eye className="h-4 w-4" />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
