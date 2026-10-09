/**
 * Figure legends, table captions and supplemental item titles.
 *
 * - Main legends are collected into one list and retitled with the
 *   journal template ("Fig. 1 | Title" -> "Figure 1. Title"), adding
 *   "See also Figure S1." when a supplemental item relates to the figure.
 * - Supplemental item titles get the journal form ("Figure S1. Title,
 *   Related to Figure 2"). The related main item is taken from the model,
 *   inferred from co-mentions in the text, or left as a placeholder.
 */
import type { FigureLegend, ManuscriptModel, SupplementalItem, TableCaption } from "@/lib/format/manuscript-model";
import { canonicalFigureRef, makeOp, OpIdFactory, phrase, snippet } from "./plan-utils";
import type { FormatOperation, LayoutBlock, TargetStructure } from "./types";

const SUPPL_LABEL: Record<SupplementalItem["kind"], string> = { figure: "Figure", table: "Table", video: "Video", data: "Data", scheme: "Scheme" };

/** Strip legacy prefixes/separators from a legend title: "Fig. 1 | Title." -> "Title". */
export function cleanLegendTitle(title: string): string {
  return title
    .replace(/^\s*(?:supplementary|supplemental|extended data)?\s*(?:fig(?:ure)?\.?|table|video|data|scheme)\s*S?\d+[A-Za-z]?\s*[|.:\-–]?\s*/i, "")
    .replace(/\s+/g, " ")
    .replace(/[.\s]+$/, "")
    .trim();
}

export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
}

/** Supplemental items related to main figure `n` ("Figure S1", "Table S2"). */
export function relatedSupplementalFor(figureNumber: string, items: SupplementalItem[]): string[] {
  const want = `Figure ${figureNumber}`.toLowerCase();
  return items
    .filter((it) => it.relatedTo.some((r) => canonicalFigureRef(r).toLowerCase() === want))
    .map((it) => `${SUPPL_LABEL[it.kind]} S${it.number}`);
}

/** "See also Figure S1 and Table S1." */
export function seeAlsoSentence(items: string[]): string {
  if (items.length === 0) return "";
  const figs = items.filter((i) => i.startsWith("Figure"));
  const rest = items.filter((i) => !i.startsWith("Figure"));
  const join = (list: string[], label: string) =>
    list.length === 0 ? "" : list.length === 1 ? list[0] : `${label}s ${list.map((x) => x.replace(/^\w+\s/, "")).join(", ").replace(/, (S\d+)$/, " and $1")}`;
  const parts = [join(figs, "Figure"), join(rest.filter((r) => r.startsWith("Table")), "Table"), ...rest.filter((r) => !r.startsWith("Table"))].filter(Boolean);
  return `See also ${parts.join(" and ")}.`;
}

export interface LegendsResult {
  blocks: LayoutBlock[];
  operations: FormatOperation[];
}

/** Legends labelled "Supplementary Fig." / "Extended Data" belong to the supplemental list, not the main one. */
export function isSupplementalLegend(legend: FigureLegend): boolean {
  return /supplementary|supplemental|extended data|^S\d/i.test(`${legend.label} ${legend.number}`) || /^\s*(supplementary|supplemental|extended data)/i.test(legend.title);
}

/**
 * Parsers sometimes put the whole legend into `title`. Keep the first
 * sentence as the title and hand the rest back as body text. A sentence
 * ends at ". " followed by a panel marker ("a,", "a–c,", "(a)") or a capital.
 */
export function splitLegendTitle(title: string, body: string): { title: string; body: string } {
  const flat = title.replace(/\s+/g, " ").trim();
  const m = flat.match(/^(.{10,}?[.!?])\s+(?=(?:\(?[a-z](?:[,–-][a-z])*[,)]|[A-Z]))/);
  if (!m) return { title: flat, body };
  const rest = flat.slice(m[1].length).trim();
  const merged = body && body.replace(/\s+/g, " ").startsWith(rest.slice(0, 40)) ? body : [rest, body].filter(Boolean).join(" ");
  return { title: m[1], body: merged };
}

