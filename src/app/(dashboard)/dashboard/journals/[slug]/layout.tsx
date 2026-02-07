import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";

export default async function JournalLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const session = await auth();
  const { slug } = await params;

  if (!session) {
    redirect("/login");
  }

  const journal = await prisma.journal.findUnique({
    where: { slug },
    include: {
      members: {
        where: { userId: session.user.id },
      },
    },
  });

  if (!journal) {
    notFound();
  }

  if (journal.members.length === 0) {
    redirect("/dashboard");
  }

  return (
    <DashboardShell journalSlug={slug}>
      <div className="border-b bg-white -mx-4 sm:-mx-6 -mt-4 sm:-mt-6 px-4 sm:px-6 py-3 mb-6">
        <h2 className="text-lg font-semibold text-gray-900">{journal.name}</h2>
      </div>
      {children}
    </DashboardShell>
  );
}
