import { prisma } from "@/lib/prisma";
import { coiDetector } from "@/lib/coi-detector";

export type AuthorRole = "first" | "last" | "middle_early" | "middle_late";

export interface ResolvedAuthor {
  name: string;
  orcid: string | null;
  openAlexId: string | null;
  role: AuthorRole;
}

export function authorRole(index: number, total: number): AuthorRole {
  if (index === 0) return "first";
  if (index === total - 1) return "last";
  return index <= 2 ? "middle_early" : "middle_late";
}

/**
 * The manuscript's authors with their OpenAlex ids. An author is resolved (ORCID first,
 * then name matching) the first time it is needed and the id is stored, so later
 * reviewer searches and conflict checks reuse it instead of searching OpenAlex again.
 */
export async function getResolvedManuscriptAuthors(manuscriptId: string): Promise<ResolvedAuthor[]> {
  const rows = await prisma.manuscriptAuthor.findMany({
    where: { manuscriptId },
    orderBy: { authorOrder: "asc" },
    select: { id: true, fullName: true, orcid: true, openAlexId: true },
  });
  const result: ResolvedAuthor[] = [];
  for (const [index, row] of rows.entries()) {
    let openAlexId = row.openAlexId;
    if (!openAlexId) {
      try {
        openAlexId = await coiDetector.resolveAuthorId({ name: row.fullName, orcid: row.orcid });
        if (openAlexId) {
          await prisma.manuscriptAuthor.update({ where: { id: row.id }, data: { openAlexId } });
        }
      } catch (err) {
        console.error(`[Authors] Could not resolve ${row.fullName}:`, err);
      }
    }
    result.push({ name: row.fullName, orcid: row.orcid, openAlexId, role: authorRole(index, rows.length) });
  }
  return result;
}
