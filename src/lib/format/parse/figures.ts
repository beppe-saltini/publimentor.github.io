/**
 * Figure legends, table captions and supplemental item titles.
 *
 * Both naming conventions are recognised, because the point of the checker is
 * to tell them apart:
 *   Cell Press  — "Figure 1. Title", "Table S1. Title, Related to Figure 1"
 *   Nature-ish  — "Fig. 1 | Title", "Supplementary Fig. 1. Title"
 *
 * Supplemental numbering is preserved as written: an item titled
 * "Figure S1." keeps number "S1", one titled "Supplementary Fig. 1." keeps
 * number "1". Downstream checks use that difference to tell which convention
 * the authors followed.
 */

import type {
  FigureLegend,
  Heading,
  SupplementalItem,
  TableCaption,
  TextSpan,
} from "./model-types";
import { collapse, firstSentence, matchAll, type IndexedLine } from "./text-utils";

/** "Fig. 1 |", "Figure 1.", "FIGURE 2:" at the start of a line. */
const FIGURE_START =
  /^\s*(fig(?:ure)?s?\.?)\s*(S?\d{1,2})(?![A-Za-z\d])\s*(\||\.|:|–|—|│)\s*(.*)$/i;

/** "Table 1.", "Table S2 |" at the start of a line. */
const TABLE_START = /^\s*(table)\s*(S?\d{1,2})(?![A-Za-z\d])\s*(\||\.|:|–|—)?\s*(.*)$/i;

/** Supplemental item title: optional "Supplementary"/"Supplemental" prefix. */
const SUPPLEMENTAL_START =
  /^\s*(supplementary|supplemental|extended\s+data)?\s*(fig(?:ure)?s?\.?|tables?|videos?|movies?|data\s?sets?|data|schemes?|audio)\s*(S?\d{1,2})(?![A-Za-z\d])\s*(\||\.|:|–|—)?\s*(.*)$/i;

const ERROR_BAR_VALUE =
  /(mean|median|average|avg)\s*(?:±|\+\/-|\+-|\+ or -|∓)\s*(s\.?\s?e\.?\s?m\.?|s\.?\s?d\.?|sem|sd|standard\s+(?:error|deviation))/i;
const ERROR_BAR_DEFINITION =
  /(error bars?|data(?:\s+points)?|values|box(?:es|plots?)?|whiskers?|shaded (?:area|region|band))\s+(?:are|is|was|were|represent|represents|indicate|indicates|show|shows|denote|denotes|depict|depicts|correspond)[^.]{0,60}(s\.?e\.?m\.?|s\.?d\.?|\bsem\b|\bsd\b|standard\s+(?:error|deviation)|95%\s*c\.?i\.?|confidence interval|interquartile|quartiles?|range|min(?:imum)?\s+(?:and|to)\s+max)/i;

const STAT_TEST =
  /\b(t-?tests?|student'?s? t|ANOVA|Mann[\s–-]?Whitney|Wilcoxon|Kruskal[\s–-]?Wallis|chi[\s-]?squared?|χ2|log[\s-]?rank|Fisher'?s? exact|Dunnett|Tukey|Bonferroni|Sidak|Šidák|Holm|Kolmogorov[\s–-]?Smirnov|Spearman|Pearson|linear (?:mixed|regression)|Cox (?:proportional|regression)|permutation test|two-tailed|one-tailed|repeated[\s-]measures)\b/i;

const ASTERISK_DEFINITION = /(\*{1,4}\s*(?:,|and|or)?\s*)?\*{1,4}\s*[,:]?\s*[Pp]\s*[<>=≤≥]/;
const ASTERISK_PHRASE = /asterisks?\s+(indicate|denote|represent|show|mark|signify)/i;
const SCALE_BAR = /scale\s*bars?/i;
const SEE_ALSO = /see also\s+([^.\n]+)/i;
const RELATED_TO = /related to\s+([^.\n]+)/i;

