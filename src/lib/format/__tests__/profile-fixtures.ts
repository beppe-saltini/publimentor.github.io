/**
 * Synthetic ManuscriptModel builders for the profile/evaluator tests.
 * Nothing here comes from a real manuscript.
 */

import type { FigureLegend, Heading, ManuscriptModel, Section, Statement, SupplementalItem, ReferenceEntry } from "../manuscript-model";
import { blankModel, normalizeHeading } from "../profile";

export function makeModel(overrides: Partial<ManuscriptModel> = {}): ManuscriptModel {
  return blankModel({ sourceType: "docx", wordCount: 5000, ...overrides });
}

/** A heading at a given offset; the span covers the heading text. */
export function heading(text: string, start: number, level: 1 | 2 | 3 = 1): Heading {
  return { text, normalized: normalizeHeading(text), level, span: { start, end: start + text.length } };
}

export function section(text: string, start: number, body = "", children: Section[] = [], level: 1 | 2 | 3 = 1): Section {
  const h = heading(text, start, level);
  return { heading: h, body, span: { start, end: start + text.length + body.length + 1 }, children };
}

export function statement(headingText: string, text: string, start = 0): Statement {
  return { headingText, text, span: { start, end: start + text.length } };
}

export function legend(number: string, overrides: Partial<FigureLegend> = {}): FigureLegend {
  return {
    number,
    label: `Figure ${number}.`,
    title: `Title of figure ${number}`,
    body: "",
    span: { start: 0, end: 10 },
    definesErrorBars: false,
    namesStatisticalTest: false,
    definesAsterisks: false,
    mentionsScaleBar: false,
    seeAlso: [],
    ...overrides,
  };
}

export function supplemental(kind: SupplementalItem["kind"], number: string, overrides: Partial<SupplementalItem> = {}): SupplementalItem {
  return { kind, number, title: `Supplemental ${kind} ${number}`, relatedTo: [], span: { start: 0, end: 0 }, ...overrides };
}

export function reference(index: number, overrides: Partial<ReferenceEntry> = {}): ReferenceEntry {
  return {
    index,
    raw: `${index}. Doe, J. (2020). A title. J. Test 1, 1-10.`,
    hasYear: true,
    hasTitle: true,
    hasJournal: true,
    hasVolume: true,
    hasPages: true,
    hasDoi: true,
    authorCount: 1,
    usesEtAl: false,
    isInPressOrUnpublished: false,
    ...overrides,
  };
}

/** Build model.text from labelled blocks and return the text plus each block's offset. */
export function layout(blocks: Array<[key: string, text: string]>): { text: string; at: Record<string, number> } {
  let text = "";
  const at: Record<string, number> = {};
  for (const [key, block] of blocks) {
    at[key] = text.length;
    text += `${block}\n`;
  }
  return { text, at };
}

