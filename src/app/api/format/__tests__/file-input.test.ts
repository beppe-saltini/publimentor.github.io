import { describe, expect, it } from "vitest";
import {
  MAX_FORMAT_CHECK_BYTES,
  bufferMatchesType,
  fileExtension,
  fileProblemStatus,
  readUploadedManuscript,
  resolveAcceptedFileType,
} from "../_lib/file-input";
import { DOCX_BYTES, PDF_BYTES, makeFile } from "./fixtures";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe("fileExtension", () => {
  it("returns the lower-cased extension without the dot", () => {
    expect(fileExtension("Paper.Final.PDF")).toBe("pdf");
    expect(fileExtension("dir/sub/file.docx")).toBe("docx");
  });
  it("returns an empty string when there is none", () => {
    expect(fileExtension("README")).toBe("");
    expect(fileExtension(undefined)).toBe("");
  });
});

describe("resolveAcceptedFileType", () => {
  it("prefers the manuscript's declared fileType", () => {
    expect(resolveAcceptedFileType({ fileType: "docx", mimeType: "application/pdf" })).toBe("docx");
  });
  it("uses the MIME type when declared", () => {
    expect(resolveAcceptedFileType({ mimeType: "application/pdf" })).toBe("pdf");
    expect(resolveAcceptedFileType({ mimeType: `${DOCX_MIME}; charset=binary` })).toBe("docx");
  });
  it("falls back to the extension for octet-stream uploads", () => {
    expect(resolveAcceptedFileType({ mimeType: "application/octet-stream", fileName: "final.DOCX" })).toBe("docx");
    expect(resolveAcceptedFileType({ mimeType: "", fileName: "final.pdf" })).toBe("pdf");
  });
  it("rejects everything else", () => {
    expect(resolveAcceptedFileType({ fileType: "tex", fileName: "main.tex" })).toBeNull();
    expect(resolveAcceptedFileType({ mimeType: "application/msword", fileName: "old.doc" })).toBeNull();
    expect(resolveAcceptedFileType({})).toBeNull();
  });
});

describe("bufferMatchesType", () => {
  it("accepts matching magic numbers", () => {
    expect(bufferMatchesType(PDF_BYTES, "pdf")).toBe(true);
    expect(bufferMatchesType(DOCX_BYTES, "docx")).toBe(true);
  });
  it("rejects renamed or empty files", () => {
    expect(bufferMatchesType(PDF_BYTES, "docx")).toBe(false);
    expect(bufferMatchesType(Buffer.from("hello"), "pdf")).toBe(false);
    expect(bufferMatchesType(Buffer.alloc(0), "pdf")).toBe(false);
  });
});

describe("readUploadedManuscript", () => {
  it("returns buffer, type and name for a valid PDF", async () => {
    const result = await readUploadedManuscript(makeFile("paper.pdf", PDF_BYTES, "application/pdf"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.type).toBe("pdf");
    expect(result.fileName).toBe("paper.pdf");
    expect(result.buffer.equals(PDF_BYTES)).toBe(true);
  });

  it("accepts a DOCX by extension when the browser sends no MIME type", async () => {
    const result = await readUploadedManuscript(makeFile("paper.docx", DOCX_BYTES));
    expect(result.ok && result.type).toBe("docx");
  });

  it("reports a missing file", async () => {
    const result = await readUploadedManuscript(null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.code).toBe("missing");
    expect(fileProblemStatus(result.problem)).toBe(400);
  });

  it("rejects unsupported types with 400", async () => {
    const result = await readUploadedManuscript(makeFile("notes.txt", Buffer.from("hi"), "text/plain"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.code).toBe("unsupported");
    expect(fileProblemStatus(result.problem)).toBe(400);
  });

  it("rejects files above the 25 MB cap with 413", async () => {
    const big = makeFile("huge.pdf", new Uint8Array(MAX_FORMAT_CHECK_BYTES + 1), "application/pdf");
    const result = await readUploadedManuscript(big);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.code).toBe("too_large");
    expect(fileProblemStatus(result.problem)).toBe(413);
  });

  it("rejects a file whose bytes do not match its declared type", async () => {
    const result = await readUploadedManuscript(makeFile("fake.pdf", Buffer.from("just text"), "application/pdf"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.code).toBe("corrupt");
  });
});