/** Build the single legends list with retitled legends and See-also lines. */
export function buildFigureLegends(model: ManuscriptModel, target: TargetStructure, ids: OpIdFactory): LegendsResult {
  const blocks: LayoutBlock[] = [];
  const operations: FormatOperation[] = [];
  const legends = model.figureLegends.filter((l) => !isSupplementalLegend(l)).sort((a, b) => Number(a.number) - Number(b.number));
  if (legends.length === 0) return { blocks, operations };

  if (model.legendsInterspersed || !model.legendsAfterMainText) {
    operations.push(
      makeOp(ids, "collect_legends", `Collected the ${legends.length} main figure legends into one list under "${target.slots.find((s) => s.kind === "legends")?.heading ?? "Figure legends"}" (they were interspersed in the text).`, {
        slotId: "figure_legends",
      })
    );
  }

  for (const legend of legends) {
    const split = splitLegendTitle(legend.title || legend.body.split(/(?<=[.!?])\s/)[0] || "", legend.body);
    const title = cleanLegendTitle(split.title);
    const newTitle = fillTemplate(target.legendTitle.template, { n: legend.number, title: title || "[Descriptive title]" });
    const oldTitle = `${legend.label} ${legend.title}`.trim();
    if (oldTitle.replace(/\s+/g, " ") !== newTitle) {
      operations.push(
        makeOp(ids, "retitle_legend", `Retitled the legend of Figure ${legend.number} in journal style.`, {
          before: snippet(oldTitle),
          after: snippet(newTitle),
          slotId: "figure_legends",
          span: legend.span,
        })
      );
    }
    blocks.push({ type: title ? "paragraph" : "placeholder", text: newTitle, style: "legend_title" });

    const body = split.body.replace(/\s*\n\s*/g, " ").trim();
    const related = relatedSupplementalFor(legend.number, model.supplementalItems);
    const alreadySeeAlso = legend.seeAlso.length > 0 || /see also/i.test(body);
    let finalBody = body;
    if (related.length > 0 && !alreadySeeAlso) {
      const sentence = seeAlsoSentence(related);
      finalBody = body ? `${body} ${sentence}` : sentence;
      operations.push(
        makeOp(ids, "add_see_also", `Added "${sentence}" to the legend of Figure ${legend.number}.`, {
          after: sentence,
          slotId: "figure_legends",
          span: legend.span,
        })
      );
    }
    if (finalBody) blocks.push({ type: "paragraph", text: finalBody });
    const missing: string[] = [];
    if (!legend.definesErrorBars && /mean|±|error bar|s\.?e\.?m\.?|s\.?d\.?/i.test(body) === false && /n\s*=\s*\d/.test(body)) missing.push("the measure of dispersion (e.g. mean ± SEM)");
    if (!legend.namesStatisticalTest && /\*|P\s*[<=]/.test(body)) missing.push("the statistical test and what the asterisks denote");
    if (missing.length > 0) {
      operations.push(
        makeOp(ids, "note", `Legend of Figure ${legend.number} should define ${missing.join(" and ")}.`, {
          slotId: "figure_legends",
          needsAuthorInput: phrase(target, "legend_statistics", `Please define in the legend of Figure ${legend.number}: ${missing.join("; ")}.`),
          topic: "legend_statistics",
          span: legend.span,
        })
      );
    }
  }
  // Plain-text extraction cannot see the asterisks drawn in the figures. When
  // the legends name statistical tests but none says what "*" means, the
  // authors must confirm every relevant legend defines them with the test.
  const testsNamed = legends.some((l) => l.namesStatisticalTest || /\bP\s*(?:values?\s*)?[<=>≤]/.test(l.body));
  if (testsNamed && !legends.some((l) => l.definesAsterisks)) {
    operations.push(
      makeOp(ids, "note", "Legends name statistical tests but none defines significance asterisks (the figures may show them).", {
        slotId: "figure_legends",
        topic: "legend_asterisks",
        needsAuthorInput: phrase(target, "legend_asterisks", "Where statistical tests are presented as asterisks, please ensure that the asterisks are defined in each relevant figure legend, together with the name of the statistical test."),
      })
    );
  }
  return { blocks, operations };
}

/** Main (non-supplemental) table captions as "Table 1. Title". */
export function buildTableBlocks(captions: TableCaption[], ids: OpIdFactory): LegendsResult {
  const blocks: LayoutBlock[] = [];
  const operations: FormatOperation[] = [];
  for (const cap of captions.filter((c) => !c.isSupplemental)) {
    const title = cleanLegendTitle(cap.title);
    const text = `Table ${cap.number}. ${title || "[Descriptive title]"}`;
    blocks.push({ type: title ? "paragraph" : "placeholder", text, style: "legend_title" });
    blocks.push({ type: "placeholder", text: `[Insert Table ${cap.number} here as an editable Word table (no merged cells, no colors); footnotes/legend below it.]` });
    operations.push(makeOp(ids, "note", `Table ${cap.number} must be supplied as an editable Word table under its title.`, { slotId: "tables", needsAuthorInput: `Please supply Table ${cap.number} as an editable Microsoft Word table (one value per cell, no merged cells, shading or line breaks) placed under its title in the "Main tables and legends" section.` }));
  }
  return { blocks, operations };
}

