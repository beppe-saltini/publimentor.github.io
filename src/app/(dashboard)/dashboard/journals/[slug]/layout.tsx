import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Header } from "@/components/dashboard/header";

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
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar journalSlug={slug} />
      <div className="flex-1 flex flex-col">
        <Header />
        <div className="border-b bg-white px-6 py-3">
          <h2 className="text-lg font-semibold text-gray-900">{journal.name}</h2>
        </div>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
