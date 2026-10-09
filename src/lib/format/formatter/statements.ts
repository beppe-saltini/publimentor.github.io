/**
 * Resource Availability and the other mandatory statements.
 *
 * Cell Press wants "Resource Availability" with exactly three subheadings
 * (Lead Contact, Materials Availability, Data and Code Availability). Most
 * manuscripts arrive with Nature-style "Data availability" / "Code
 * availability" paragraphs instead, so this module merges them and prefills
 * the standard three-bullet wording from detected accessions and code
 * statements. Anything it cannot know is left as a bracketed token.
 */
import type { ManuscriptModel, Statement } from "@/lib/format/manuscript-model";
import { DATA_CODE_BULLETS, LEAD_CONTACT_TEMPLATE, MATERIALS_AVAILABILITY_TEMPLATE } from "./target-structures/iscience";
import type { LayoutBlock } from "./types";

export interface PrefilledStatement {
  blocks: LayoutBlock[];
  /** True when at least one bracketed token remains for the authors. */
  needsAuthor: boolean;
  /** Human-readable note of what was prefilled (for the change log). */
  note: string;
  /** True when the text was taken from the manuscript rather than a template. */
  fromSource: boolean;
}

/** Group accession ids by repository: "CNCB (CRA047096, CRA049882)". */
export function describeAccessions(accessions: ManuscriptModel["accessions"]): string {
  const byRepo = new Map<string, string[]>();
  for (const a of accessions) {
    const repo = a.repository || "[repository]";
    const list = byRepo.get(repo) || [];
    if (!list.includes(a.id)) list.push(a.id);
    byRepo.set(repo, list);
  }
  return Array.from(byRepo.entries())
    .map(([repo, ids]) => `${repo} (${ids.join(", ")})`)
    .join("; ");
}

/** Infer the data types a statement talks about ("Single-cell RNA-seq and proteomics"). */
export function inferDataTypes(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const found: string[] = [];
  const probes: Array<[RegExp, string]> = [
    [/single[- ]cell RNA[- ]?seq(?:uencing)?|scRNA[- ]?seq/i, "Single-cell RNA-seq"],
    [/bulk RNA[- ]?seq(?:uencing)?/i, "bulk RNA-seq"],
    [/\bRNA[- ]?seq(?:uencing)?\b(?![^.]*single)/i, "RNA-seq"],
    [/proteomic|mass spectrometry/i, "proteomics"],
    [/microarray/i, "microarray"],
    [/ChIP[- ]?seq/i, "ChIP-seq"],
    [/ATAC[- ]?seq/i, "ATAC-seq"],
    [/whole[- ](?:genome|exome) sequencing|WGS|WES/i, "sequencing"],
    [/imaging|microscopy/i, "imaging"],
    [/flow cytometry/i, "flow cytometry"],
    [/structure|crystallograph|cryo-?EM/i, "structural"],
  ];
  for (const [re, label] of probes) {
    if (re.test(text) && !found.some((f) => f.toLowerCase().includes(label.toLowerCase()) || label.toLowerCase().includes(f.toLowerCase()))) found.push(label);
  }
  if (found.length === 0) return undefined;
  if (found.length === 1) return found[0];
  return `${found.slice(0, -1).join(", ")} and ${found[found.length - 1]}`;
}

/** Detect whether a code statement says "no original code" vs. a repository. */
export function classifyCodeStatement(text: string | undefined): { kind: "none" | "deposited" | "unknown"; url?: string } {
  if (!text) return { kind: "unknown" };
  const url = text.match(/https?:\/\/\S+|github\.com\/\S+|zenodo\.org\/\S+/i)?.[0]?.replace(/[.,;)]+$/, "");
  if (url) return { kind: "deposited", url };
  if (/(did not|does not|do not|no)\s+(generate|report|produce|contain|include)[^.]*\b(original|custom|new)?\s*(code|software|algorithm)/i.test(text) || /no (custom|original|new) code/i.test(text)) {
    return { kind: "none" };
  }
  return { kind: "unknown" };
}

