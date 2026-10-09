/**
 * ManuscriptModel — a structural, journal-agnostic model of an accepted
 * manuscript, built from a PDF, a DOCX or plain text.
 *
 * Everything a formatting check needs is pre-extracted here so that the checks
 * themselves stay declarative: headings and sections, the summary, figure
 * legends (with their error-bar/asterisk/scale-bar flags), supplemental item
 * titles, the reference list and its fields, the required statements, the
 * methods structure, feature flags (blots? vertebrates? RNA-seq?), deposition
 * accessions and discouraged phrases.
 *
 * Nothing here knows about a specific journal; `profile.ts` owns the rules.
 */

import {
  cleanPdfPages,
  extractPdfPages,
} from "./parse/pdf-clean";
import { detectStructure, methodsLikeSpans } from "./parse/headings";
import { assessLegendPlacement, parseFiguresAndTables } from "./parse/figures";
import { parseReferences } from "./parse/references";
import {
  parseFrontMatter,
  parseStarMethods,
  parseStatements,
  parseSummary,
} from "./parse/statements";
import { detectAccessions, detectFeatures, detectPhraseHits } from "./parse/features";
import { extractDocx } from "./parse/docx";
import {
  countWords,
  excerptAt,
  indexLines,
  normalizeText,
} from "./parse/text-utils";
import type {
  BuildModelInput,
  DocxFacts,
  ManuscriptModel,
  TextSpan,
} from "./parse/model-types";

// Re-export the whole model vocabulary: this module is the public entry point.
export type {
  AccessionRef,
  BuildModelInput,
  DocxFacts,
  Feature,
  FeatureKey,
  FigureLegend,
  Heading,
  HighlightsBlock,
  Hit,
  ManuscriptModel,
  ManuscriptStatements,
  PhraseHits,
  ReferenceEntry,
  ReferencesBlock,
  Section,
  StarMethodsBlock,
  Statement,
  SummaryBlock,
  SupplementalItem,
  TableCaption,
  TextSpan,
} from "./parse/model-types";

const PDF_MAGIC = "%PDF";
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

/**
 * Decides what we are looking at. The buffer's magic bytes win over the
 * declared MIME type and the file extension, which uploads often get wrong.
 */
export function detectSourceType(input: BuildModelInput): ManuscriptModel["sourceType"] {
  const { buffer, fileName, mimeType } = input;
  if (buffer && buffer.length >= 4) {
    if (buffer.subarray(0, 4).toString("latin1") === PDF_MAGIC) return "pdf";
    const isZip = ZIP_MAGIC.every((byte, i) => buffer[i] === byte);
    if (isZip) return "docx";
  }
  const name = (fileName ?? "").toLowerCase();
  if (mimeType === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    name.endsWith(".docx")
  ) {
    return "docx";
  }
  return "text";
}

interface SourceText {
  sourceType: ManuscriptModel["sourceType"];
  text: string;
  pageCount?: number;
  explicitHeadings?: Map<number, 1 | 2 | 3>;
  docx?: DocxFacts;
}

/** Step 1 of the pipeline: get clean text out of whatever we were given. */
async function readSource(input: BuildModelInput): Promise<SourceText> {
  const sourceType = detectSourceType(input);

  if (sourceType === "pdf") {
    if (!input.buffer) throw new Error("A PDF manuscript requires a buffer");
    const pages = await extractPdfPages(input.buffer);
    const cleaned = cleanPdfPages(pages);
    return {
      sourceType,
      text: normalizeText(cleaned.text),
      pageCount: cleaned.pageCount,
    };
  }

  if (sourceType === "docx") {
    if (!input.buffer) throw new Error("A DOCX manuscript requires a buffer");
    const extraction = await extractDocx(input.buffer);
    return {
      sourceType,
      text: normalizeText(extraction.text),
      explicitHeadings: extraction.explicitHeadings,
      docx: extraction.facts,
    };
  }

  return { sourceType, text: normalizeText(input.text ?? "") };
}

/**
 * Builds the structural model. Pure analysis: no network, no LLM calls, no
 * journal knowledge — so it is cheap enough to run on every upload.
 */
export async function buildManuscriptModel(input: BuildModelInput): Promise<ManuscriptModel> {
  const source = await readSource(input);
  const { text } = source;
  const lines = indexLines(text);

  // Headings and legend labels are mutually dependent: a legend line must not
  // be taken for a heading, and a legend block ends at the next heading. Two
  // passes settle it.
  const firstPass = detectStructure(text, lines, {
    explicitHeadings: source.explicitHeadings,
  });
  const provisionalLabels = parseFiguresAndTables(text, lines, firstPass.outline);
  const { outline, sections } = detectStructure(text, lines, {
    explicitHeadings: source.explicitHeadings,
    labelLines: provisionalLabels.labelLines,
  });
  const figures = parseFiguresAndTables(text, lines, outline);
  const placement = assessLegendPlacement(text, outline, figures.figureLegends);

  const frontMatter = parseFrontMatter(text, lines, outline);
  const summary = parseSummary(text, outline);
  const statements = parseStatements(text, outline, sections);
  const starMethods = parseStarMethods(
    text,
    outline,
    figures.figureLegends,
    figures.tableCaptions,
    statements
  );
  const references = parseReferences(text, lines, outline);

  // Features and discouraged phrases are measured on the manuscript's own
  // prose. Reference titles would otherwise report microarrays, "novel" claims
  // and clinical trials that the paper never performed. Slicing from offset 0
  // keeps every span valid against the full text.
  const referencesStart = referenceListStart(text, outline);
  const prose = text.slice(0, referencesStart);
  // Where the paper describes its own work: a data type named here was
  // generated; the same words in the Introduction or Discussion (or in a
  // review, which has no methods at all) are background.
  const methodsSpans = methodsLikeSpans(text, outline);

  return {
    sourceType: source.sourceType,
    fileName: input.fileName,
    text,
    pageCount: source.pageCount,
    wordCount: countWords(text),

    title: frontMatter.title,
    authorsLine: frontMatter.authorsLine,
    affiliations: frontMatter.affiliations,
    correspondingEmails: frontMatter.correspondingEmails,
    hasLeadContactFootnote: frontMatter.hasLeadContactFootnote,

    summary,
    outline,
    sections,

    figureLegends: figures.figureLegends,
    legendsInterspersed: placement.legendsInterspersed,
    legendsAfterMainText: placement.legendsAfterMainText,
    tableCaptions: figures.tableCaptions,
    supplementalItems: figures.supplementalItems,
    supplementalMentions: figures.supplementalMentions,

    references,
    statements,
    starMethods,
    features: detectFeatures(prose, { methodsSpans }),
    // Accessions may legitimately appear anywhere, including a data statement
    // placed after the reference list.
    accessions: detectAccessions(text),
    phraseHits: detectPhraseHits(prose),
    docx: source.docx,
  };
}

/** Offset where the reference list begins, or the end of the text. */
function referenceListStart(text: string, outline: ManuscriptModel["outline"]): number {
  for (let i = outline.length - 1; i >= 0; i -= 1) {
    if (/^(references|bibliography|literature cited)$/.test(outline[i].normalized)) {
      return outline[i].span.start;
    }
  }
  return text.length;
}

/** Quote of the manuscript text around a span, for check evidence. */
export function excerpt(model: ManuscriptModel, span: TextSpan, pad = 120): string {
  return excerptAt(model.text, span, pad);
}
