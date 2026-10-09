/**
 * Synthetic Nature-style manuscript model for formatter tests. Nothing here
 * comes from a real paper. `makeModel` returns a complete ManuscriptModel so
 * tests can override single fields.
 */
import type { FigureLegend, ManuscriptModel, ReferenceEntry, Section, Statement, SupplementalItem } from "@/lib/format/manuscript-model";

let cursor = 0;
function span(len = 200) {
  const s = { start: cursor, end: cursor + len };
  cursor += len + 1;
  return s;
}

export function section(text: string, body: string, children: Section[] = [], level: 1 | 2 | 3 = 1): Section {
  const sp = span(body.length + text.length + 2);
  return { heading: { text, normalized: text.toLowerCase(), level, span: { start: sp.start, end: sp.start + text.length } }, body, span: sp, children };
}

export function statement(headingText: string, text: string): Statement {
  return { headingText, text, span: span(text.length) };
}

export function legend(number: string, title: string, body: string, extra: Partial<FigureLegend> = {}): FigureLegend {
  return { number, label: `Fig. ${number} |`, title, body, span: span(body.length), definesErrorBars: false, namesStatisticalTest: false, definesAsterisks: false, mentionsScaleBar: false, seeAlso: [], ...extra };
}

export function suppl(kind: SupplementalItem["kind"], number: string, title: string, relatedTo: string[] = []): SupplementalItem {
  return { kind, number, title, relatedTo, span: span(title.length) };
}

export function ref(index: number, raw: string, extra: Partial<ReferenceEntry> = {}): ReferenceEntry {
  return { index, raw, hasYear: /\(\d{4}\)/.test(raw), hasTitle: true, hasJournal: true, hasVolume: /\d+,/.test(raw), hasPages: /\d+[–-]\d+/.test(raw), hasDoi: /10\.\d{4}/.test(raw), authorCount: 3, usesEtAl: /et al/.test(raw), isInPressOrUnpublished: false, ...extra };
}

/** Every FeatureKey of the manuscript model (see parse/model-types.ts). */
const FEATURE_KEYS = ["rnaSeq", "proteomics", "microarray", "proteinStructure", "geneSequences", "novelCompounds", "equations", "videos", "blotsOrGels", "micrographs", "errorBars", "asterisks", "vertebrates", "humans", "clinicalTrial", "batteriesOrPV", "devices", "customCode", "sexReported", "ageReported", "molecularWeightMarkers"] as const;

export function features(present: string[] = []): ManuscriptModel["features"] {
  const out: Record<string, { present: boolean; evidence: string[] }> = {};
  for (const k of FEATURE_KEYS) out[k] = { present: present.includes(k), evidence: present.includes(k) ? ["synthetic"] : [] };
  return out as unknown as ManuscriptModel["features"];
}

export const SAMPLE_REFS = [
  "1. Doe, J., Roe, R. & Poe, E.A. Widgets regulate gadget assembly in cells. Nat Widget Biol 12, 100–110 (2021).",
  "2. Smith, A.B. et al. A survey of sprocket biology. J Sprocket Res 3, 55–60 (2019).",
  "3. Lee, K. Unpublished observations on cogs. Cog Lett (2024).",
];

const METHODS_TEXT =
  "4T1 cells (ATCC CRL-2539) were cultured in RPMI. HEK293T cells were obtained from ATCC.\n\n" +
  "Female BALB/c mice (6–8 weeks, Vital River) were housed under SPF conditions. All procedures were approved by the IACUC.\n\n" +
  "Cells were stained with anti-CD8 (clone 53-6.7, BioLegend, Cat# 100708) and anti-CD4 antibody (BioLegend, Cat# 100412). pLKO.1 (Addgene #8453) was used for knockdown. Analyses used GraphPad Prism v9 and FlowJo v10.8.";