/** A complete, well-formed iScience-style manuscript model used as the "all green" baseline. */
export function compliantIscienceModel(): ManuscriptModel {
  const summaryText = "Background sentence. Here we show results with an approach. This matters broadly.";
  const { text, at } = layout([
    ["title", "A short title without punctuation"],
    ["summary", `Summary\n${summaryText}`],
    ["intro", "Introduction\nIntro text."],
    ["results", "Results\nSubheading one\nText.\nSubheading two\nText."],
    ["discussion", "Discussion\nDiscussion text."],
    ["resource", "Resource Availability\nLead Contact\nFurther information should be directed to Jane Doe (jane@example.org).\nMaterials Availability\nThis study did not generate new unique reagents.\nData and Code Availability\n• RNA-seq data have been deposited at GEO (GSE00001) and are listed in the key resources table.\n• This paper does not report original code.\n• Any additional information is available from the lead contact."],
    ["limitations", "Limitations of the study\nSome caveats."],
    ["ack", "Acknowledgments\nFunded by grant 12345."],
    ["contrib", "Author Contributions\nJ.D. did everything."],
    ["doi", "Declaration of Interests\nThe authors declare no competing interests."],
    ["legends", "Figure 1. Title one. Data are mean ± SEM; *p < 0.05 by t-test. Scale bars, 10 µm. See also Figure S1."],
    ["star", "STAR Methods\nKEY RESOURCES TABLE\nREAGENT or RESOURCE\nAntibodies\nDeposited data\nRNA-seq GSE00001\nRESOURCE AVAILABILITY\nEXPERIMENTAL MODEL AND SUBJECT DETAILS\nMice\nFemale mice aged 8 weeks, approved by the IACUC.\nMETHOD DETAILS\nQUANTIFICATION AND STATISTICAL ANALYSIS\nStatistics\nt-tests, n = 3 mice, mean ± SEM, GraphPad Prism."],
    ["suppl", "Figure S1. Supplemental title, Related to Figure 1"],
    ["refs", "References\n1. Doe, J. (2020). A title. J. Test 1, 1-10. https://doi.org/10.1000/x."],
  ]);
  const h = (key: string, label: string, level: 1 | 2 | 3 = 1) => heading(label, at[key], level);
  const outline: Heading[] = [
    h("summary", "Summary"), h("intro", "Introduction"), h("results", "Results"), h("discussion", "Discussion"),
    h("resource", "Resource Availability"), h("limitations", "Limitations of the study"), h("ack", "Acknowledgments"),
    h("contrib", "Author Contributions"), h("doi", "Declaration of Interests"), h("star", "STAR Methods"), h("refs", "References"),
  ];
  const resultsSection = section("Results", at.results, "", [section("Subheading one", at.results + 8, "Text.", [], 2), section("Subheading two", at.results + 30, "Text.", [], 2)]);
  const statsStart = text.indexOf("QUANTIFICATION AND STATISTICAL ANALYSIS");
  const statsSection = section("QUANTIFICATION AND STATISTICAL ANALYSIS", statsStart, "Statistics\nt-tests, n = 3 mice, mean ± SEM, GraphPad Prism.", [], 2);
  const starSection = section("STAR Methods", at.star, "methods body", [statsSection]);
  const st = (key: string, label: string, body: string) => statement(label, body, at[key] + label.length + 1);
  return makeModel({
    sourceType: "docx",
    text,
    title: "A short title without punctuation",
    correspondingEmails: ["jane@example.org"],
    hasLeadContactFootnote: true,
    summary: { headingText: "Summary", text: summaryText, wordCount: 13, paragraphCount: 1, containsCitations: false },
    outline,
    sections: [section("Summary", at.summary, summaryText), resultsSection, starSection],
    figureLegends: [legend("1", { span: { start: at.legends, end: at.legends + 60 }, definesErrorBars: true, namesStatisticalTest: true, definesAsterisks: true, mentionsScaleBar: true, seeAlso: ["Figure S1"] })],
    legendsInterspersed: false,
    legendsAfterMainText: true,
    supplementalItems: [supplemental("figure", "S1", { title: "Supplemental title", relatedTo: ["Figure 1"], span: { start: at.suppl, end: at.suppl + 50 } })],
    supplementalMentions: ["Figure S1"],
    references: { headingText: "References", style: "numbered", count: 1, entries: [reference(1)], inTextStyle: "superscript-numeric", separateSupplementalList: false },
    statements: {
      resourceAvailability: st("resource", "Resource Availability", "Lead Contact..."),
      leadContact: statement("Lead Contact", "Further information should be directed to Jane Doe (jane@example.org).", text.indexOf("Further information")),
      materialsAvailability: statement("Materials Availability", "This study did not generate new unique reagents.", text.indexOf("This study did not")),
      dataAndCodeAvailability: statement("Data and Code Availability", text.slice(text.indexOf("• RNA-seq"), text.indexOf("Limitations of the study")), text.indexOf("• RNA-seq")),
      limitations: st("limitations", "Limitations of the study", "Some caveats."),
      acknowledgments: st("ack", "Acknowledgments", "Funded by grant 12345."),
      authorContributions: st("contrib", "Author Contributions", "J.D. did everything."),
      declarationOfInterests: st("doi", "Declaration of Interests", "The authors declare no competing interests."),
      ethicsAnimal: statement("Mice", "Female mice aged 8 weeks, approved by the IACUC.", text.indexOf("Female mice")),
      keyResourcesTable: statement("KEY RESOURCES TABLE", "REAGENT or RESOURCE\nAntibodies\nDeposited data\nRNA-seq GSE00001", text.indexOf("KEY RESOURCES TABLE")),
      inclusionAndDiversity: statement("Inclusion and diversity", "We support inclusive science.", 0),
    },
    starMethods: {
      present: true,
      headingText: "STAR Methods",
      headings: ["KEY RESOURCES TABLE", "RESOURCE AVAILABILITY", "EXPERIMENTAL MODEL AND SUBJECT DETAILS", "Mice", "METHOD DETAILS", "QUANTIFICATION AND STATISTICAL ANALYSIS", "Statistics"],
      hasKeyResourcesTable: true,
      numberedSubheadings: false,
      subheadingDepth: 2,
      tablesEmbedded: 0,
      figuresEmbedded: 0,
    },
    features: {
      ...makeModel().features,
      rnaSeq: { present: true, evidence: ["RNA-seq"] },
      errorBars: { present: true, evidence: ["mean ± SEM"] },
      asterisks: { present: true, evidence: ["*p < 0.05"] },
      micrographs: { present: true, evidence: ["Scale bars"] },
      vertebrates: { present: true, evidence: ["mice"] },
      sexReported: { present: true, evidence: ["Female mice"] },
      ageReported: { present: true, evidence: ["aged 8 weeks"] },
    },
    accessions: [{ id: "GSE00001", repository: "GEO", span: { start: text.indexOf("GSE00001"), end: text.indexOf("GSE00001") + 8 } }],
    docx: { wordTables: 0, imagesInBody: 0, ommlEquations: 0, mathTypeObjects: 0, trackedChanges: false, usesHeadingStyles: true },
  });
}
