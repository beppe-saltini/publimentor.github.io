import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BookOpen, FileText, Users, Plus } from "lucide-react";
import Link from "next/link";

export default async function DashboardPage() {
  const session = await auth();
  
  const [journalCount, submissionCount, pendingReviews] = await Promise.all([
    prisma.journalMember.count({
      where: { userId: session?.user?.id },
    }),
    prisma.submission.count({
      where: {
        journal: {
          members: {
            some: { userId: session?.user?.id },
          },
        },
      },
    }),
    prisma.reviewAssignment.count({
      where: {
        reviewerId: session?.user?.id,
        status: "PENDING",
      },
    }),
  ]);

  const recentJournals = await prisma.journal.findMany({
    where: {
      members: {
        some: { userId: session?.user?.id },
      },
    },
    include: {
      _count: {
        select: { submissions: true, members: true },
      },
    },
    take: 5,
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Welcome back, {session?.user?.name?.split(" ")[0]}</h1>
        <p className="text-gray-500 mt-1">Here&apos;s an overview of your editorial activities</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">My Journals</CardTitle>
            <BookOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{journalCount}</div>
            <p className="text-xs text-muted-foreground">Journals you&apos;re a member of</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Submissions</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{submissionCount}</div>
            <p className="text-xs text-muted-foreground">Across all your journals</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Reviews</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingReviews}</div>
            <p className="text-xs text-muted-foreground">Awaiting your review</p>
          </CardContent>
        </Card>
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Recent Journals</h2>
          <Button asChild>
            <Link href="/dashboard/journals/new">
              <Plus className="h-4 w-4 mr-2" />
              Create Journal
            </Link>
          </Button>
        </div>

        {recentJournals.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <BookOpen className="h-12 w-12 text-gray-400 mb-4" />
              <CardTitle className="text-lg mb-2">No journals yet</CardTitle>
              <CardDescription className="text-center mb-4">
                Create your first journal to start managing submissions and reviews
              </CardDescription>
              <Button asChild>
                <Link href="/dashboard/journals/new">
                  <Plus className="h-4 w-4 mr-2" />
                  Create Journal
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {recentJournals.map((journal) => (
              <Card key={journal.id} className="hover:shadow-md transition-shadow">
                <Link href={`/dashboard/journals/${journal.slug}`}>
                  <CardHeader>
                    <CardTitle className="text-lg">{journal.name}</CardTitle>
                    <CardDescription>{journal.description || "No description"}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex gap-4 text-sm text-gray-500">
                      <span>{journal._count.submissions} submissions</span>
                      <span>{journal._count.members} members</span>
                    </div>
                  </CardContent>
                </Link>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