/** A Nature-style manuscript with the usual back-matter headings. */
export function makeModel(overrides: Partial<ManuscriptModel> = {}): ManuscriptModel {
  cursor = 0;
  const abstract = section("Abstract", "Widgets matter. Here we show that widgets regulate gadgets in vivo (Fig. 1a). This has implications for sprockets.");
  const intro = section("Introduction", "Widgets have long been studied1,2. Gadgets too (Fig. 1b; Supplementary Fig. 1a).");
  const results = section("Results", "", [section("Widgets control gadgets", "Widget overexpression increased gadget output (Fig. 1c,d; Supplementary Fig. 1b). n = 4 mice per group.", [], 2), section("Sprockets are dispensable", "Sprocket loss had no effect (Fig. 2a). Primer sequences are in Supplementary Table 1.", [], 2)]);
  const discussion = section("Discussion", "Our findings show widgets amplify gadget output. Limitations include the single model used.");
  const methods = section("Methods", "", [
    section("Cell culture", METHODS_TEXT.split("\n\n")[0], [], 2),
    section("Mice", METHODS_TEXT.split("\n\n")[1], [], 2),
    section("Flow cytometry and plasmids", METHODS_TEXT.split("\n\n")[2], [], 2),
    section("Statistical analysis", "Two-tailed t tests were used. P < 0.05 was significant. Analyses used GraphPad Prism v9.", [], 2),
    section("Data availability", "RNA sequencing data have been deposited at GEO under accession GSE12345.", [], 2),
    section("Code availability", "This study did not generate original code.", [], 2),
  ]);
  const ack = section("Acknowledgements", "We thank the core facility. Supported by grant 12345.");
  const contrib = section("Author contributions", "A.B. designed experiments. C.D. wrote the paper.");
  const competing = section("Competing interests", "The authors declare no competing interests.");
  const addInfo = section("Additional information", "Correspondence and requests for materials should be addressed to Jane Doe (jane@example.org).");
  const suppInfo = section("Supplementary information", "Supplementary Fig. 1. Widgets in detail.\nSupplementary Table 1. Primer sequences.");
  const refs = section("References", SAMPLE_REFS.join("\n"));
  const sections = [abstract, intro, results, discussion, methods, ack, contrib, competing, addInfo, suppInfo, refs];
  const text = sections.map((s) => `${s.heading.text}\n${s.body}\n${s.children.map((c) => `${c.heading.text}\n${c.body}`).join("\n")}`).join("\n\n");

  return {
    sourceType: "pdf",
    fileName: "widgets-paper.pdf",
    text,
    pageCount: 12,
    wordCount: text.split(/\s+/).length,
    title: "Widgets regulate gadget assembly in vivo",
    authorsLine: "Jane Doe1*, John Roe2, Edgar A. Poe1",
    affiliations: ["1 Department of Widgetry, Example University, Springfield, IL 62701, USA", "2 Gadget Institute, Metropolis, 10001, USA"],
    correspondingEmails: ["jane@example.org"],
    hasLeadContactFootnote: false,
    summary: { headingText: "Abstract", text: abstract.body, wordCount: abstract.body.split(/\s+/).length, paragraphCount: 1, containsCitations: false },
    outline: sections.map((s) => s.heading),
    sections,
    figureLegends: [legend("1", "Widgets control gadgets.", "a, Schematic. b–d, Gadget output; n = 4 mice. Data are mean ± SEM; two-tailed t test, *P < 0.05.", { definesErrorBars: true, namesStatisticalTest: true, definesAsterisks: true }), legend("2", "Sprockets are dispensable.", "a, Sprocket loss. n = 3.")],
    legendsInterspersed: true,
    legendsAfterMainText: false,
    tableCaptions: [],
    supplementalItems: [suppl("figure", "1", "Supplementary Fig. 1. Widgets in detail."), suppl("table", "1", "Supplementary Table 1. Primer sequences.")],
    supplementalMentions: ["Supplementary Fig. 1a", "Supplementary Fig. 1b", "Supplementary Table 1"],
    references: { headingText: "References", style: "numbered", count: 3, entries: SAMPLE_REFS.map((r, i) => ref(i + 1, r, i === 2 ? { isInPressOrUnpublished: true, hasVolume: false, hasPages: false } : {})), inTextStyle: "superscript-numeric", separateSupplementalList: false },
    statements: {
      dataAvailability: statement("Data availability", "RNA sequencing data have been deposited at GEO under accession GSE12345."),
      codeAvailability: statement("Code availability", "This study did not generate original code."),
      acknowledgments: statement("Acknowledgements", ack.body),
      authorContributions: statement("Author contributions", contrib.body),
      declarationOfInterests: statement("Competing interests", competing.body),
    },
    starMethods: { present: false, headingText: "Methods", headings: methods.children.map((c) => c.heading.text), hasKeyResourcesTable: false, numberedSubheadings: false, subheadingDepth: 1, tablesEmbedded: 0, figuresEmbedded: 0 },
    features: features(["vertebrates", "errorBars", "asterisks", "rnaSeq"]),
    accessions: [{ id: "GSE12345", repository: "GEO", span: span(8) }],
    phraseHits: {} as ManuscriptModel["phraseHits"],
    ...overrides,
  } as ManuscriptModel;
}
