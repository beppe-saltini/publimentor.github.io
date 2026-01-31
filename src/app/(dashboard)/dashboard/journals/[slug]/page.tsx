import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, Users, Clock, CheckCircle } from "lucide-react";

export default async function JournalOverviewPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const session = await auth();
  const { slug } = await params;

  const journal = await prisma.journal.findUnique({
    where: { slug },
    include: {
      members: {
        where: { userId: session?.user?.id },
        select: { role: true },
      },
      _count: {
        select: { submissions: true, members: true },
      },
    },
  });

  if (!journal) {
    notFound();
  }

  // Get submission statistics
  const submissionStats = await prisma.submission.groupBy({
    by: ["status"],
    where: { journalId: journal.id },
    _count: true,
  });

  const statusCounts = submissionStats.reduce(
    (acc, stat) => {
      acc[stat.status] = stat._count;
      return acc;
    },
    {} as Record<string, number>
  );

  const recentSubmissions = await prisma.submission.findMany({
    where: { journalId: journal.id },
    include: {
      authors: {
        where: { order: 0 },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Overview</h1>
        <p className="text-gray-500">{journal.description || "No description"}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Submissions</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{journal._count.submissions}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Under Review</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{statusCounts["UNDER_REVIEW"] || 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Accepted</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{statusCounts["ACCEPTED"] || 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Team Members</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{journal._count.members}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Submissions</CardTitle>
          <CardDescription>Latest papers submitted to the journal</CardDescription>
        </CardHeader>
        <CardContent>
          {recentSubmissions.length === 0 ? (
            <p className="text-sm text-gray-500">No submissions yet</p>
          ) : (
            <div className="space-y-4">
              {recentSubmissions.map((submission) => (
                <div
                  key={submission.id}
                  className="flex items-center justify-between border-b pb-4 last:border-0"
                >
                  <div>
                    <p className="font-medium">{submission.title}</p>
                    <p className="text-sm text-gray-500">
                      {submission.authors[0]?.name || "Unknown author"}
                    </p>
                  </div>
                  <Badge
                    variant={
                      submission.status === "ACCEPTED"
                        ? "default"
                        : submission.status === "REJECTED"
                        ? "destructive"
                        : "secondary"
                    }
                  >
                    {submission.status.replace("_", " ")}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
