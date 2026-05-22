"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import type {
  DuplicateCheckResult,
  DuplicateManuscriptMatch,
} from "@/lib/manuscript/manuscript-upload-flow.client";

interface DuplicateUploadDialogProps {
  open: boolean;
  fileName: string;
  check: DuplicateCheckResult | null;
  onConfirm: () => void;
  onCancel: () => void;
  confirming?: boolean;
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function MatchRow({ match }: { match: DuplicateManuscriptMatch }) {
  return (
    <li className="text-sm border rounded-md px-3 py-2 bg-muted/40">
      <p className="font-medium truncate">
        {match.title?.trim() || match.fileName}
      </p>
      <p className="text-muted-foreground text-xs mt-0.5">
        {match.fileName} · {formatDate(match.createdAt)} · {match.status}
      </p>
    </li>
  );
}

export function DuplicateUploadDialog({
  open,
  fileName,
  check,
  onConfirm,
  onCancel,
  confirming = false,
}: DuplicateUploadDialogProps) {
  const reason = check?.reason;
  const description =
    reason === "same_content"
      ? "This file matches a manuscript you already uploaded (same file content)."
      : reason === "same_filename_size"
        ? "A manuscript with the same file name and size is already in your library."
        : "This upload may duplicate an existing manuscript.";

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen && !confirming) onCancel();
      }}
    >
      <DialogContent showCloseButton={!confirming} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
            Possible duplicate upload
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-3 text-left text-sm text-muted-foreground">
              <p>{description}</p>
              <p>
                File: <span className="font-medium text-foreground">{fileName}</span>
              </p>
              {check && check.matches.length > 0 && (
                <ul className="space-y-2 max-h-40 overflow-y-auto">
                  {check.matches.map((m) => (
                    <MatchRow key={m.id} match={m} />
                  ))}
                </ul>
              )}
              <p>Upload anyway, or cancel to keep your existing copy.</p>
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={confirming}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={confirming}>
            {confirming ? "Uploading…" : "Upload anyway"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
