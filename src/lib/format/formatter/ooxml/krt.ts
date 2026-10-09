/**
 * Key Resources Table skeleton (Cell Press STAR Methods) as a tracked
 * insertion: a w:tbl with a bold header row from the target's krtTemplate
 * and one row per row group, each with highlighted placeholder cells that
 * the authors fill in.
 */
import type { TargetStructure } from "../types";
import { createRun, markBlockInserted, type RevisionContext } from "./tracked";
import { createW, type XmlDocument, type XmlElement } from "./xml";

const TABLE_WIDTH_DXA = 9360; // 6.5" between US Letter margins

export interface KrtOptions {
  highlight: string;
  placeholder: string;
}

/** Build the table (already marked as inserted) or null when the target has no template. */
export function buildKrtTable(
  doc: XmlDocument,
  rev: RevisionContext,
  target: TargetStructure,
  options: KrtOptions
): XmlElement | null {
  const template = target.krtTemplate;
  if (!template || template.headings.length === 0) return null;
  const columns = template.headings.length;
  const colWidth = Math.floor(TABLE_WIDTH_DXA / columns);

  const tbl = createW(doc, "tbl");
  const tblPr = createW(doc, "tblPr");
  tblPr.appendChild(createW(doc, "tblStyle", { val: "TableGrid" }));
  tblPr.appendChild(createW(doc, "tblW", { w: String(TABLE_WIDTH_DXA), type: "dxa" }));
  const borders = createW(doc, "tblBorders");
  for (const side of ["top", "left", "bottom", "right", "insideH", "insideV"]) {
    borders.appendChild(createW(doc, side, { val: "single", sz: "4", space: "0", color: "auto" }));
  }
  tblPr.appendChild(borders);
  tbl.appendChild(tblPr);

  const grid = createW(doc, "tblGrid");
  for (let i = 0; i < columns; i++) grid.appendChild(createW(doc, "gridCol", { w: String(colWidth) }));
  tbl.appendChild(grid);

  tbl.appendChild(row(doc, template.headings.map((h) => ({ text: h, bold: true })), colWidth));
  for (const group of template.rowGroups ?? []) {
    const cells = [{ text: group, bold: true }];
    for (let i = 1; i < columns; i++) cells.push({ text: options.placeholder, bold: false });
    tbl.appendChild(row(doc, cells, colWidth, options.highlight));
  }
  markBlockInserted(tbl, rev);
  return tbl;
}

function row(doc: XmlDocument, cells: Array<{ text: string; bold: boolean }>, width: number, highlight?: string): XmlElement {
  const tr = createW(doc, "tr");
  for (const cell of cells) {
    const tc = createW(doc, "tc");
    const tcPr = createW(doc, "tcPr");
    tcPr.appendChild(createW(doc, "tcW", { w: String(width), type: "dxa" }));
    tc.appendChild(tcPr);
    const p = createW(doc, "p");
    p.appendChild(createRun(doc, { text: cell.text, bold: cell.bold, highlight: cell.bold ? undefined : highlight }));
    tc.appendChild(p);
    tr.appendChild(tc);
  }
  return tr;
}
