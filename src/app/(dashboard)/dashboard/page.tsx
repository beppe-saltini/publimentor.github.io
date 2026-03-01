import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BookOpen, FileText, Users, Plus, Search, AlertTriangle, Shield, CheckSquare, Upload, Heart, ThumbsUp, Clock } from "lucide-react";
import Link from "next/link";

export default async function DashboardPage() {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    redirect("/login");
  }

  // Default values
  let journalCount = 0;
  let submissionCount = 0;
  let manuscriptCount = 0;
  let userRole: string | null = null;

  type JournalWithCount = Awaited<ReturnType<typeof prisma.journal.findMany<{
    include: { _count: { select: { submissions: true; members: true } } }
  }>>>;
  let recentJournals: JournalWithCount = [];

  // Manuscript data for editors
  interface ManuscriptWithReviewerCounts {
    id: string;
    title: string | null;
    fileName: string;
    status: string;
    workflowStatus: string;
    keywords: string[];
    wordCount: number | null;
    createdAt: Date;
    updatedAt: Date;
    _count: { authors: number; reviewers: number };
    reviewerCounts: { shortlisted: number; suggested: number };
    journal: { id: string; name: string; slug: string } | null;
  }
  let manuscripts: ManuscriptWithReviewerCounts[] = [];

  try {
    const [jCount, sCount, user, publisherMemberships, journals] = await Promise.all([
      prisma.journalMember.count({ where: { userId } }),
      prisma.submission.count({
        where: { journal: { members: { some: { userId } } } },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      }),
      prisma.publisherMember.findMany({
        where: { userId },
        select: { publisherId: true },
      }),
      prisma.journal.findMany({
        where: { members: { some: { userId } } },
        include: { _count: { select: { submissions: true, members: true } } },
        take: 5,
        orderBy: { updatedAt: "desc" },
      }),
    ]);

    journalCount = jCount;
    submissionCount = sCount;
    userRole = user?.role || null;
    recentJournals = journals;

    const publisherIds = publisherMemberships.map(m => m.publisherId);

    const rawManuscripts = await prisma.manuscript.findMany({
      where: {
        deletedAt: null,
        OR: [
          { uploaderId: userId },
          ...(publisherIds.length > 0 ? [{ publisherId: { in: publisherIds } }] : []),
        ],
      },
      include: {
        _count: { select: { authors: true, reviewers: true } },
        journal: { select: { id: true, name: true, slug: true } },
        reviewers: {
          where: { status: { not: "REJECTED" } },
          select: { status: true },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });

    manuscriptCount = rawManuscripts.length;

    manuscripts = rawManuscripts.map(m => ({
      id: m.id,
      title: m.title,
      fileName: m.fileName,
      status: m.status,
      workflowStatus: m.workflowStatus,
      keywords: m.keywords,
      wordCount: m.wordCount,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      _count: { authors: m._count.authors, reviewers: m._count.reviewers },
      journal: m.journal,
      reviewerCounts: {
        shortlisted: m.reviewers.filter(r => r.status === "SHORTLISTED").length,
        suggested: m.reviewers.filter(r => r.status === "SUGGESTED").length,
      },
    }));
  } catch (error) {
    console.error("Dashboard data fetch error:", error);
  }

  // Redirect first-time users to onboarding
  if (journalCount === 0 && submissionCount === 0 && manuscriptCount === 0) {
    try {
      const publisherCount = await prisma.publisherMember.count({
        where: { userId: session?.user?.id },
      });
      if (publisherCount === 0) {
        redirect("/dashboard/onboarding");
      }
    } catch {
      // Continue to dashboard on error
    }
  }

  const firstName = session?.user?.name?.split(" ")[0];
  const isAuthor = userRole === "AUTHOR";
  const isEditor = userRole === "EDITOR" || userRole === "PUBLISHER";

  return (
    <div className="space-y-8">
      {/* Welcome header with role badge */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Welcome back, {firstName}</h1>
          <p className="text-gray-500 mt-1">
            {isAuthor
              ? "Manage your manuscripts and check formatting"
              : "Manage your manuscripts and find reviewers"}
          </p>
        </div>
        {userRole && (
          <Badge variant="outline" className="text-sm px-3 py-1">
            {userRole === "AUTHOR" ? "Author" : userRole === "EDITOR" ? "Editor" : "Publisher"}
          </Badge>
        )}
      </div>

      {/* Stats cards */}
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Manuscripts</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{manuscriptCount}</div>
            <p className="text-xs text-muted-foreground">Uploaded manuscripts</p>
          </CardContent>
        </Card>

        {manuscripts.length > 0 && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Reviewers Found</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {manuscripts.reduce((sum, m) => sum + m.reviewerCounts.shortlisted + m.reviewerCounts.suggested, 0)}
              </div>
              <p className="text-xs text-muted-foreground">Across all manuscripts</p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {isAuthor ? "Favourite Journals" : "My Journals"}
            </CardTitle>
            <BookOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{journalCount}</div>
            <p className="text-xs text-muted-foreground">
              {isAuthor ? "Journals you submit to" : "Journals you\u2019re a member of"}
            </p>
          </CardContent>
        </Card>

        {isAuthor && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">My Manuscripts</CardTitle>
              <Upload className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{manuscriptCount}</div>
              <p className="text-xs text-muted-foreground">Manuscripts you&apos;ve uploaded</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Quick actions */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Quick Actions</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {isAuthor ? (
            <>
              <Button variant="outline" className="h-auto py-4 flex-col items-start text-left" asChild>
                <Link href="/dashboard/manuscripts">
                  <Upload className="h-5 w-5 mb-1 text-blue-600" />
                  <span className="font-medium">Upload Manuscript</span>
                  <span className="text-xs text-gray-500">Upload and check your paper</span>
                </Link>
              </Button>
              <Button variant="outline" className="h-auto py-4 flex-col items-start text-left" asChild>
                <Link href="/dashboard/favourites">
                  <Heart className="h-5 w-5 mb-1 text-red-500" />
                  <span className="font-medium">Favourite Journals</span>
                  <span className="text-xs text-gray-500">Manage your target journals</span>
                </Link>
              </Button>
              <Button variant="outline" className="h-auto py-4 flex-col items-start text-left" asChild>
                <Link href="/dashboard/tools/format">
                  <CheckSquare className="h-5 w-5 mb-1 text-green-600" />
                  <span className="font-medium">Check Formatting</span>
                  <span className="text-xs text-gray-500">Validate against guidelines</span>
                </Link>
              </Button>
              <Button variant="outline" className="h-auto py-4 flex-col items-start text-left" asChild>
                <Link href="/dashboard/tools/integrity">
                  <Shield className="h-5 w-5 mb-1 text-purple-600" />
                  <span className="font-medium">Integrity Check</span>
                  <span className="text-xs text-gray-500">Screen your manuscript</span>
                </Link>
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" className="h-auto py-4 flex-col items-start text-left" asChild>
                <Link href="/dashboard/manuscripts">
                  <Upload className="h-5 w-5 mb-1 text-blue-600" />
                  <span className="font-medium">Upload Manuscript</span>
                  <span className="text-xs text-gray-500">Upload a new manuscript</span>
                </Link>
              </Button>
              <Button variant="outline" className="h-auto py-4 flex-col items-start text-left" asChild>
                <Link href="/dashboard/tools/coi">
                  <AlertTriangle className="h-5 w-5 mb-1 text-amber-600" />
                  <span className="font-medium">COI Screening</span>
                  <span className="text-xs text-gray-500">Check conflicts of interest</span>
                </Link>
              </Button>
              <Button variant="outline" className="h-auto py-4 flex-col items-start text-left" asChild>
                <Link href="/dashboard/tools/integrity">
                  <Shield className="h-5 w-5 mb-1 text-purple-600" />
                  <span className="font-medium">Integrity Check</span>
                  <span className="text-xs text-gray-500">Screen manuscripts</span>
                </Link>
              </Button>
              <Button variant="outline" className="h-auto py-4 flex-col items-start text-left" asChild>
                <Link href="/dashboard/journals/new">
                  <Plus className="h-5 w-5 mb-1 text-gray-600" />
                  <span className="font-medium">Create Journal</span>
                  <span className="text-xs text-gray-500">Set up a new journal</span>
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Manuscripts section - shown for all users with manuscripts */}
      {(manuscripts.length > 0 || manuscriptCount > 0) && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Manuscripts</h2>
          </div>

          {manuscripts.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <FileText className="h-12 w-12 text-gray-400 mb-4" />
                <CardTitle className="text-lg mb-2">No manuscripts yet</CardTitle>
                <CardDescription className="text-center mb-4">
                  Upload your first manuscript to start finding reviewers
                </CardDescription>
                <Button asChild>
                  <Link href="/dashboard/manuscripts">
                    <Upload className="h-4 w-4 mr-2" />
                    Upload Manuscript
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {manuscripts.map((ms) => {
                const totalReviewers = ms.reviewerCounts.shortlisted + ms.reviewerCounts.suggested;
                return (
                  <Link key={ms.id} href={`/dashboard/manuscripts/${ms.id}`}>
                    <Card className="hover:shadow-md transition-shadow cursor-pointer">
                      <CardContent className="py-4">
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3 mb-1.5">
                              <FileText className="h-5 w-5 text-gray-400 flex-shrink-0" />
                              <h3 className="font-medium truncate">
                                {ms.title || ms.fileName}
                              </h3>
                              <Badge
                                variant="outline"
                                className={
                                  ms.workflowStatus === "CLOSED"
                                    ? "bg-purple-50 text-purple-700 border-purple-200"
                                    : ms.workflowStatus === "REVIEWERS_INVITED"
                                    ? "bg-green-50 text-green-700 border-green-200"
                                    : (ms.workflowStatus === "FINDING_REVIEWERS" || ms.reviewerCounts.shortlisted + ms.reviewerCounts.suggested > 0)
                                    ? "bg-blue-50 text-blue-700 border-blue-200"
                                    : "bg-gray-50 text-gray-600 border-gray-200"
                                }
                              >
                                {ms.workflowStatus === "CLOSED"
                                  ? "Closed"
                                  : ms.workflowStatus === "REVIEWERS_INVITED"
                                  ? "Reviewers Invited"
                                  : (ms.workflowStatus === "FINDING_REVIEWERS" || ms.reviewerCounts.shortlisted + ms.reviewerCounts.suggested > 0)
                                  ? "Finding Reviewers"
                                  : "New"}
                              </Badge>
                            </div>
                            <div className="flex flex-wrap gap-4 text-sm text-gray-500 ml-8">
                              <span className="flex items-center gap-1">
                                <Clock className="h-3.5 w-3.5" />
                                {ms.updatedAt.toLocaleDateString()}
                              </span>
                              {ms._count.authors > 0 && (
                                <span>{ms._count.authors} authors</span>
                              )}
                              {ms.wordCount && (
                                <span>{ms.wordCount.toLocaleString()} words</span>
                              )}
                              {ms.journal && (
                                <span className="text-gray-400">{ms.journal.name}</span>
                              )}
                            </div>
                          </div>

                          {/* Reviewer counts */}
                          <div className="flex items-center gap-4 ml-4 flex-shrink-0">
                            {totalReviewers > 0 ? (
                              <div className="text-right">
                                <div className="flex items-center gap-2">
                                  <Users className="h-4 w-4 text-gray-400" />
                                  <span className="text-sm font-medium">{totalReviewers} reviewers</span>
                                </div>
                                {ms.reviewerCounts.shortlisted > 0 && (
                                  <span className="text-xs text-green-600 flex items-center gap-1 justify-end">
                                    <ThumbsUp className="h-3 w-3" />
                                    {ms.reviewerCounts.shortlisted} shortlisted
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-sm text-gray-400">No reviewers yet</span>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* AUTHOR: Recent journals */}
      {isAuthor && (
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
                  Add favourite journals to quickly check formatting and find reviewers
                </CardDescription>
                <div className="flex gap-3">
                  <Button asChild>
                    <Link href="/dashboard/journals/new">
                      <Plus className="h-4 w-4 mr-2" />
                      Create Journal
                    </Link>
                  </Button>
                  <Button variant="outline" asChild>
                    <Link href="/dashboard/favourites">
                      <Heart className="h-4 w-4 mr-2" />
                      Add Favourites
                    </Link>
                  </Button>
                </div>
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
      )}

      {/* EDITOR: also show journals below manuscripts */}
      {isEditor && recentJournals.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold mb-4">My Journals</h2>
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
        </div>
      )}
    </div>
  );
}
