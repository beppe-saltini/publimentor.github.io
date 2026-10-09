/**
 * Render a FormatPlan as a brand-new Word document ("rebuilt" kind).
 *
 * Built with docx-js. Conventions follow the docx skill: Calibri 11, A4
 * default, headings via HeadingLevel, lists through a numbering config
 * (never literal bullets), tables with DXA widths on the table and every
 * cell, no "\n" inside runs (one Paragraph per line). Placeholders are
 * yellow-highlighted runs prefixed with the target's placeholder prefix;
 * bracketed tokens inside otherwise-normal text are highlighted too so the
 * authors can find what is left to fill in. The last page is the change log.
 */
import type { ManuscriptModel } from "@/lib/format/manuscript-model";
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IParagraphOptions,
} from "docx";
import { buildChangeLog } from "./change-log";
import { buildLayout } from "./layout";
import { normalizeHeading } from "./plan-utils";
import type { FormatLayout, FormatPlan, FormattedDocument, LayoutBlock, LayoutSlot, TargetStructure } from "./types";

const FONT = "Calibri";
const SIZE = 22; // half-points => 11 pt
const BULLETS = "fmt-bullets";
const REFS = "fmt-references";
const TABLE_WIDTH = 9360; // 6.5" in DXA
const KRT_COLS = [3600, 2600, 3160];

/** Split text into runs, highlighting "[...]" tokens in yellow. */
export function tokenRuns(text: string, opts: { bold?: boolean; italics?: boolean; highlightAll?: boolean } = {}): TextRun[] {
  const base = { font: FONT, size: SIZE, bold: opts.bold, italics: opts.italics };
  if (opts.highlightAll) return [new TextRun({ ...base, text, highlight: "yellow" })];
  const runs: TextRun[] = [];
  const re = /\[[^\]\n]{1,120}\]/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) runs.push(new TextRun({ ...base, text: text.slice(last, m.index) }));
    runs.push(new TextRun({ ...base, text: m[0], highlight: "yellow" }));
    last = m.index! + m[0].length;
  }
  if (last < text.length) runs.push(new TextRun({ ...base, text: text.slice(last) }));
  return runs.length > 0 ? runs : [new TextRun({ ...base, text })];
}

function para(text: string, extra: Partial<IParagraphOptions> = {}, runOpts: Parameters<typeof tokenRuns>[1] = {}): Paragraph {
  return new Paragraph({ children: tokenRuns(text, runOpts), spacing: { after: 120 }, ...extra });
}

function heading(text: string, level: 1 | 2 | 3): Paragraph {
  const map = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3 } as const;
  return new Paragraph({ heading: map[level], children: [new TextRun({ text, font: FONT })], spacing: { before: level === 1 ? 360 : 240, after: 120 } });
}

function placeholder(text: string, prefix: string): Paragraph {
  const clean = text.replace(/^•\s*/, "");
  const isBullet = /^•/.test(text);
  return new Paragraph({
    children: [new TextRun({ text: prefix, font: FONT, size: SIZE, bold: true, highlight: "yellow" }), new TextRun({ text: clean, font: FONT, size: SIZE, highlight: "yellow" })],
    spacing: { after: 120 },
    ...(isBullet ? { numbering: { reference: BULLETS, level: 0 } } : {}),
  });
}

function cell(text: string, width: number, opts: { bold?: boolean; shade?: boolean } = {}): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: opts.shade ? { type: ShadingType.CLEAR, fill: "D9D9D9", color: "auto" } : undefined,
    children: [new Paragraph({ children: tokenRuns(text, { bold: opts.bold }), spacing: { after: 0 } })],
  });
}

function krtTable(block: Extract<LayoutBlock, { type: "table" }>): Table {
  const widths = block.headings.length === 3 ? KRT_COLS : block.headings.map(() => Math.floor(TABLE_WIDTH / block.headings.length));
  const rows: TableRow[] = [new TableRow({ tableHeader: true, children: block.headings.map((h, i) => cell(h, widths[i], { bold: true, shade: true })) })];
  for (const r of block.rows) {
    if (r.group) {
      // Group subheading: bold first cell, others empty (no merged cells — Cell Press forbids them).
      rows.push(new TableRow({ children: widths.map((w, i) => cell(i === 0 ? r.group! : "", w, { bold: true, shade: true })) }));
    } else {
      rows.push(new TableRow({ children: widths.map((w, i) => cell(r.cells?.[i] ?? "", w)) }));
    }
  }
  return new Table({ width: { size: TABLE_WIDTH, type: WidthType.DXA }, columnWidths: widths, rows });
}

function referenceParagraphs(plan: FormatPlan): Paragraph[] {
  const refs = [...plan.references].sort((a, b) => a.index - b.index);
  if (refs.length === 0) return [para("[References]", {}, { highlightAll: true })];
  return refs.map(
    (r) =>
      new Paragraph({
        numbering: { reference: REFS, level: 0 },
        spacing: { after: 80 },
        children: r.matched ? tokenRuns(r.formatted) : [...tokenRuns(r.formatted), new TextRun({ text: " [not verified on Crossref — please check]", font: FONT, size: SIZE, highlight: "yellow" })],
      })
  );
}

