import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BookOpen, FileText, Users, Plus, Search, AlertTriangle, Shield, CheckSquare, Upload, Heart } from "lucide-react";
import Link from "next/link";

export default async function DashboardPage() {
  const session = await auth();

  // ── Smart redirect: send the user straight to their journal ──
  const userId = session?.user?.id;
  if (userId) {
    let targetSlug: string | null = null;
    try {
      const [memberships, user] = await Promise.all([
        prisma.journalMember.findMany({
          where: { userId },
          select: { journal: { select: { id: true, slug: true } }, createdAt: true },
          orderBy: { createdAt: "desc" },
        }),
        prisma.user.findUnique({
          where: { id: userId },
          select: { lastVisitedJournalId: true },
        }),
      ]);

      if (memberships.length === 1) {
        targetSlug = memberships[0].journal.slug;
      } else if (memberships.length > 1) {
        // Try last-visited journal first
        if (user?.lastVisitedJournalId) {
          const match = memberships.find(
            (m) => m.journal.id === user.lastVisitedJournalId
          );
          if (match) {
            targetSlug = match.journal.slug;
          }
        }
        // Fallback: most recently joined journal (already sorted desc)
        if (!targetSlug) {
          targetSlug = memberships[0].journal.slug;
        }
      }
      // 0 memberships → fall through to existing onboarding logic below
    } catch (e) {
      console.error("Smart redirect error:", e);
    }

    // redirect() throws a special Next.js error, so call it outside try-catch
    if (targetSlug) {
      redirect(`/dashboard/journals/${targetSlug}`);
    }
  }

  // Default values in case of errors
  let journalCount = 0;
  let submissionCount = 0;
  let pendingReviews = 0;
  let manuscriptCount = 0;
  let userRole: string | null = null;
  type JournalWithCount = Awaited<ReturnType<typeof prisma.journal.findMany<{
    include: { _count: { select: { submissions: true; members: true } } }
  }>>>;
  let recentJournals: JournalWithCount = [];

  try {
    const userId = session?.user?.id;
    
    if (userId) {
      const [jCount, sCount, rCount, mCount, user] = await Promise.all([
        prisma.journalMember.count({
          where: { userId },
        }),
        prisma.submission.count({
          where: {
            journal: {
              members: {
                some: { userId },
              },
            },
          },
        }),
        prisma.reviewAssignment.count({
          where: {
            reviewerId: userId,
            status: "PENDING",
          },
        }),
        prisma.manuscript.count({
          where: { uploaderId: userId },
        }),
        prisma.user.findUnique({
          where: { id: userId },
          select: { role: true },
        }),
      ]);

      journalCount = jCount;
      submissionCount = sCount;
      pendingReviews = rCount;
      manuscriptCount = mCount;
      userRole = user?.role || null;

      recentJournals = await prisma.journal.findMany({
        where: {
          members: {
            some: { userId },
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
    }
  } catch (error) {
    console.error("Dashboard data fetch error:", error);
  }

  // Redirect first-time users to onboarding
  if (journalCount === 0 && submissionCount === 0 && pendingReviews === 0 && manuscriptCount === 0) {
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
  const isEditor = userRole === "EDITOR";
  const isPublisher = userRole === "PUBLISHER";

  return (
    <div className="space-y-8">
      {/* Welcome header with role badge */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Welcome back, {firstName}</h1>
          <p className="text-gray-500 mt-1">
            {isAuthor
              ? "Manage your manuscripts and check formatting"
              : isPublisher
              ? "Overview of your publishing operations"
              : "Here\u2019s an overview of your editorial activities"}
          </p>
        </div>
        {userRole && (
          <Badge variant="outline" className="text-sm px-3 py-1">
            {userRole === "AUTHOR" ? "Author" : userRole === "EDITOR" ? "Editor" : "Publisher"}
          </Badge>
        )}
      </div>

      {/* Stats cards — role-adapted */}
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-4">
        {/* Everyone sees journals */}
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

        {/* Authors see manuscripts; editors/publishers see submissions */}
        {isAuthor ? (
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
        ) : (
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
        )}

        {/* Reviews — for editors */}
        {!isAuthor && (
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
        )}
      </div>

      {/* Quick actions — role-adapted */}
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
                <Link href="/dashboard/tools/reviewers">
                  <Search className="h-5 w-5 mb-1 text-blue-600" />
                  <span className="font-medium">Find Reviewers</span>
                  <span className="text-xs text-gray-500">Discover expert reviewers</span>
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

      {/* Recent journals */}
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
                {isAuthor
                  ? "Add favourite journals to quickly check formatting and find reviewers"
                  : "Create your first journal to start managing submissions and reviews"}
              </CardDescription>
              <div className="flex gap-3">
                <Button asChild>
                  <Link href="/dashboard/journals/new">
                    <Plus className="h-4 w-4 mr-2" />
                    Create Journal
                  </Link>
                </Button>
                {isAuthor && (
                  <Button variant="outline" asChild>
                    <Link href="/dashboard/favourites">
                      <Heart className="h-4 w-4 mr-2" />
                      Add Favourites
                    </Link>
                  </Button>
                )}
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
    </div>
  );
}
