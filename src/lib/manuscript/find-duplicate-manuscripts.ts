import { prisma } from "@/lib/prisma";
import { sanitizeFileName } from "@/lib/security";

export type DuplicateReason = "same_content" | "same_filename_size";

export interface DuplicateManuscriptMatch {
  id: string;
  title: string | null;
  fileName: string;
  fileSize: number;
  status: string;
  createdAt: Date;
}

export interface FindDuplicateResult {
  isDuplicate: boolean;
  reason?: DuplicateReason;
  matches: DuplicateManuscriptMatch[];
}

const matchSelect = {
  id: true,
  title: true,
  fileName: true,
  fileSize: true,
  status: true,
  createdAt: true,
} as const;

/**
 * Find manuscripts that likely duplicate an incoming upload for the same user.
 */
export async function findDuplicateManuscripts(params: {
  publisherId: string;
  uploaderId: string;
  fileHash?: string;
  fileName?: string;
  fileSize?: number;
}): Promise<FindDuplicateResult> {
  const { publisherId, uploaderId, fileHash, fileName, fileSize } = params;
  const seenIds = new Set<string>();

  if (fileHash) {
    const byHash = await prisma.manuscript.findMany({
      where: {
        publisherId,
        uploaderId,
        fileHash,
      },
      select: matchSelect,
      orderBy: { createdAt: "desc" },
      take: 5,
    });

    if (byHash.length > 0) {
      for (const m of byHash) seenIds.add(m.id);
      return {
        isDuplicate: true,
        reason: "same_content",
        matches: byHash,
      };
    }
  }

  if (fileName && fileSize != null && fileSize > 0) {
    const sanitized = sanitizeFileName(fileName);
    const byMeta = await prisma.manuscript.findMany({
      where: {
        publisherId,
        uploaderId,
        fileName: sanitized,
        fileSize,
      },
      select: matchSelect,
      orderBy: { createdAt: "desc" },
      take: 5,
    });

    const novel = byMeta.filter((m) => !seenIds.has(m.id));
    if (novel.length > 0) {
      return {
        isDuplicate: true,
        reason: "same_filename_size",
        matches: novel,
      };
    }
  }

  return { isDuplicate: false, matches: [] };
}
