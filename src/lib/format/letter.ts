/**
 * Letter assembly for the pre-accept checks.
 *
 * The editor's spreadsheet builds the "please fix" letter by concatenating the
 * phrases of the flagged rows under a fixed preamble. buildLetter reproduces
 * that: every check whose final status is "fail" contributes its phrase, in
 * profile order, each already prefixed with "* ". "review" items are left to
 * the editor (they appear in the checklist, not in the letter).
 *
 * letterToDocx writes a minimal valid .docx with jszip (no docx library is
 * installed): one paragraph per line, Calibri 11pt.
 */

import JSZip from "jszip";
import type { CheckOverrides, CheckResult, FormatCheckReport, JournalProfile } from "./profile";

export type Letter = FormatCheckReport["letter"];

/** Text used when nothing failed, so the letter never ends after the preamble. */
export const NO_ITEMS_LINE = "No formatting changes are required.";

export function buildLetter(profile: JournalProfile, results: CheckResult[], overrides?: CheckOverrides): Letter {
  const byId = new Map(results.map((r) => [r.checkId, r]));
  const items: Letter["items"] = [];
  const seenPhrases = new Set<string>();
  for (const check of profile.checks) {
    const result = byId.get(check.id);
    if (!result) continue;
    const status = overrides?.[check.id]?.status ?? result.status;
    if (status !== "fail") continue;
    const text = (result.letterPhrase ?? check.phrase).trim();
    if (!text) continue;
    // Several checks may share one spreadsheet phrase (e.g. the Summary row);
    // the author should read it once.
    if (seenPhrases.has(text)) continue;
    seenPhrases.add(text);
    items.push({ checkId: check.id, text });
  }
  const body = items.length ? items.map((i) => i.text).join("\n") : NO_ITEMS_LINE;
  return { preamble: profile.letterPreamble, items, text: `${profile.letterPreamble}\n\n${body}` };
}

// ---------------------------------------------------------------------------
// DOCX output
// ---------------------------------------------------------------------------

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // Control characters are not allowed in XML 1.0.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

function paragraph(text: string, opts: { bold?: boolean } = {}): string {
  const rPr = `<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>${opts.bold ? "<w:b/>" : ""}<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>`;
  if (!text) return "<w:p/>";
  return `<w:p><w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

/** The lines of the letter document, in order (exported for tests). */
export function letterLines(letter: Letter, meta: { manuscriptTitle?: string; journalName: string }): Array<{ text: string; bold?: boolean }> {
  const lines: Array<{ text: string; bold?: boolean }> = [{ text: `${meta.journalName} - pre-acceptance formatting checks`, bold: true }];
  if (meta.manuscriptTitle) lines.push({ text: meta.manuscriptTitle });
  lines.push({ text: "" });
  // The letter text may have been edited by hand, so emit it line by line
  // rather than regenerating it from the items.
  for (const line of letter.text.split(/\r?\n/)) lines.push({ text: line });
  return lines;
}

export async function letterToDocx(letter: Letter, meta: { manuscriptTitle?: string; journalName: string }): Promise<Buffer> {
  const body = letterLines(letter, meta).map((l) => paragraph(l.text, { bold: l.bold })).join("");
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body>
</w:document>`;
  const zip = new JSZip();
  // createFolders: false keeps the package to the three parts Word needs (no directory entries).
  zip.file("[Content_Types].xml", CONTENT_TYPES, { createFolders: false });
  zip.file("_rels/.rels", RELS, { createFolders: false });
  zip.file("word/document.xml", document, { createFolders: false });
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