/** Parses "Figure S1 and Table S1" / "Figure 2, STAR Methods" into labels. */
export function parseItemList(raw: string): string[] {
  const parts = collapse(raw)
    .replace(/\band\b/gi, ",")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  let lastKind = "";
  for (const part of parts) {
    const m = part.match(
      /^(supplementary|supplemental|extended data)?\s*(fig(?:ure)?s?\.?|tables?|videos?|movies?|data|schemes?)?\s*(S?\d{1,2}[a-z]?(?:\s*[–-]\s*S?\d{1,2}[a-z]?)?)$/i
    );
    if (m) {
      const kindWord = m[2] ? normalizeKindWord(m[2]) : lastKind;
      const prefix = m[1] ? `${capitalize(m[1].replace(/\s+/g, " "))} ` : "";
      if (kindWord) lastKind = kindWord;
      out.push(collapse(`${prefix}${kindWord} ${m[3]}`));
      continue;
    }
    if (/star\s*methods/i.test(part)) {
      out.push("STAR Methods");
      continue;
    }
    if (part.length > 0 && part.length < 60) out.push(collapse(part));
  }
  return out;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function normalizeKindWord(word: string): string {
  const w = word.toLowerCase().replace(/\.$/, "");
  if (w.startsWith("fig")) return "Figure";
  if (w.startsWith("table")) return "Table";
  if (w.startsWith("video") || w.startsWith("movie")) return "Video";
  if (w.startsWith("data")) return "Data";
  if (w.startsWith("scheme")) return "Scheme";
  if (w.startsWith("audio")) return "Audio";
  return capitalize(w);
}

function supplementalKind(word: string): SupplementalItem["kind"] {
  const w = word.toLowerCase().replace(/\.$/, "");
  if (w.startsWith("fig")) return "figure";
  if (w.startsWith("table")) return "table";
  if (w.startsWith("video") || w.startsWith("movie")) return "video";
  if (w.startsWith("scheme")) return "scheme";
  return "data";
}

export interface LegendParseResult {
  figureLegends: FigureLegend[];
  tableCaptions: TableCaption[];
  supplementalItems: SupplementalItem[];
  supplementalMentions: string[];
  /** Line indices that start a legend/caption/supplemental title. */
  labelLines: Set<number>;
}

interface LabelHit {
  lineIdx: number;
  kind: "figure" | "table" | "supplemental";
  number: string;
  /** Label as written, whitespace-collapsed, e.g. "Fig. 1 |". */
  label: string;
  /** Length of the label in the raw line, used to slice off the title. */
  labelLength: number;
  rest: string;
  supplementalPrefix: boolean;
  supplementalKindWord?: string;
}

/** True when the text after a label looks like a real title, not a wrapped mention. */
function hasTitleText(rest: string): boolean {
  const t = rest.trim();
  if (t.length === 0) return false;
  if (/^[),;:]/.test(t)) return false; // "(Supplementary Fig. 5a), suggesting …"
  return t.split(/\s+/).filter(Boolean).length >= 2;
}

