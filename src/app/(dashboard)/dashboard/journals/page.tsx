import { auth } from "@/lib/auth";
import { isSuperuser } from "@/lib/superuser";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Plus } from "lucide-react";
import Link from "next/link";

export default async function JournalsPage() {
  const session = await auth();

  const journals = await prisma.journal.findMany({
    where: {
      members: {
        some: { userId: session?.user?.id },
      },
    },
    include: {
      members: {
        where: { userId: session?.user?.id },
        select: { role: true },
      },
      _count: {
        select: { submissions: true, members: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">My Journals</h1>
          <p className="text-gray-500 mt-1">Manage journals you are a member of</p>
        </div>
        {isSuperuser(session?.user?.email) && (
          <Button asChild>
            <Link href="/dashboard/journals/new">
              <Plus className="h-4 w-4 mr-2" />
              Create Journal
            </Link>
          </Button>
        )}
      </div>

      {journals.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <BookOpen className="h-12 w-12 text-gray-400 mb-4" />
            <CardTitle className="text-lg mb-2">No journals yet</CardTitle>
            <CardDescription className="text-center mb-4">
              Create your first journal or wait to be invited to one
            </CardDescription>
            {isSuperuser(session?.user?.email) && (
              <Button asChild>
                <Link href="/dashboard/journals/new">
                  <Plus className="h-4 w-4 mr-2" />
                  Create Journal
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {journals.map((journal) => (
            <Card key={journal.id} className="hover:shadow-md transition-shadow">
              <Link href={`/dashboard/journals/${journal.slug}`}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-lg">{journal.name}</CardTitle>
                    <Badge variant={journal.members[0]?.role === "ADMIN" ? "default" : "secondary"}>
                      {journal.members[0]?.role}
                    </Badge>
                  </div>
                  <CardDescription className="line-clamp-2">
                    {journal.description || "No description"}
                  </CardDescription>
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
  );
}
