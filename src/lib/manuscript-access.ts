import { prisma } from "@/lib/prisma";

export interface ManuscriptAccessFields {
  id: string;
  uploaderId: string;
  publisherId: string;
  journalId?: string | null;
}

/**
 * Whether a user may work on a manuscript: its uploader, a user with an unexpired
 * explicit permission, a member of its publisher, or an editor/admin of its journal.
 */
export async function canAccessManuscript(userId: string, m: ManuscriptAccessFields): Promise<boolean> {
  if (m.uploaderId === userId) return true;

  const permission = await prisma.manuscriptPermission.findUnique({
    where: { manuscriptId_userId: { manuscriptId: m.id, userId } },
  });
  if (permission && (!permission.expiresAt || permission.expiresAt > new Date())) return true;

  const publisherMember = await prisma.publisherMember.findUnique({
    where: { userId_publisherId: { userId, publisherId: m.publisherId } },
  });
  if (publisherMember) return true;

  if (m.journalId) {
    const journalMember = await prisma.journalMember.findFirst({
      where: { userId, journalId: m.journalId, role: { in: ["ADMIN", "EDITOR"] } },
    });
    if (journalMember) return true;
  }
  return false;
}

/** Loads a live manuscript's access fields and checks them; null when missing or forbidden. */
export async function findAccessibleManuscript(
  userId: string,
  manuscriptId: string
): Promise<(ManuscriptAccessFields & { status: string; workflowStatus: string }) | null> {
  const m = await prisma.manuscript.findFirst({
    where: { id: manuscriptId, deletedAt: null },
    select: { id: true, uploaderId: true, publisherId: true, journalId: true, status: true, workflowStatus: true },
  });
  if (!m) return null;
  return (await canAccessManuscript(userId, m)) ? m : null;
}
