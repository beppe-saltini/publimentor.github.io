/**
 * Key Resources Table (KRT) skeleton prefilled from the manuscript.
 *
 * The KRT is a three-column table (REAGENT or RESOURCE / SOURCE /
 * IDENTIFIER) with fixed row groups. We never invent identifiers: rows are
 * created only for items we can see in the text (accessions, cell lines,
 * mouse strains, Addgene plasmids, antibodies with a catalog number,
 * software with a version) and an unknown identifier is written as "N/A"
 * so the authors can spot and complete it. Every row group is kept, even
 * when empty, because the template forbids custom subheadings.
 */
import type { ManuscriptModel } from "@/lib/format/manuscript-model";
import { KRT_ROW_GROUPS } from "./target-structures/iscience";
import type { LayoutBlock } from "./types";

export interface KrtRow {
  group: string;
  resource: string;
  source: string;
  identifier: string;
}

const CELL_LINES = [
  "4T1", "LLC", "LL/2", "B16F10", "B16-F10", "MC38", "CT26", "EMT6", "E0771", "HEK293T", "HEK293", "HeLa", "A549", "MCF-7", "MCF7", "MDA-MB-231", "U2OS", "HCT116", "RAW264.7", "NIH3T3", "NIH/3T3", "L929", "Jurkat", "THP-1", "K562", "PC-3", "DU145", "HepG2", "Huh7", "SW480", "HT-29", "Panc-1", "PANC-1", "KPC", "ID8", "Hepa1-6", "Pan02", "GL261", "CMT167", "TC-1", "MDA-MB-468", "BT-474", "SK-BR-3", "T47D",
];
const MOUSE_STRAINS = ["C57BL/6J", "C57BL/6N", "C57BL/6", "BALB/c", "BALB/cJ", "NOD/SCID", "NSG", "NOD-scid", "FVB/N", "129S", "nude", "Rag1", "Rag2", "DBA/2", "SCID", "Athymic nude"];
const SOFTWARE: Array<[RegExp, string, string]> = [
  [/GraphPad Prism(?:\s*(?:v(?:ersion)?\.?\s*)?(\d+(?:\.\d+)*))?/i, "GraphPad Prism", "GraphPad Software"],
  [/\bFlowJo(?:\s*(?:v(?:ersion)?\.?\s*)?(\d+(?:\.\d+)*))?/i, "FlowJo", "BD Biosciences"],
  [/\bImageJ(?:\s*(?:v(?:ersion)?\.?\s*)?(\d+(?:\.\d+)*))?/i, "ImageJ", "NIH"],
  [/\bFiji(?:\s*(?:v(?:ersion)?\.?\s*)?(\d+(?:\.\d+)*))?/i, "Fiji", "Schindelin et al."],
  [/\bSeurat(?:\s*(?:v(?:ersion)?\.?\s*)?(\d+(?:\.\d+)*))?/i, "Seurat", "Satija lab"],
  [/\bCell ?Ranger(?:\s*(?:v(?:ersion)?\.?\s*)?(\d+(?:\.\d+)*))?/i, "Cell Ranger", "10x Genomics"],
  [/\bScanpy(?:\s*(?:v(?:ersion)?\.?\s*)?(\d+(?:\.\d+)*))?/i, "Scanpy", "Wolf et al."],
  [/\bDESeq2(?:\s*(?:v(?:ersion)?\.?\s*)?(\d+(?:\.\d+)*))?/i, "DESeq2", "Love et al."],
  [/\bedgeR(?:\s*(?:v(?:ersion)?\.?\s*)?(\d+(?:\.\d+)*))?/i, "edgeR", "Robinson et al."],
  [/\bGSEA(?:\s*(?:v(?:ersion)?\.?\s*)?(\d+(?:\.\d+)*))?/i, "GSEA", "Broad Institute"],
  [/\bMaxQuant(?:\s*(?:v(?:ersion)?\.?\s*)?(\d+(?:\.\d+)*))?/i, "MaxQuant", "Max Planck Institute"],
  [/\bSTAR aligner(?:\s*(?:v(?:ersion)?\.?\s*)?(\d+(?:\.\d+)*))?/i, "STAR", "Dobin et al."],
  [/\bHISAT2?(?:\s*(?:v(?:ersion)?\.?\s*)?(\d+(?:\.\d+)*))?/i, "HISAT2", "Kim et al."],
  [/\bBowtie2?(?:\s*(?:v(?:ersion)?\.?\s*)?(\d+(?:\.\d+)*))?/i, "Bowtie2", "Langmead and Salzberg"],
  [/\bZEN(?: software)?(?:\s*(?:v(?:ersion)?\.?\s*)?(\d+(?:\.\d+)*))?/, "ZEN", "Carl Zeiss"],
  [/\bImaris(?:\s*(?:v(?:ersion)?\.?\s*)?(\d+(?:\.\d+)*))?/i, "Imaris", "Oxford Instruments"],
  [/\bSPSS(?:\s*(?:v(?:ersion)?\.?\s*)?(\d+(?:\.\d+)*))?/i, "SPSS", "IBM"],
  [/\bKaplan[-–]Meier Plotter/i, "Kaplan-Meier Plotter", "Győrffy lab"],
  [/\bR\s*(?:v(?:ersion)?\.?\s*)?(\d\.\d+(?:\.\d+)?)/, "R", "R Core Team"],
  [/\bPython\s*(?:v(?:ersion)?\.?\s*)?(\d\.\d+(?:\.\d+)?)?/i, "Python", "Python Software Foundation"],
];

