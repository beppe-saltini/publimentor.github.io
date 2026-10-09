/**
 * Accepted manuscript file types for the pre-accept format check.
 *
 * Both check routes accept a PDF or a Word (.docx) file. The type is decided
 * from the declared MIME type first and the file extension second, because
 * browsers and storage back-ends frequently report `application/octet-stream`
 * or nothing at all for .docx uploads. When the file bytes are available the
 * magic number is used as a final sanity check so a renamed file is rejected
 * rather than handed to the wrong parser.
 */

import { detectMimeType } from "@/lib/security";

export type AcceptedFileType = "pdf" | "docx";

export const PDF_MIME = "application/pdf";
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** 25 MB upload cap shared by the upload route and the storage-backed route. */
export const MAX_FORMAT_CHECK_BYTES = 25 * 1024 * 1024;

const MIME_TO_TYPE: Record<string, AcceptedFileType> = {
  [PDF_MIME]: "pdf",
  "application/x-pdf": "pdf",
  [DOCX_MIME]: "docx",
};

const EXTENSION_TO_TYPE: Record<string, AcceptedFileType> = {
  pdf: "pdf",
  docx: "docx",
};

export const MIME_FOR_TYPE: Record<AcceptedFileType, string> = {
  pdf: PDF_MIME,
  docx: DOCX_MIME,
};

/** Lower-cased extension without the dot, or "" when the name has none. */
export function fileExtension(fileName: string | null | undefined): string {
  if (!fileName) return "";
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
}

/**
 * Decide whether a file is a PDF or a DOCX from its MIME type or extension.
 * Returns null for anything else (LaTeX, .doc, images, ...).
 */
export function resolveAcceptedFileType(input: {
  mimeType?: string | null;
  fileName?: string | null;
  fileType?: string | null; // Manuscript.fileType when known ("pdf" | "docx" | "tex")
}): AcceptedFileType | null {
  const declared = (input.fileType ?? "").toLowerCase();
  if (declared === "pdf" || declared === "docx") return declared;

  const mime = (input.mimeType ?? "").split(";")[0].trim().toLowerCase();
  if (mime && MIME_TO_TYPE[mime]) return MIME_TO_TYPE[mime];

  const ext = fileExtension(input.fileName);
  if (ext && EXTENSION_TO_TYPE[ext]) return EXTENSION_TO_TYPE[ext];

  return null;
}

/**
 * Magic-number check: true when the bytes are compatible with the resolved
 * type. DOCX is a ZIP container, so we can only verify the ZIP signature.
 * Empty or unrecognised buffers are reported as mismatches.
 */
export function bufferMatchesType(buffer: Buffer, type: AcceptedFileType): boolean {
  if (buffer.length < 4) return false;
  const detected = detectMimeType(buffer);
  return detected === MIME_FOR_TYPE[type];
}

export type FileInputProblem =
  | { code: "missing"; message: string }
  | { code: "unsupported"; message: string }
  | { code: "too_large"; message: string }
  | { code: "corrupt"; message: string };

/**
 * Validate an uploaded multipart File: present, PDF/DOCX, within the size cap,
 * and with bytes that match the declared type. Returns the buffer and type on
 * success so callers never re-read the file.
 */
export async function readUploadedManuscript(
  file: unknown
): Promise<{ ok: true; buffer: Buffer; type: AcceptedFileType; fileName: string } | { ok: false; problem: FileInputProblem }> {
  if (!(file instanceof File)) {
    return { ok: false, problem: { code: "missing", message: "A PDF or Word (.docx) file is required" } };
  }

  const type = resolveAcceptedFileType({ mimeType: file.type, fileName: file.name });
  if (!type) {
    return {
      ok: false,
      problem: { code: "unsupported", message: "Only PDF and Word (.docx) files can be checked" },
    };
  }

  if (file.size > MAX_FORMAT_CHECK_BYTES) {
    return { ok: false, problem: { code: "too_large", message: "File exceeds the 25 MB limit" } };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length > MAX_FORMAT_CHECK_BYTES) {
    return { ok: false, problem: { code: "too_large", message: "File exceeds the 25 MB limit" } };
  }

  if (!bufferMatchesType(buffer, type)) {
    return {
      ok: false,
      problem: { code: "corrupt", message: `The file does not look like a valid ${type.toUpperCase()} document` },
    };
  }

  return { ok: true, buffer, type, fileName: file.name || `manuscript.${type}` };
}

/** HTTP status for a file-input problem: everything is a client error except size (413). */
export function fileProblemStatus(problem: FileInputProblem): number {
  return problem.code === "too_large" ? 413 : 400;
}