/** Find the name of the author who takes correspondence, when stated in prose. */
export function inferLeadContactName(model: ManuscriptModel): string | undefined {
  const m =
    model.text.match(/(?:correspondence|requests for materials)[^.]{0,80}?addressed to\s+(?:Dr\.?\s+|Prof\.?\s+)?([A-Z][\p{L}'’\-]+(?:\s+[A-Z]\.?)*(?:\s+[A-Z][\p{L}'’\-]+){1,2})/iu) ||
    model.text.match(/lead contact,?\s+([A-Z][\p{L}'’\-]+(?:\s+[A-Z][\p{L}'’\-]+){1,2})/u);
  return m?.[1]?.trim();
}

/**
 * The author marked for correspondence in the author list ("Jane Doe1*, John
 * Roe2" -> "Jane Doe"). Only an unambiguous single starred author counts; two
 * co-corresponding authors leave the choice to the authors (undefined).
 */
export function leadContactFromAuthorsLine(authorsLine: string | undefined): string | undefined {
  if (!authorsLine) return undefined;
  const re = /((?:[A-Z][\p{L}'’\-]+|[A-Z]\.)(?:\s+(?:[A-Z][\p{L}'’\-]+|[A-Z]\.))+)\s*\d*(?:\s*,\s*\d+)*\s*[*†‡]/gu;
  const names = Array.from(authorsLine.matchAll(re), (m) => m[1].trim());
  const unique = Array.from(new Set(names));
  return unique.length === 1 ? unique[0] : undefined;
}

/**
 * Footnote number for the Lead Contact marker: one more than the highest
 * affiliation number used on the title page (falls back to the affiliation
 * count so the marker never collides with an existing one).
 */
export function nextFootnoteNumber(model: Pick<ManuscriptModel, "authorsLine" | "affiliations">): number {
  // Author lines carry only affiliation numbers ("Jane Doe1,2*"), so every
  // one- or two-digit token is a marker already in use.
  const numbers = [
    ...Array.from((model.authorsLine ?? "").matchAll(/\d{1,2}/g), (m) => Number(m[0])),
    ...model.affiliations.map((a) => Number((a.match(/^\s*(\d{1,2})\b/) || [])[1] || 0)),
  ].filter((n) => n > 0);
  return Math.max(model.affiliations.length, ...numbers, 0) + 1;
}

/**
 * Mark the lead contact in the author list with a footnote marker: "Li Roe1*"
 * -> "Li Roe1,5*" (marker appended to the author's affiliation numbers). The
 * name is matched with flexible whitespace; undefined when it is not in the
 * author line (initials-only lists), so the caller falls back to a placeholder.
 */
export function markLeadContact(authorsLine: string, name: string, marker: string): string | undefined {
  const pattern = name
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  const m = new RegExp(`${pattern}(?![\\p{L}])`, "u").exec(authorsLine);
  if (!m) return undefined;
  const end = m.index + m[0].length;
  // Existing affiliation markers right after the name: "1", "1,2", " 1 ,3".
  const tail = authorsLine.slice(end).match(/^\s*\d+(?:\s*,\s*\d+)*/);
  if (tail) {
    const cut = end + tail[0].length;
    return `${authorsLine.slice(0, cut)},${marker}${authorsLine.slice(cut)}`;
  }
  return `${authorsLine.slice(0, end)}${marker}${authorsLine.slice(end)}`;
}

/** Lead Contact statement with name/e-mail filled when they can be inferred. */
export function buildLeadContact(model: ManuscriptModel): PrefilledStatement {
  const existing = model.statements.leadContact?.text?.trim();
  if (existing && /@/.test(existing)) {
    return { blocks: [{ type: "paragraph", text: existing }], needsAuthor: false, note: "Kept the existing Lead Contact statement.", fromSource: true };
  }
  const email = model.correspondingEmails.length === 1 ? model.correspondingEmails[0] : undefined;
  const name = inferLeadContactName(model);
  let text = LEAD_CONTACT_TEMPLATE;
  if (name) text = text.replace("[NAME]", name);
  if (email) text = text.replace("[EMAIL]", email);
  const needsAuthor = /\[(NAME|EMAIL)\]/.test(text);
  const filled = [name && "name", email && "e-mail"].filter(Boolean).join(" and ");
  return {
    blocks: [{ type: needsAuthor ? "placeholder" : "paragraph", text }],
    needsAuthor,
    note: filled ? `Prefilled the Lead Contact statement with the ${filled} of the corresponding author.` : "Inserted the Lead Contact template; name and e-mail must be supplied.",
    fromSource: false,
  };
}

