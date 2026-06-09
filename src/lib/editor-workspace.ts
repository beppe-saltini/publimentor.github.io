import { prisma } from "@/lib/prisma";

function slugSuffix(userId: string): string {
  const cleaned = userId.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return (cleaned.slice(-12) || cleaned || "workspace").slice(0, 12);
}

/**
 * Creates a private publisher + journal workspace for a new editor.
 * The simplified editor UI resolves context from these memberships.
 */
export async function provisionEditorWorkspace(
  userId: string,
  displayName?: string | null
): Promise<{ journalId: string; journalSlug: string; publisherId: string }> {
  const suffix = slugSuffix(userId);
  const publisherSlug = `ws-${suffix}`;
  const journalSlug = `jr-${suffix}`;
  const workspaceName = displayName?.trim()
    ? `${displayName.trim()}'s Workspace`
    : "My Workspace";

  return prisma.$transaction(async (tx) => {
    const publisher = await tx.publisher.create({
      data: {
        name: workspaceName,
        slug: publisherSlug,
        members: {
          create: {
            userId,
            role: "OWNER",
          },
        },
      },
    });

    const journal = await tx.journal.create({
      data: {
        name: "My Journal",
        slug: journalSlug,
        publisherId: publisher.id,
        members: {
          create: {
            userId,
            role: "EDITOR",
          },
        },
      },
    });

    await tx.user.update({
      where: { id: userId },
      data: { lastVisitedJournalId: journal.id },
    });

    return {
      journalId: journal.id,
      journalSlug: journal.slug,
      publisherId: publisher.id,
    };
  });
}
