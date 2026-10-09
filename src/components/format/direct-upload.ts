/**
 * Sending an uploaded file to POST /api/format/check.
 *
 * Vercel functions reject bodies over 4.5 MB, so a manuscript cannot travel to
 * the API as multipart in production. Mirroring the manuscript library's
 * upload flow, the file goes straight to storage instead:
 *
 *   POST /api/format/upload-init  { fileName, mimeType, size }  -> { uploadPath, signedUrl, headers }
 *   PUT  signedUrl                (XHR, so upload progress is observable)
 *   POST /api/format/check        { sourcePath: uploadPath, fileName, ... }  as JSON
 *
 * When upload-init answers 400 the server has no direct-upload storage (local
 * development) and the file is posted as multipart, exactly as before.
 */

import { readJsonResponse } from "./report-utils";

export interface DirectUploadTarget {
  uploadPath: string;
  signedUrl: string;
  token?: string;
  /** Headers the storage expects on the PUT (content type, no-overwrite flag). */
  headers?: Record<string, string>;
}

export interface FileCheckRequest {
  file: File;
  journalSlug?: string | null;
  manuscriptId?: string | null;
  profileId?: string | null;
  format: boolean;
}

export interface FileCheckHooks {
  /** Upload progress of the direct PUT, 0-100. Not called on the multipart path. */
  onUploadProgress?: (percent: number) => void;
  /** Called right before POST /api/format/check goes out (either path). */
  onCheckStart?: () => void;
}

/**
 * Ask for a signed upload URL. Resolves null when the server answers 400,
 * meaning direct uploads are unavailable and multipart must be used.
 */
export async function initDirectUpload(file: File): Promise<DirectUploadTarget | null> {
  const response = await fetch("/api/format/upload-init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name, mimeType: file.type || undefined, size: file.size }),
  });
  if (response.status === 400) return null;
  const data = await readJsonResponse<Partial<DirectUploadTarget>>(response, "Could not start the upload");
  if (typeof data.uploadPath !== "string" || typeof data.signedUrl !== "string") {
    throw new Error("The server returned no upload URL.");
  }
  return {
    uploadPath: data.uploadPath,
    signedUrl: data.signedUrl,
    ...(typeof data.token === "string" ? { token: data.token } : {}),
    ...(data.headers && typeof data.headers === "object" ? { headers: data.headers } : {}),
  };
}

/** PUT the file to the signed URL with XHR so progress events are available. */
export function putFileToSignedUrl(
  file: File,
  target: DirectUploadTarget,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", target.signedUrl, true);
    const headers: Record<string, string> = {
      ...(target.headers ?? {}),
      // The browser's type wins when it has one; the server's canonical type fills in otherwise.
      "Content-Type": file.type || target.headers?.["Content-Type"] || "application/octet-stream",
      "x-upsert": "false",
    };
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress?.(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      }
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (HTTP ${xhr.status})`));
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.send(file);
  });
}

/** The multipart request (small files, or servers without direct-upload storage). */
export function postMultipartCheck(request: FileCheckRequest): Promise<Response> {
  const body = new FormData();
  body.append("file", request.file, request.file.name);
  if (request.journalSlug) body.append("journalSlug", request.journalSlug);
  if (request.manuscriptId) body.append("manuscriptId", request.manuscriptId);
  if (request.profileId) body.append("profileId", request.profileId);
  body.append("format", request.format ? "true" : "false");
  return fetch("/api/format/check", { method: "POST", body });
}

/**
 * Send an uploaded file for a check: direct upload + JSON when the server
 * supports it, multipart otherwise. Resolves with the check response.
 */
export async function postFileCheck(request: FileCheckRequest, hooks: FileCheckHooks = {}): Promise<Response> {
  const target = await initDirectUpload(request.file);
  if (!target) {
    hooks.onCheckStart?.();
    return postMultipartCheck(request);
  }

  await putFileToSignedUrl(request.file, target, hooks.onUploadProgress);

  hooks.onCheckStart?.();
  return fetch("/api/format/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sourcePath: target.uploadPath,
      fileName: request.file.name,
      journalSlug: request.journalSlug || undefined,
      manuscriptId: request.manuscriptId ?? undefined,
      profileId: request.profileId ?? undefined,
      format: request.format,
    }),
  });
}
