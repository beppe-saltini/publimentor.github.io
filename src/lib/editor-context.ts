import { prisma } from "@/lib/prisma";

export interface EditorContext {
  hasJournal: boolean;
  journalId: string | null;
  journalSlug: string | null;
  publisherId: string | null;
}

/**
 * Resolves the editor's implicit journal context without exposing journal name in UI.
 * Single-journal assumption: last visited, sole membership, or most recently updated.
 */
export async function getEditorContext(userId: string): Promise<EditorContext> {
  const empty: EditorContext = {
    hasJournal: false,
    journalId: null,
    journalSlug: null,
    publisherId: null,
  };

  const [user, memberships] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { lastVisitedJournalId: true },
    }),
    prisma.journalMember.findMany({
      where: { userId },
      include: {
        journal: {
          select: {
            id: true,
            slug: true,
            publisherId: true,
            updatedAt: true,
          },
        },
      },
      orderBy: { journal: { updatedAt: "desc" } },
    }),
  ]);

  if (memberships.length === 0) {
    return empty;
  }

  let journal = memberships[0].journal;

  if (user?.lastVisitedJournalId) {
    const lastVisited = memberships.find(
      (m) => m.journal.id === user.lastVisitedJournalId
    );
    if (lastVisited) {
      journal = lastVisited.journal;
    }
  } else if (memberships.length === 1) {
    journal = memberships[0].journal;
  }

  let publisherId = journal.publisherId;

  if (!publisherId) {
    const publisherMember = await prisma.publisherMember.findFirst({
      where: { userId },
      select: { publisherId: true },
    });
    publisherId = publisherMember?.publisherId ?? null;
  }

  return {
    hasJournal: true,
    journalId: journal.id,
    journalSlug: journal.slug,
    publisherId,
  };
}

/**
 * Verifies the user is a member of the given journal.
 */
export async function assertJournalMember(
  userId: string,
  journalId: string
): Promise<boolean> {
  const member = await prisma.journalMember.findFirst({
    where: { userId, journalId },
  });
  return !!member;
}
