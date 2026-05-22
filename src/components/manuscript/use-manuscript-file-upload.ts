"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  checkManuscriptDuplicate,
  computeFileHash,
  MAX_MANUSCRIPT_UPLOAD_BYTES,
  uploadManuscriptFile,
  type DuplicateCheckResult,
} from "@/lib/manuscript/manuscript-upload-flow.client";

export interface UseManuscriptFileUploadOptions {
  publisherId: string | null | undefined;
  journalId?: string;
  onUploadComplete?: (manuscriptId: string) => void;
  onProgress?: (percent: number) => void;
}

export function useManuscriptFileUpload({
  publisherId,
  journalId,
  onUploadComplete,
  onProgress,
}: UseManuscriptFileUploadOptions) {
  const [uploading, setUploading] = useState(false);
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);
  const [duplicatePrompt, setDuplicatePrompt] = useState<{
    file: File;
    fileHash: string;
    check: DuplicateCheckResult;
  } | null>(null);

  const runUpload = useCallback(
    async (file: File, fileHash: string, confirmDuplicate: boolean) => {
      if (!publisherId) {
        toast.error("Upload not available — organization not loaded.");
        return;
      }

      setUploading(true);
      onProgress?.(0);

      try {
        const { manuscriptId } = await uploadManuscriptFile({
          file,
          publisherId,
          journalId,
          fileHash,
          confirmDuplicate,
          onProgress,
        });
        onUploadComplete?.(manuscriptId);
        return manuscriptId;
      } finally {
        setUploading(false);
      }
    },
    [publisherId, journalId, onUploadComplete, onProgress]
  );

  const startUpload = useCallback(
    async (file: File): Promise<string | undefined> => {
      if (!publisherId) {
        toast.error("Upload not available — organization not loaded.");
        return;
      }

      if (file.size > MAX_MANUSCRIPT_UPLOAD_BYTES) {
        const msg = `File is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maximum is 50 MB.`;
        toast.error(msg);
        throw new Error(msg);
      }

      setCheckingDuplicate(true);
      try {
        const fileHash = await computeFileHash(file);
        const check = await checkManuscriptDuplicate({
          publisherId,
          fileHash,
          fileName: file.name,
          fileSize: file.size,
        });

        if (check.isDuplicate) {
          setDuplicatePrompt({ file, fileHash, check });
          return;
        }

        return await runUpload(file, fileHash, false);
      } finally {
        setCheckingDuplicate(false);
      }
    },
    [publisherId, runUpload]
  );

  const confirmDuplicateUpload = useCallback(async () => {
    if (!duplicatePrompt) return;
    const { file, fileHash } = duplicatePrompt;
    setDuplicatePrompt(null);
    await runUpload(file, fileHash, true);
  }, [duplicatePrompt, runUpload]);

  const cancelDuplicateUpload = useCallback(() => {
    setDuplicatePrompt(null);
  }, []);

  const busy = uploading || checkingDuplicate;

  return {
    startUpload,
    confirmDuplicateUpload,
    cancelDuplicateUpload,
    duplicatePrompt,
    uploading,
    checkingDuplicate,
    busy,
  };
}
