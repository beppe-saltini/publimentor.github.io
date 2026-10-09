/**
 * Types for the structural manuscript model used by the Journal-Ready
 * Formatter & Compliance Checker.
 *
 * These live in `parse/` (not in `manuscript-model.ts`) so that the parser
 * helper modules can import them without creating an import cycle with the
 * orchestrator. `manuscript-model.ts` re-exports every type, which is the
 * public entry point other modules should import from.
 */

/** Character range into `ManuscriptModel.text` (end exclusive). */
export interface TextSpan {
  start: number;
  end: number;
}

export interface Heading {
  /** Heading text as it appears in the manuscript. */
  text: string;
  /** Lower-cased, punctuation-stripped form used for matching. */
  normalized: string;
  level: 1 | 2 | 3;
  span: TextSpan;
}

export interface Section {
  heading: Heading;
  /** Body text of the section, excluding the heading line and nested headings' bodies. */
  body: string;
  /** Span covering the heading plus everything up to the next sibling heading. */
  span: TextSpan;
  children: Section[];
}

export interface FigureLegend {
  /** Figure number as written, e.g. "1", "2", "S3". */
  number: string;
  /** The label as written, e.g. "Fig. 1 |" or "Figure 1.". */
  label: string;
  /** The descriptive title (first sentence after the label). */
  title: string;
  /** Remaining legend text (panel descriptions, stats, scale bars). */
  body: string;
  span: TextSpan;
  /** Legend defines the dispersion measure, e.g. "data are mean ± s.e.m.". */
  definesErrorBars: boolean;
  /** Legend names the statistical test used. */
  namesStatisticalTest: boolean;
  /** Legend explains what asterisks mean, e.g. "*P < 0.05". */
  definesAsterisks: boolean;
  mentionsScaleBar: boolean;
  /** Items parsed out of a "See also Figure S1 and Table S1" trailer. */
  seeAlso: string[];
}

export interface TableCaption {
  number: string;
  title: string;
  span: TextSpan;
  isSupplemental: boolean;
}

export interface SupplementalItem {
  kind: "figure" | "table" | "video" | "data" | "scheme";
  number: string;
  title: string;
  /** Items named in a "Related to Figure 2 and STAR Methods" trailer. */
  relatedTo: string[];
  span: TextSpan;
}

export interface ReferenceEntry {
  /** 1-based position in the list (the printed number when numbered). */
  index: number;
  raw: string;
  hasYear: boolean;
  hasTitle: boolean;
  hasJournal: boolean;
  hasVolume: boolean;
  hasPages: boolean;
  hasDoi: boolean;
  authorCount: number;
  usesEtAl: boolean;
  isInPressOrUnpublished: boolean;
}

export interface Statement {
  /** The heading the statement was found under, or a synthetic label when
   * the statement was located by its wording rather than a heading. */
  headingText: string;
  text: string;
  span: TextSpan;
}

export interface Hit {
  /** The matched phrase. */
  text: string;
  /** Surrounding text, for evidence quotes. */
  context: string;
  span: TextSpan;
}

export interface Feature {
  present: boolean;
  evidence: string[];
  /**
   * For the data types a journal asks authors to deposit (RNA-seq,
   * proteomics, microarray, structures, sequences): true when the manuscript
   * GENERATED the data ("we performed", "were deposited", accession codes),
   * false when every mention is a REUSE of public data (downloaded from GEO,
   * TCGA cohorts, Kaplan-Meier Plotter, previously published). Mirrors
   * `present` for the other features. Optional because hand-built models
   * (tests, legacy adapters) predate it; consumers treat undefined as true.
   */
  generated?: boolean;
}

/** Keys of the `features` map: things a journal rule may be conditional on. */
export type FeatureKey =
  | "rnaSeq"
  | "proteomics"
  | "microarray"
  | "proteinStructure"
  | "geneSequences"
  | "novelCompounds"
  | "equations"
  | "videos"
  | "blotsOrGels"
  | "micrographs"
  | "errorBars"
  | "asterisks"
  | "vertebrates"
  | "humans"
  | "clinicalTrial"
  | "batteriesOrPV"
  | "devices"
  | "customCode"
  | "sexReported"
  | "ageReported"
  | "molecularWeightMarkers";