/**
 * Infer which main figure a supplemental item relates to by looking at main
 * figure citations near its mentions in the text ("(Fig. 2c; Supplementary
 * Fig. 1a)"). Returns the most frequently co-cited figure.
 */
export function inferRelatedFigure(item: SupplementalItem, text: string): string | undefined {
  const label = item.kind === "figure" ? "Fig(?:ure)?\\.?" : item.kind === "table" ? "Table" : SUPPL_LABEL[item.kind];
  // "(?!\\d)" rather than "\\b": panel letters follow the number directly ("Fig. 1a").
  const mentionRe = new RegExp(`(?:Supplementary|Supplemental|Extended Data)\\s+${label}\\s*${item.number}(?!\\d)|\\b${SUPPL_LABEL[item.kind]}\\s*S${item.number}(?!\\d)`, "gi");
  const scores = new Map<string, number>();
  const BEFORE = 250;
  for (const m of text.matchAll(mentionRe)) {
    const start = Math.max(0, m.index! - BEFORE);
    const window = text.slice(start, m.index! + 150);
    const mentionPos = m.index! - start;
    for (const f of window.matchAll(/Fig(?:ure)?s?\.?\s*(\d+)(?!\d)/g)) {
      // Skip when the match itself is a supplementary reference.
      const before = window.slice(Math.max(0, f.index! - 14), f.index!);
      if (/Supplementar|Supplemental|Extended Data/i.test(before)) continue;
      // Nearer citations weigh more: the same sentence usually names the related figure.
      const distance = Math.abs(f.index! - mentionPos);
      const key = `Figure ${f[1]}`;
      scores.set(key, (scores.get(key) || 0) + 1 / (1 + distance / 40));
    }
  }
  if (scores.size === 0) return undefined;
  return Array.from(scores.entries()).sort((a, b) => b[1] - a[1])[0][0];
}

/** Does the supplemental item get cited inside the methods text? */
function citedInMethods(item: SupplementalItem, methodsText: string | undefined): boolean {
  if (!methodsText) return false;
  const label = item.kind === "figure" ? "Fig(?:ure)?\\.?" : SUPPL_LABEL[item.kind];
  return new RegExp(`(?:Supplementary|Supplemental)\\s+${label}\\s*${item.number}(?!\\d)|\\b${SUPPL_LABEL[item.kind]}\\s*S${item.number}(?!\\d)`, "i").test(methodsText);
}

/** Supplemental titles in journal form with "Related to" information. */
export function buildSupplementalTitles(model: ManuscriptModel, target: TargetStructure, ids: OpIdFactory, methodsText?: string): LegendsResult {
  const blocks: LayoutBlock[] = [];
  const operations: FormatOperation[] = [];
  const order: SupplementalItem["kind"][] = ["figure", "table", "video", "data", "scheme"];
  const items = [...model.supplementalItems].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || Number(a.number) - Number(b.number));
  for (const item of items) {
    const title = cleanLegendTitle(item.title);
    let related = item.relatedTo.map(canonicalFigureRef).filter(Boolean);
    if (related.length === 0) {
      const inferred = inferRelatedFigure(item, model.text);
      if (inferred) related = [inferred];
      else if (citedInMethods(item, methodsText)) related = ["STAR Methods"];
    }
    const relatedText = related.length > 0 ? related.join(" and ") : "[Figure N / STAR Methods]";
    const base = fillTemplate(target.supplementalTitle[item.kind], { n: item.number, title: title || "[Descriptive title]" });
    const text = target.supplementalTitle.relatedToTemplate ? base + fillTemplate(target.supplementalTitle.relatedToTemplate, { related: relatedText }) : base;
    const placeholder = related.length === 0 || !title;
    blocks.push({ type: placeholder ? "placeholder" : "paragraph", text, style: "legend_title" });
    operations.push(
      makeOp(ids, "retitle_supplemental", `Retitled supplemental ${item.kind} ${item.number} in journal form${related.length > 0 ? ` (related to ${relatedText})` : ""}.`, {
        before: snippet(item.title ? `${item.title}` : `${item.kind} ${item.number}`),
        after: snippet(text),
        slotId: "supplemental_titles",
        span: item.span,
        ...(related.length === 0
          ? {
              // Item-specific wording (the generic journal phrase would collapse all items into one line).
              needsAuthorInput: `Please state in the title of ${SUPPL_LABEL[item.kind]} S${item.number} which main item or the STAR Methods it relates to (e.g. "${SUPPL_LABEL[item.kind]} S${item.number}. [Title], Related to Figure 1").`,
              topic: "supplemental_related",
            }
          : {}),
      })
    );
  }
  return { blocks, operations };
}

export type { FigureLegend };