/** Collects every label that starts a line, before deciding what it is. */
function collectLabels(lines: IndexedLine[]): LabelHit[] {
  const hits: LabelHit[] = [];
  for (const line of lines) {
    const raw = line.text;
    if (raw.trim().length === 0) continue;

    const supp = raw.match(SUPPLEMENTAL_START);
    if (supp) {
      const prefix = Boolean(supp[1]);
      const number = supp[3].toUpperCase();
      const rest = supp[5] ?? "";
      const isSupplemental = prefix || number.startsWith("S");
      if (isSupplemental && hasTitleText(rest)) {
        hits.push({
          lineIdx: line.i,
          kind: "supplemental",
          number,
          label: collapse(raw.slice(0, raw.length - rest.length)),
          labelLength: raw.length - rest.length,
          rest,
          supplementalPrefix: prefix,
          supplementalKindWord: supp[2],
        });
        continue;
      }
    }

    const fig = raw.match(FIGURE_START);
    if (fig && hasTitleText(fig[4])) {
      hits.push({
        lineIdx: line.i,
        kind: "figure",
        number: fig[2].toUpperCase(),
        label: collapse(raw.slice(0, raw.length - fig[4].length)),
        labelLength: raw.length - fig[4].length,
        rest: fig[4],
        supplementalPrefix: false,
      });
      continue;
    }

    const tbl = raw.match(TABLE_START);
    if (tbl && hasTitleText(tbl[4] ?? "")) {
      const tableRest = tbl[4] ?? "";
      hits.push({
        lineIdx: line.i,
        kind: "table",
        number: tbl[2].toUpperCase(),
        label: collapse(raw.slice(0, raw.length - tableRest.length)),
        labelLength: raw.length - tableRest.length,
        rest: tableRest,
        supplementalPrefix: false,
      });
    }
  }
  return hits;
}

/**
 * Parses legends, captions and supplemental titles out of the document.
 * `headings` bound each legend block so a legend never swallows a section.
 */
export function parseFiguresAndTables(
  text: string,
  lines: IndexedLine[],
  headings: Heading[]
): LegendParseResult {
  const hits = collectLabels(lines);
  const labelLines = new Set(hits.map((h) => h.lineIdx));
  const headingStarts = headings.map((h) => h.span.start).sort((a, b) => a - b);

  /** End of a block starting at `lineIdx`: next label or next heading. */
  const blockEnd = (lineIdx: number, order: number): number => {
    const startOffset = lines[lineIdx].start;
    const nextLabel = hits[order + 1] ? lines[hits[order + 1].lineIdx].start : text.length;
    const nextHeading =
      headingStarts.find((s) => s > startOffset + 1) ?? text.length;
    return Math.min(nextLabel, nextHeading, text.length);
  };

  const figureLegends: FigureLegend[] = [];
  const tableCaptions: TableCaption[] = [];
  const supplementalItems: SupplementalItem[] = [];

  hits.forEach((hit, order) => {
    const start = lines[hit.lineIdx].start;
    const end = blockEnd(hit.lineIdx, order);
    const span: TextSpan = { start, end };
    const block = text.slice(start, end);
    const afterLabel = collapse(block.slice(hit.labelLength));
    const title = firstSentence(afterLabel);
    const body = collapse(afterLabel.slice(title.length));

    if (hit.kind === "supplemental") {
      const kindWord = hit.supplementalKindWord ?? "figure";
      const relatedMatch = block.match(RELATED_TO);
      supplementalItems.push({
        kind: supplementalKind(kindWord),
        number: hit.number,
        title,
        relatedTo: relatedMatch ? parseItemList(relatedMatch[1]) : [],
        span,
      });
      // A supplemental figure also carries a legend, which the figure checks
      // may inspect (error bars, asterisks); record it as a legend too.
      if (supplementalKind(kindWord) === "figure") {
        figureLegends.push(makeLegend(hit.number, hit.label, title, body, span, block));
      }
      if (supplementalKind(kindWord) === "table") {
        tableCaptions.push({ number: hit.number, title, span, isSupplemental: true });
      }
      return;
    }

    if (hit.kind === "figure") {
      figureLegends.push(makeLegend(hit.number, hit.label, title, body, span, block));
      return;
    }

    tableCaptions.push({
      number: hit.number,
      title,
      span,
      isSupplemental: hit.number.startsWith("S"),
    });
  });

  return {
    figureLegends,
    tableCaptions,
    supplementalItems,
    supplementalMentions: collectSupplementalMentions(text),
    labelLines,
  };
}