export interface SummaryBlock {
  headingText: string;
  text: string;
  wordCount: number;
  paragraphCount: number;
  containsCitations: boolean;
}

export interface HighlightsBlock {
  bullets: string[];
  span: TextSpan;
}

export interface ManuscriptStatements {
  leadContact?: Statement;
  materialsAvailability?: Statement;
  dataAndCodeAvailability?: Statement;
  dataAvailability?: Statement;
  codeAvailability?: Statement;
  limitations?: Statement;
  acknowledgments?: Statement;
  authorContributions?: Statement;
  declarationOfInterests?: Statement;
  aiDeclaration?: Statement;
  inclusionAndDiversity?: Statement;
  ethicsAnimal?: Statement;
  ethicsHuman?: Statement;
  informedConsent?: Statement;
  highlights?: HighlightsBlock;
  keyResourcesTable?: Statement;
  additionalResources?: Statement;
  resourceAvailability?: Statement;
}

export interface ReferencesBlock {
  headingText?: string;
  style: "numbered" | "author-year" | "unknown";
  count: number;
  entries: ReferenceEntry[];
  inTextStyle: "superscript-numeric" | "bracketed-numeric" | "author-year" | "unknown";
  /** A second, separate reference list for the supplemental material. */
  separateSupplementalList: boolean;
}

export interface StarMethodsBlock {
  /**
   * True only when the methods section is recognisably STAR-structured:
   * a heading literally named "STAR Methods", or at least two of the
   * canonical STAR group headings (RESOURCE AVAILABILITY, EXPERIMENTAL
   * MODEL AND SUBJECT DETAILS, METHOD DETAILS, QUANTIFICATION AND
   * STATISTICAL ANALYSIS, ADDITIONAL RESOURCES, KEY RESOURCES TABLE).
   * A plain "Materials and Methods" section yields present: false while
   * still reporting its headingText and subheadings.
   */
  present: boolean;
  /** The methods heading actually found, e.g. "Materials and Methods". */
  headingText?: string;
  /** Subheading texts inside the methods section, in document order. */
  headings: string[];
  hasKeyResourcesTable: boolean;
  numberedSubheadings: boolean;
  /** Deepest subheading level observed inside the methods section (0 if none). */
  subheadingDepth: number;
  tablesEmbedded: number;
  figuresEmbedded: number;
}

export interface AccessionRef {
  id: string;
  repository: string;
  span: TextSpan;
}

export interface PhraseHits {
  novelty: Hit[];
  asDescribedPreviously: Hit[];
  personalCommunication: Hit[];
}

export interface DocxFacts {
  wordTables: number;
  imagesInBody: number;
  ommlEquations: number;
  mathTypeObjects: number;
  trackedChanges: boolean;
  usesHeadingStyles: boolean;
}

export interface ManuscriptModel {
  sourceType: "pdf" | "docx" | "text";
  fileName?: string;
  /** Cleaned, normalised full text. Every span indexes into this string. */
  text: string;
  pageCount?: number;
  wordCount: number;

  title?: string;
  authorsLine?: string;
  affiliations: string[];
  correspondingEmails: string[];
  hasLeadContactFootnote: boolean;

  summary?: SummaryBlock;

  outline: Heading[];
  sections: Section[];

  figureLegends: FigureLegend[];
  /** Legend blocks sit inside Results/Discussion rather than in one trailing list. */
  legendsInterspersed: boolean;
  /** All legends appear after the main text, as one list. */
  legendsAfterMainText: boolean;
  tableCaptions: TableCaption[];
  supplementalItems: SupplementalItem[];
  /** Distinct supplemental labels referenced from the text, e.g. "Figure S1". */
  supplementalMentions: string[];

  references: ReferencesBlock;
  statements: ManuscriptStatements;
  starMethods: StarMethodsBlock;
  features: Record<FeatureKey, Feature>;
  accessions: AccessionRef[];
  phraseHits: PhraseHits;
  docx?: DocxFacts;
}

export interface BuildModelInput {
  buffer?: Buffer;
  text?: string;
  fileName?: string;
  mimeType?: string;
}
