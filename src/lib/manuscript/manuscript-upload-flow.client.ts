import { computeFileHash } from "./file-hash.client";

export const MAX_MANUSCRIPT_UPLOAD_BYTES = 50 * 1024 * 1024;

export type DuplicateReason = "same_content" | "same_filename_size";

export interface DuplicateManuscriptMatch {
  id: string;
  title: string | null;
  fileName: string;
  fileSize: number;
  status: string;
  createdAt: string;
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  reason?: DuplicateReason;
  matches: DuplicateManuscriptMatch[];
}

export async function checkManuscriptDuplicate(params: {
  publisherId: string;
  fileHash: string;
  fileName: string;
  fileSize: number;
}): Promise<DuplicateCheckResult> {
  const res = await fetch("/api/manuscripts/upload/check-duplicate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Failed to check for duplicate uploads");
  }
  return data as DuplicateCheckResult;
}

export type UploadProgressCallback = (percent: number) => void;

/**
 * Two-step Supabase upload + process trigger.
 */
export async function uploadManuscriptFile(options: {
  file: File;
  publisherId: string;
  journalId?: string;
  fileHash: string;
  confirmDuplicate?: boolean;
  onProgress?: UploadProgressCallback;
}): Promise<{ manuscriptId: string }> {
  const { file, publisherId, journalId, fileHash, confirmDuplicate, onProgress } = options;

  onProgress?.(5);

  const initRes = await fetch("/api/manuscripts/upload/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publisherId,
      journalId: journalId || undefined,
      fileName: file.name,
      fileSize: file.size,
      fileHash,
      confirmDuplicate: confirmDuplicate || undefined,
    }),
  });

  const initText = await initRes.text();
  let initData: Record<string, unknown>;
  try {
    initData = JSON.parse(initText);
  } catch {
    throw new Error(`Server error (HTTP ${initRes.status}). The server may be misconfigured.`);
  }

  if (initRes.status === 409) {
    const err = new Error(
      (initData.error as string) || "This file appears to be a duplicate upload"
    ) as Error & { code?: string; duplicate?: DuplicateCheckResult };
    err.code = "DUPLICATE";
    if (initData.reason) {
      err.duplicate = {
        isDuplicate: true,
        reason: initData.reason as DuplicateReason,
        matches: (initData.matches as DuplicateManuscriptMatch[]) || [],
      };
    }
    throw err;
  }

  if (!initRes.ok) {
    throw new Error((initData.error as string) || "Failed to initialize upload");
  }

  const { manuscriptId, signedUrl } = initData as {
    manuscriptId: string;
    signedUrl: string;
  };

  onProgress?.(10);

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl, true);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress?.(Math.round(10 + (e.loaded / e.total) * 70));
      }
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (HTTP ${xhr.status})`));
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(file);
  });

  onProgress?.(85);

  const processRes = await fetch(`/api/manuscripts/${manuscriptId}/process`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  const processText = await processRes.text();
  let processData: Record<string, unknown>;
  try {
    processData = JSON.parse(processText);
  } catch {
    throw new Error(`Server error during processing (HTTP ${processRes.status})`);
  }

  if (!processRes.ok) {
    throw new Error((processData.error as string) || "Failed to start processing");
  }

  onProgress?.(90);
  return { manuscriptId };
}

export { computeFileHash };
