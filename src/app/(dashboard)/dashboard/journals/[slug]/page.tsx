import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Clock, Download, Eye } from "lucide-react";
import Link from "next/link";

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
      publisher: {
        select: { id: true },
      },
    },
  });

  if (!journal) {
    notFound();
  }

  // Get manuscript counts for stats
  const [totalManuscripts, processingManuscripts] = await Promise.all([
    prisma.manuscript.count({
      where: { publisherId: journal.publisher?.id },
    }),
    prisma.manuscript.count({
      where: {
        publisherId: journal.publisher?.id,
        status: { in: ["UPLOADED", "EXTRACTING", "EXTRACTED", "PROCESSING", "EMBEDDING"] },
      },
    }),
  ]);

  // Get recent manuscripts for this publisher
  const recentManuscripts = await prisma.manuscript.findMany({
    where: { publisherId: journal.publisher?.id },
    include: {
      authors: {
        orderBy: { authorOrder: "asc" },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Overview</h1>
        <p className="text-gray-500">{journal.description || "No description"}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Manuscripts</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalManuscripts}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Processing</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{processingManuscripts}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Manuscripts</CardTitle>
          <CardDescription>Latest manuscripts uploaded to your organisation</CardDescription>
        </CardHeader>
        <CardContent>
          {recentManuscripts.length === 0 ? (
            <p className="text-sm text-gray-500">No manuscripts uploaded yet</p>
          ) : (
            <div className="space-y-4">
              {recentManuscripts.map((manuscript) => (
                <div
                  key={manuscript.id}
                  className="flex items-center justify-between border-b pb-4 last:border-0"
                >
                  <div className="min-w-0 flex-1 mr-4">
                    <p className="font-medium truncate">
                      {manuscript.title || manuscript.fileName}
                    </p>
                    <p className="text-sm text-gray-500">
                      {manuscript.authors[0]?.fullName || "Processing..."}
                      {manuscript.wordCount
                        ? ` · ${manuscript.wordCount.toLocaleString()} words`
                        : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge
                      variant={
                        manuscript.status === "READY"
                          ? "default"
                          : manuscript.status === "ERROR"
                          ? "destructive"
                          : "secondary"
                      }
                    >
                      {manuscript.status}
                    </Badge>
                    <Button variant="ghost" size="icon" asChild title="View details">
                      <Link href={`/dashboard/manuscripts/${manuscript.id}`}>
                        <Eye className="h-4 w-4" />
                      </Link>
                    </Button>
                    <Button variant="ghost" size="icon" asChild title="Download PDF">
                      <a
                        href={`/api/manuscripts/${manuscript.id}/download`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Download className="h-4 w-4" />
                      </a>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
