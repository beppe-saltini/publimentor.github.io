/**
 * Reorganize a Methods section into STAR Methods.
 *
 * Source subsections are routed to the STAR Methods child slot whose
 * aliases match (Experimental Model..., Method Details, Quantification and
 * Statistical Analysis, Additional Resources). Everything unrecognized goes
 * under Method Details with its heading preserved one level down.
 * Numbered subheadings are de-numbered (Cell Press forbids numbering).
 */
import type { ManuscriptModel, Section } from "@/lib/format/manuscript-model";
import { normalizeHeading, splitParagraphs, walkSections } from "./plan-utils";
import type { LayoutBlock, TargetSlot } from "./types";

const MODEL_HEADINGS = /^(mice|animals?|mouse (models?|strains?)|mice and tumou?r models?|tumou?r models?|animal (studies|experiments|models?|husbandry)|cell (lines?|culture)|cells? and (cell )?culture|cell lines? and (cell )?culture|human .*(subjects|samples|participants|tissues?|specimens|cells?|isolation)|patients?( samples| cohorts?| and samples)?|clinical (samples|cohorts?|specimens)|study (participants?|population|cohort)|primary (cells?|cultures?|cell (isolation|culture)).*|patient[- ]derived.*|organoids?|zebrafish|drosophila|c\. elegans|yeast strains?|bacterial strains?|ethics( statement| approval)?|ethical (approval|statement)|experimental models?.*)$/i;
const STATS_HEADINGS = /^(statistic(s|al analys[ie]s)|statistical analysis and reproducibility|statistics and reproducibility|quantification( and statistical analysis)?|data analysis|image (quantification|analysis)|bioinformatic(s| analys[ie]s)|computational analys[ie]s|statistical methods)$/i;
const ADDITIONAL_HEADINGS = /^(additional resources|clinical trial registration|pre[- ]?registration|registration)$/i;
const AVAILABILITY_HEADINGS = /^(data|code|materials?|software|data and code|resource|reagent) availability$|^availability of .*$|^accession (codes|numbers)$|^key resources? table$/i;

export type StarChildId = "experimental_model" | "method_details" | "quantification" | "additional_resources";

/** Decide which STAR Methods child a subsection belongs to. */
export function routeMethodsSubsection(headingText: string): StarChildId | "skip" {
  const n = normalizeHeading(headingText);
  if (AVAILABILITY_HEADINGS.test(n)) return "skip"; // handled by Resource Availability
  if (MODEL_HEADINGS.test(n)) return "experimental_model";
  if (STATS_HEADINGS.test(n)) return "quantification";
  if (ADDITIONAL_HEADINGS.test(n)) return "additional_resources";
  return "method_details";
}

/** "2.1 Cell culture" -> "Cell culture"; "CELL CULTURE" -> "Cell culture". */
export function cleanSubheading(text: string): string {
  let t = text.replace(/^\s*(?:\d+(?:\.\d+)*[.)]?|[ivx]+[.)]|[A-Za-z][.)])\s+/i, "").trim();
  if (t === t.toUpperCase() && /[A-Z]/.test(t)) t = t.charAt(0) + t.slice(1).toLowerCase();
  return t.replace(/[.:]\s*$/, "");
}

export interface RoutedMethods {
  byChild: Record<StarChildId, LayoutBlock[]>;
  /** Sections renamed (numbered or re-cased). */
  renamed: Array<{ before: string; after: string }>;
  /** Flat text of everything routed (for KRT extraction). */
  text: string;
  hadNumbering: boolean;
}

/** Convert one subsection into blocks: heading then paragraphs then children. */
function sectionBlocks(section: Section, level: 2 | 3, renamed: RoutedMethods["renamed"]): LayoutBlock[] {
  const blocks: LayoutBlock[] = [];
  const heading = cleanSubheading(section.heading.text);
  if (heading !== section.heading.text.trim()) renamed.push({ before: section.heading.text.trim(), after: heading });
  blocks.push({ type: "heading", text: heading, level });
  for (const p of splitParagraphs(section.body)) blocks.push({ type: "paragraph", text: p });
  for (const child of section.children) {
    // Availability statements nested under a methods subsection belong to Resource Availability.
    if (routeMethodsSubsection(child.heading.text) === "skip") continue;
    blocks.push(...sectionBlocks(child, 3, renamed));
  }
  return blocks;
}

/** Route a methods section's children into STAR Methods children. */
export function routeMethods(methods: Section | undefined, model: ManuscriptModel): RoutedMethods {
  const byChild: RoutedMethods["byChild"] = { experimental_model: [], method_details: [], quantification: [], additional_resources: [] };
  const renamed: RoutedMethods["renamed"] = [];
  let hadNumbering = false;
  const texts: string[] = [];
  if (!methods) return { byChild, renamed, text: "", hadNumbering };

  // Intro paragraphs before the first subsection stay at the top of Method Details.
  for (const p of splitParagraphs(methods.body)) byChild.method_details.push({ type: "paragraph", text: p });
  texts.push(methods.body);

  for (const child of methods.children) {
    if (/^\s*\d+(\.\d+)*[.)]?\s+/.test(child.heading.text)) hadNumbering = true;
    const route = routeMethodsSubsection(child.heading.text);
    if (route === "skip") continue;
    byChild[route].push(...sectionBlocks(child, 3, renamed));
    for (const s of walkSections([child])) if (routeMethodsSubsection(s.heading.text) !== "skip") texts.push(s.body);
  }
  if (model.starMethods.numberedSubheadings) hadNumbering = true;
  return { byChild, renamed, text: texts.join("\n\n"), hadNumbering };
}

/** True when the manuscript uses models that require the Experimental Model section. */
export function needsExperimentalModelSection(model: ManuscriptModel, routed: RoutedMethods): boolean {
  if (routed.byChild.experimental_model.length > 0) return true;
  // Feature keys differ between model versions; look them up loosely.
  const f = model.features as Partial<Record<string, { present: boolean }>>;
  const keys = ["vertebrates", "animals", "mice", "humans", "humanSubjects", "cellLines", "cell_lines", "patients", "clinical"];
  if (keys.some((k) => f[k]?.present)) return true;
  return /\b(mice|mouse|rats?|zebrafish|patients?|participants?|cell lines?)\b/i.test(model.text);
}

/** The STAR Methods child slot ids in journal order. */
export function starChildOrder(slot: TargetSlot): string[] {
  return (slot.children || []).map((c) => c.id);
}