function makeLegend(
  number: string,
  label: string,
  title: string,
  body: string,
  span: TextSpan,
  block: string
): FigureLegend {
  const seeAlsoMatch = block.match(SEE_ALSO);
  return {
    number,
    label,
    title,
    body,
    span,
    definesErrorBars: ERROR_BAR_VALUE.test(block) || ERROR_BAR_DEFINITION.test(block),
    namesStatisticalTest: STAT_TEST.test(block),
    definesAsterisks: ASTERISK_DEFINITION.test(block) || ASTERISK_PHRASE.test(block),
    mentionsScaleBar: SCALE_BAR.test(block),
    seeAlso: seeAlsoMatch ? parseItemList(seeAlsoMatch[1]) : [],
  };
}

/** Distinct supplemental labels referenced anywhere in the text. */
export function collectSupplementalMentions(text: string): string[] {
  const seen = new Set<string>();
  const patterns = [
    /(supplementary|supplemental|extended\s+data)\s+(fig(?:ure)?s?\.?|tables?|videos?|movies?|data\s?sets?|data|schemes?)\s*(\d{1,2})[a-z]?/gi,
    /\b(fig(?:ure)?s?\.?|tables?|videos?|movies?|data|schemes?)\s*(S\d{1,2})[a-z]?/gi,
  ];
  for (const pattern of patterns) {
    for (const { match } of matchAll(text, pattern)) {
      const label =
        match.length === 4
          ? `${capitalize(match[1].replace(/\s+/g, " "))} ${normalizeKindWord(match[2])} ${match[3]}`
          : `${normalizeKindWord(match[1])} ${match[2].toUpperCase()}`;
      seen.add(collapse(label));
    }
  }
  return [...seen].sort((a, b) =>
    a.localeCompare(b, "en", { numeric: true, sensitivity: "base" })
  );
}

export interface LegendPlacement {
  legendsInterspersed: boolean;
  legendsAfterMainText: boolean;
}

/**
 * Decides whether the main figure legends form one list after the main text
 * (what Cell Press asks for) or are interspersed through Results/Discussion
 * (the Nature-style layout).
 */
export function assessLegendPlacement(
  text: string,
  headings: Heading[],
  figureLegends: FigureLegend[]
): LegendPlacement {
  const mainLegends = figureLegends.filter((l) => !l.number.startsWith("S"));
  if (mainLegends.length === 0) {
    return { legendsInterspersed: false, legendsAfterMainText: false };
  }

  const resultsHeading = headings.find((h) => /^results/.test(h.normalized));
  const discussionHeading = headings.find((h) => /^discussion$/.test(h.normalized));
  const methodsHeading = headings.find((h) =>
    /^(star ?methods|materials and methods|methods|online methods|experimental procedures|method details)/.test(
      h.normalized
    )
  );
  const referencesHeading = headings.find((h) => /^(references|bibliography)$/.test(h.normalized));

  const bodyStart = resultsHeading?.span.start ?? 0;
  // The main text ends where the methods (or references) begin; if the paper
  // has a Discussion, its section is the last body section.
  const bodyEnd =
    methodsHeading?.span.start ??
    referencesHeading?.span.start ??
    (discussionHeading ? text.length : text.length);

  const inBody = mainLegends.filter(
    (l) => l.span.start >= bodyStart && l.span.start < bodyEnd
  );
  if (inBody.length === 0) {
    return { legendsInterspersed: false, legendsAfterMainText: true };
  }

  const firstStart = inBody[0].span.start;
  const lastEnd = inBody[inBody.length - 1].span.end;
  const headingBetween = headings.some(
    (h) => h.span.start > firstStart && h.span.start < lastEnd
  );
  // A single legend buried in the body still counts as interspersed when a lot
  // of body text follows it before the methods start.
  const bodyTextAfter = bodyEnd - lastEnd;
  const interspersed = headingBetween || bodyTextAfter > 400;
  // Not interspersed means the legends sit as one contiguous block at the end
  // of the main text (Cell Press layout), which is what we report here.
  return { legendsInterspersed: interspersed, legendsAfterMainText: !interspersed };
}