function blockToParagraphs(block: LayoutBlock, plan: FormatPlan, target: TargetStructure, baseLevel: 1 | 2): Array<Paragraph | Table> {
  switch (block.type) {
    case "heading":
      return [heading(block.text, Math.min(3, Math.max(block.level, baseLevel + 1)) as 2 | 3)];
    case "placeholder":
      return [placeholder(block.text, target.placeholderStyle.prefix)];
    case "table":
      return [krtTable(block), para("")];
    case "references":
      return referenceParagraphs(plan);
    case "paragraph":
      if (block.style === "bullet") return [new Paragraph({ children: tokenRuns(block.text.replace(/^•\s*/, "")), numbering: { reference: BULLETS, level: 0 }, spacing: { after: 80 } })];
      if (block.style === "legend_title") return [para(block.text, { spacing: { before: 200, after: 60 } }, { bold: true })];
      if (block.style === "italic_note") return [para(block.text, {}, { italics: true })];
      return [para(block.text)];
  }
}

function slotToChildren(slot: LayoutSlot, plan: FormatPlan, target: TargetStructure): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [heading(slot.heading, slot.level)];
  for (const b of slot.blocks) {
    // A source subheading that is the slot heading itself ("Quantification and
    // statistical analysis" under "Quantification and Statistical Analysis")
    // would print twice; the layout drops these, this is the safety net.
    if (b.type === "heading" && normalizeHeading(b.text) === normalizeHeading(slot.heading)) continue;
    out.push(...blockToParagraphs(b, plan, target, slot.level));
  }
  for (const child of slot.children) out.push(...slotToChildren(child, plan, target));
  return out;
}

function titlePage(tp: FormatLayout["titlePage"], target: TargetStructure, journalName: string): Paragraph[] {
  const out: Paragraph[] = [];
  out.push(new Paragraph({ children: [new TextRun({ text: tp.title || "[Title]", font: FONT, size: 32, bold: true, highlight: tp.title ? undefined : "yellow" })], alignment: AlignmentType.LEFT, spacing: { after: 240 } }));
  if (tp.authorsLine) out.push(para(tp.authorsLine));
  for (const aff of tp.affiliations) out.push(para(aff, { spacing: { after: 40 } }));
  // Cell Press title pages list the Lead Contact footnote right after the
  // affiliations, then the correspondence line.
  if (tp.leadContactLine) out.push(para(tp.leadContactLine, { spacing: { after: 40 } }));
  if (tp.correspondingEmails.length > 0) out.push(para(`*Correspondence: ${tp.correspondingEmails.join(", ")}`, { spacing: { before: 120 } }));
  for (const p of tp.placeholders) out.push(placeholder(p, target.placeholderStyle.prefix));
  out.push(para(`Formatted for ${journalName} by PubliMentor. Yellow text marks what the authors still need to supply; a change log is on the last page.`, { spacing: { before: 240 } }, { italics: true }));
  out.push(new Paragraph({ children: [new PageBreak()] }));
  return out;
}

function changeLogPage(plan: FormatPlan): Paragraph[] {
  const out: Paragraph[] = [new Paragraph({ children: [new PageBreak()] }), heading("Formatting change log", 1)];
  for (const line of buildChangeLog(plan).split("\n")) {
    if (!line.trim()) continue;
    if (line.startsWith("# ")) continue; // already have the heading
    if (line.startsWith("## ")) out.push(heading(line.slice(3), 2));
    else if (line.startsWith("### ")) out.push(heading(line.slice(4), 3));
    else if (line.startsWith("- ")) out.push(new Paragraph({ children: tokenRuns(line.slice(2)), numbering: { reference: BULLETS, level: 0 }, spacing: { after: 40 } }));
    else out.push(para(line.trim(), { indent: { left: 720 }, spacing: { after: 40 } }, { italics: true }));
  }
  return out;
}

/** Original base name without extension, sanitized for a file name. */
export function outputFileName(model: ManuscriptModel, profileId: string): string {
  const base = (model.fileName || "manuscript").replace(/\.[^.]+$/, "").replace(/[^\w\-]+/g, "-").replace(/^-+|-+$/g, "") || "manuscript";
  return `${base}-${profileId}-formatted.docx`;
}

export async function renderFormattedDocx(model: ManuscriptModel, plan: FormatPlan, target: TargetStructure, meta: { journalName: string }): Promise<FormattedDocument> {
  const layout = plan.layout || buildLayout(model, target).layout;
  const children: Array<Paragraph | Table> = [...titlePage(layout.titlePage, target, meta.journalName)];
  for (const slot of layout.slots) children.push(...slotToChildren(slot, plan, target));
  children.push(...changeLogPage(plan));

  const doc = new Document({
    creator: "PubliMentor Journal-Ready Formatter",
    title: layout.titlePage.title || "Formatted manuscript",
    description: `Formatted for ${meta.journalName}`,
    styles: {
      default: { document: { run: { font: FONT, size: SIZE } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 28, bold: true, font: FONT, color: "000000" }, paragraph: { spacing: { before: 360, after: 120 }, outlineLevel: 0 } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 24, bold: true, font: FONT, color: "000000" }, paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 } },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 22, bold: true, italics: true, font: FONT, color: "000000" }, paragraph: { spacing: { before: 200, after: 80 }, outlineLevel: 2 } },
      ],
    },
    numbering: {
      config: [
        { reference: BULLETS, levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
        { reference: REFS, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      ],
    },
    sections: [
      {
        properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
        children,
      },
    ],
  });
  const buffer = await Packer.toBuffer(doc);
  return {
    kind: "rebuilt",
    buffer: Buffer.from(buffer),
    fileName: outputFileName(model, target.profileId),
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
}

/** Exported for tests: a horizontal rule paragraph (bottom border), not a table. */
export function ruleParagraph(): Paragraph {
  return new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 1 } }, spacing: { after: 120 } });
}