/** Materials Availability: keep the authors' text, otherwise the template. */
export function buildMaterialsAvailability(model: ManuscriptModel): PrefilledStatement {
  const existing = model.statements.materialsAvailability?.text?.trim();
  if (existing) return { blocks: [{ type: "paragraph", text: existing }], needsAuthor: false, note: "Moved the Materials Availability statement under Resource Availability.", fromSource: true };
  return {
    blocks: [{ type: "placeholder", text: MATERIALS_AVAILABILITY_TEMPLATE }],
    needsAuthor: true,
    note: "Inserted the Materials Availability template (authors must choose/complete the statement).",
    fromSource: false,
  };
}

/**
 * Data and Code Availability as the three standard bullets, prefilled from
 * the detected accessions and the original data/code statements.
 */
export function buildDataAndCode(model: ManuscriptModel): PrefilledStatement {
  const data: Statement | undefined = model.statements.dataAndCodeAvailability || model.statements.dataAvailability;
  const code: Statement | undefined = model.statements.codeAvailability;
  const dataText = data?.text;
  const notes: string[] = [];

  // Bullet 1: data.
  let b1 = DATA_CODE_BULLETS[0];
  const types = inferDataTypes(dataText);
  if (types) {
    b1 = b1.replace("[Data type] data", `${types} data`);
    notes.push(`data types (${types})`);
  }
  if (model.accessions.length > 0) {
    const repoNames = Array.from(new Set(model.accessions.map((a) => a.repository).filter(Boolean)));
    const repo = repoNames.length > 0 ? repoNames.join(" and ") : "[repository]";
    b1 = b1.replace("[repository]", `${repo} under accession numbers ${model.accessions.map((a) => a.id).filter((v, i, arr) => arr.indexOf(v) === i).join(", ")}`);
    notes.push(`${model.accessions.length} accession number(s)`);
  } else if (dataText && /no (new )?data|did not generate (any )?(new )?data/i.test(dataText)) {
    b1 = "This paper does not report original data.";
  } else if (!dataText) {
    b1 = "[Data type] data have been deposited at [repository] and are publicly available as of the date of publication. Accession numbers are listed in the key resources table. / This paper does not report original data.";
  }

  // Bullet 2: code.
  const codeInfo = classifyCodeStatement(code?.text || dataText);
  let b2 = DATA_CODE_BULLETS[1];
  if (codeInfo.kind === "deposited") b2 = `All original code has been deposited at ${codeInfo.url} and is publicly available as of the date of publication. DOIs are listed in the key resources table.`;
  else if (codeInfo.kind === "unknown") b2 = "[This paper does not report original code. / All original code has been deposited at [repository] and is publicly available as of the date of publication.]";
  else notes.push("the no-original-code statement");

  // Bullet 3: everything else (standard wording).
  const b3 = DATA_CODE_BULLETS[2];

  const blocks: LayoutBlock[] = [b1, b2, b3].map((t) => (/\[[^\]]+\]/.test(t) ? { type: "placeholder", text: `• ${t}` } : { type: "paragraph", text: t, style: "bullet" }));
  const needsAuthor = blocks.some((b) => b.type === "placeholder");
  return {
    blocks,
    needsAuthor,
    note: notes.length > 0 ? `Rebuilt Data and Code Availability as three bullets, prefilled with ${notes.join(", ")}.` : "Inserted the three-bullet Data and Code Availability template.",
    fromSource: !!dataText || !!code,
  };
}

/** Generic single statement (limitations, acknowledgments, ...). */
export function statementBlocks(stmt: Statement | undefined): LayoutBlock[] | undefined {
  const text = stmt?.text?.trim();
  if (!text) return undefined;
  return text
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean)
    .map((p) => ({ type: "paragraph", text: p }));
}