function uniq<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((it) => {
    const k = key(it).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const VENDOR_RE = /^(BioLegend|BD|BD Biosciences|eBioscience|Thermo|Invitrogen|Abcam|CST|Cell Signaling|Santa Cruz|Sigma|Merck|Proteintech|R&D|Miltenyi|Bio-Rad|Jackson|Tonbo|Novus|GeneTex|Abclonal|ABclonal|Huabio|Beyotime)/i;

/** First comma/semicolon-separated token that names a known vendor. */
function findVendor(inside: string): string | undefined {
  return inside
    .split(/[,;]/)
    .map((part) => part.trim())
    .find((part) => VENDOR_RE.test(part));
}

/** Antibodies written as "anti-CD8 (clone 53-6.7, BioLegend, Cat# 100708)" or "anti-X antibody (Cat# ..., Company)". */
export function extractAntibodies(text: string): KrtRow[] {
  const rows: KrtRow[] = [];
  const re = /\b(anti[- ][A-Za-z0-9α-ωΑ-Ω/\-]+(?:\s+antibod(?:y|ies))?)\s*\(([^)]{3,160})\)/g;
  for (const m of text.matchAll(re)) {
    const inside = m[2];
    const cat = inside.match(/(?:Cat(?:alog)?\.?\s*(?:#|no\.?|number)?\s*[:]?\s*|#)\s*([A-Za-z0-9\-]{3,})/i)?.[1];
    const clone = inside.match(/clone\s*([A-Za-z0-9.\-]+)/i)?.[1];
    const rrid = inside.match(/RRID:\s*(AB_\d+)/i)?.[1];
    const vendor = findVendor(inside);
    if (!cat && !rrid && !vendor) continue;
    rows.push({
      group: "Antibodies",
      resource: `${m[1].replace(/\s+antibod(?:y|ies)$/i, "")} antibody${clone ? ` (clone ${clone})` : ""}`,
      source: vendor || "N/A",
      identifier: [cat ? `Cat# ${cat}` : "", rrid ? `RRID: ${rrid}` : ""].filter(Boolean).join("; ") || "N/A",
    });
  }
  return uniq(rows, (r) => r.resource + r.identifier);
}

/** Addgene plasmids "pLKO.1 (Addgene #8453)" / "Addgene plasmid # 12260". */
export function extractPlasmids(text: string): KrtRow[] {
  const rows: KrtRow[] = [];
  for (const m of text.matchAll(/\b(p[A-Z][A-Za-z0-9.\-_]+(?:[-–][A-Za-z0-9]+)*)\s*\((?:[^)]*?)Addgene\s*(?:plasmid\s*)?#?\s*(\d{3,6})/g)) {
    rows.push({ group: "Recombinant DNA", resource: m[1], source: "Addgene", identifier: `Addgene #${m[2]}` });
  }
  for (const m of text.matchAll(/Addgene\s*(?:plasmid\s*)?#?\s*(\d{3,6})/g)) {
    if (!rows.some((r) => r.identifier.endsWith(m[1]))) rows.push({ group: "Recombinant DNA", resource: "[Plasmid name]", source: "Addgene", identifier: `Addgene #${m[1]}` });
  }
  return uniq(rows, (r) => r.identifier);
}

export function extractCellLines(text: string): KrtRow[] {
  const rows: KrtRow[] = [];
  for (const name of CELL_LINES) {
    const re = new RegExp(`(?<![A-Za-z0-9])${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(?![A-Za-z0-9])`);
    if (!re.test(text)) continue;
    const src = text.match(new RegExp(`${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}[^.]{0,120}?(ATCC|American Type Culture Collection|Cell Bank|Cell Resource Center|National Collection|DSMZ|ECACC|RIKEN|Kerafast|gift from [^,.;]+)`, "i"))?.[1];
    const cat = text.match(new RegExp(`${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}[^.]{0,120}?(?:ATCC|Cat#?)\\s*([A-Z]{2,4}-\\d+|\\d{3,})`, "i"))?.[1];
    rows.push({ group: "Experimental models: Cell lines", resource: name, source: src || "N/A", identifier: cat ? `${/^\d/.test(cat) ? "Cat# " : "ATCC "}${cat}` : "N/A" });
  }
  return uniq(rows, (r) => r.resource.replace(/[-/]/g, ""));
}

export function extractMouseStrains(text: string): KrtRow[] {
  const rows: KrtRow[] = [];
  for (const strain of MOUSE_STRAINS) {
    const re = new RegExp(`(?<![A-Za-z0-9])${strain.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(?![A-Za-z0-9])`);
    if (!re.test(text)) continue;
    const src = text.match(new RegExp(`${strain.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}[^.]{0,120}?(Jackson Laborator(?:y|ies)|JAX|Charles River|Vital River|GemPharmatech|Cyagen|Taconic|Envigo|Janvier|SLAC|SPF \\(Beijing\\)|Beijing Vital River)`, "i"))?.[1];
    rows.push({ group: "Experimental models: Organisms/strains", resource: `Mouse: ${strain}`, source: src || "N/A", identifier: "N/A" });
  }
  return uniq(rows, (r) => r.resource.replace(/J$|N$/, ""));
}

export function extractSoftware(text: string): KrtRow[] {
  const rows: KrtRow[] = [];
  for (const [re, name, source] of SOFTWARE) {
    const m = text.match(re);
    if (!m) continue;
    const version = m[1];
    rows.push({ group: "Software and algorithms", resource: version ? `${name} v${version}` : name, source, identifier: "N/A" });
  }
  return uniq(rows, (r) => r.resource.split(" v")[0]);
}

/** Every detected row for the manuscript. */
export function prefillKrtRows(model: ManuscriptModel, methodsText?: string): KrtRow[] {
  const text = methodsText && methodsText.length > 200 ? methodsText : model.text;
  const rows: KrtRow[] = [];
  for (const a of model.accessions) {
    rows.push({ group: "Deposited data", resource: `[Data type] data`, source: "This paper", identifier: `${a.repository ? `${a.repository}: ` : ""}${a.id}` });
  }
  rows.push(...extractAntibodies(text), ...extractCellLines(text), ...extractMouseStrains(text), ...extractPlasmids(text), ...extractSoftware(text));
  return uniq(rows, (r) => `${r.group}|${r.resource}|${r.identifier}`);
}

/** Layout table with every standard group, filled rows, and an empty hint row for empty groups. */
export function buildKrtTable(rows: KrtRow[], headings: string[], groups: string[] = KRT_ROW_GROUPS): LayoutBlock {
  const out: Array<{ group?: string; cells?: string[] }> = [];
  for (const group of groups) {
    out.push({ group });
    const inGroup = rows.filter((r) => r.group === group);
    if (inGroup.length === 0) out.push({ cells: ["[None / add items]", "", ""] });
    for (const r of inGroup) out.push({ cells: [r.resource, r.source, r.identifier] });
  }
  return { type: "table", headings, rows: out };
}
