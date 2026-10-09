/**
 * iScience journal profile: every row of the editor's pre-accept checklist
 * encoded as a FormatCheck, ordered like the spreadsheet so the assembled letter
 * reads like the hand-made one. Rules follow the iScience Final File
 * Requirements (FFC); where the spreadsheet and the FFC disagree (title length,
 * citation style) the FFC wins and the comment says so.
 *
 * This file holds the main-document checks (rows 3-43 plus FFC extras); the
 * STAR Methods / Resource Availability / data / KRT checks (rows 44-72) are in
 * ./iscience-star.ts and appended here.
 */

import type { FormatCheck, JournalProfile } from "../profile";
import { sectionOrderCheck } from "../profile";
import { ISCIENCE_PHRASES } from "./iscience-phrases";
import { clipText, def, hasMethods, manual, rule } from "./iscience-def";
import {
  asDescribedPreviouslyCheck,
  asterisksCheck,
  ethicsCheck,
  inPressCheck,
  inTextCitationCheck,
  legendsAttributeCheck,
  legendsListCheck,
  noveltyCheck,
  personalCommunicationCheck,
  referenceEntriesCheck,
  resultsSubheadingsCheck,
  seeAlsoCheck,
  summaryFramingCheck,
  summaryHeadingCheck,
  summaryLengthCheck,
  statisticalTestsPresent,
  titleCheck,
  highlightsCheck,
} from "./shared-rules";
import {
  ISCIENCE_SECTION_ORDER,
  acknowledgmentsCheck,
  aiDeclarationApplies,
  aiDeclarationCheck,
  authorContributionsCheck,
  correspondingEmailCheck,
  declarationOfInterestsCheck,
  equationsCheck,
  excelTablesApply,
  excelTablesCheck,
  featureReminder,
  fileIsWordCheck,
  inclusionDiversityCheck,
  leadContactFootnoteCheck,
  limitationsCheck,
  separateFiguresCheck,
  supplementalFigureCountCheck,
  supplementalTitlesCheck,
  tablesApply,
  tablesFormatCheck,
  videosCheck,
} from "./iscience-rules";
import { starChecks } from "./iscience-star";

export const ISCIENCE_LETTER_PREAMBLE =
  "Please pay particular attention to the following points, and use the tracked changes feature of Microsoft Word to make changes to the manuscript:";

export const mainChecks: FormatCheck[] = [
  def("file.word", {
    category: "file", severity: "required",
    guideline: "The main document must be provided as a modifiable electronic file in a PC-compatible format (preferably a Word file).",
    detector: rule(fileIsWordCheck),
  }),
  // Spreadsheet says 150 characters / 12 words; the FFC says 145 characters. FFC wins; the phrase keeps its own 15-word wording.
  def("title.length", {
    category: "title_page", severity: "required",
    guideline: "The title should contain no more than 145 characters, including spaces (FFC); the letter asks for at most 15 words and no punctuation.",
    detector: rule((m) => titleCheck(m, { maxChars: 145, maxWords: 15, forbidPunctuation: /[:;?!]/ })),
  }),
  def("title.lead_contact_footnote", {
    category: "title_page", severity: "required",
    question: "Is the Lead Contact footnote missing from the author list?",
    guideline: "All manuscripts must indicate a Lead Contact on the title page; the Lead Contact should be designated with a footnote in the author list.",
    detector: rule(leadContactFootnoteCheck), sourceRef: "FFC title page",
  }),
  def("title.corresponding_email", {
    category: "title_page", severity: "required",
    question: "Is the corresponding author's e-mail address missing from the title page?",
    guideline: "An email address should be included for each corresponding author.",
    detector: rule(correspondingEmailCheck), sourceRef: "FFC title page",
  }),
  def("summary.editor_edits", {
    category: "summary", severity: "info",
    guideline: "Editors may lightly edit the Summary; the authors must check the edits.",
    detector: manual,
  }),
  def("summary.heading", {
    category: "summary", severity: "required",
    question: 'Is the summary section titled something other than "Summary" (e.g. "Abstract")?',
    guideline: 'The main document must include a "Summary" section (not "Abstract").',
    detector: rule((m) => summaryHeadingCheck(m, "Summary")), sourceRef: "FFC main document sections",
  }),
  def("summary.length", {
    category: "summary", severity: "required",
    guideline: "The Summary should consist of a single paragraph of 150 words or fewer, without references.",
    detector: rule((m) => summaryLengthCheck(m, 150, { singleParagraph: true, noCitations: true })),
  }),
  def("summary.framing", {
    category: "summary", severity: "required",
    question: 'Does the summary say a process "remains unclear" / "is poorly understood", or make novelty claims?',
    guideline: "The Summary should avoid statements about how a process is not well understood and novelty claims (e.g. the word novel).",
    detector: rule(summaryFramingCheck), phrase: ISCIENCE_PHRASES["summary.length"], sourceRef: "pre-accept checklist row 6",
  }),
  def("summary.content", {
    category: "summary", severity: "recommended",
    question: "Does the summary lack background, a description of results/approach, or an indication of broader significance?",
    guideline: "The Summary should include (1) a brief background, (2) a description of the results and approaches framed by their conceptual interest and (3) the broader significance of the work.",
    phrase: ISCIENCE_PHRASES["summary.length"], sourceRef: "pre-accept checklist row 6",
    detector: {
      kind: "llm",
      prompt: (m) => m.summary ? {
        instructions: "Decide whether this Summary contains all three required elements: (1) a brief background of the question, (2) a description of the results and of the approaches or model systems, framed in the context of their conceptual interest, and (3) an indication of the broader significance of the work. Fail only when an element is clearly absent; use review when an element is implicit.",
        excerpt: m.summary.text,
      } : null,
    },
  }),
  def("sections.order", {
    category: "sections", severity: "required",
    guideline: "Sections in this order: title; authors and affiliations; Lead Contact footnote; corresponding e-mail; Summary; Introduction; Results; Discussion; Resource Availability; Limitations of the Study; Acknowledgments; Author Contributions; Declaration of Interests; figure legends; tables; STAR Methods; supplemental titles; References.",
    detector: rule((m) => sectionOrderCheck(m, ISCIENCE_SECTION_ORDER)),
  }),
  def("sections.limitations", {
    category: "sections", severity: "required",
    guideline: 'Include a paragraph entitled "Limitations of the study" that highlights potential caveats of the work.',
    detector: rule(limitationsCheck),
  }),
  def("body.novelty", {
    category: "body", severity: "recommended",
    guideline: 'The words "new" or "novel" should not be used as priority claims or to refer to chemical compounds or structures.',
    detector: rule((m) => noveltyCheck(m, 3)),
  }),
  def("body.results_subheadings", {
    category: "body", severity: "recommended",
    guideline: "The Results section should be divided with subheadings.",
    detector: rule(resultsSubheadingsCheck),
  }),
  def("body.personal_communication", {
    category: "body", severity: "recommended",
    guideline: "Unpublished data, submitted manuscripts, abstracts and personal communications should be cited within the text only.",
    detector: rule(personalCommunicationCheck),
  }),
  def("tables.format", {
    category: "tables", severity: "required",
    guideline: "Tables should be editable Word tables with a title, not separated into panels (Table 1, Table 2, not Table 1A, 1B), without merged cells, colours or shading.",
    appliesWhen: tablesApply, detector: rule(tablesFormatCheck),
  }),
  def("body.nomenclature", {
    category: "body", severity: "recommended",
    guideline: "Chemical nomenclature must conform to IUPAC and gene nomenclature to HUGO, MGI, FlyBase, WormBase, SGI or other oversight organisations.",
    detector: {
      kind: "llm",
      prompt: (m) => ({
        instructions: "Check gene, protein and chemical names for conformity with HUGO/MGI/FlyBase/WormBase/SGD and IUPAC conventions: human gene symbols in italic upper case, mouse gene symbols italic with an initial capital, proteins upright, consistent capitalisation of the same gene across the text, systematic or accepted chemical names. Italics are not visible in this plain text, so judge only capitalisation and consistency. Pass when no inconsistency is apparent; review when a few names are inconsistent; fail only for systematic non-conformity.",
        excerpt: clipText(`${m.summary?.text ?? ""}\n\n${m.text.slice(0, 6000)}`, 7000),
      }),
    },
  }),
  def("associated.highlights", {
    category: "associated_files", severity: "required",
    guideline: "Highlights are 3-4 bullet points of no more than 85 characters each, uploaded as a separate Word document.",
    detector: rule(highlightsCheck),
  }),
  def("associated.graphical_abstract", {
    category: "associated_files", severity: "recommended",
    guideline: "Graphical abstract: an exact square, 1200 x 1200 pixels at 300 dpi (TIFF, PDF or JPG).",
    detector: manual,
  }),
  def("supplemental.figure_count", {
    category: "supplemental", severity: "recommended",
    guideline: "We recommend that you do not exceed 20 supplemental figures per paper; the supplemental PDF should not include the title, author list or page numbers.",
    detector: rule((m) => supplementalFigureCountCheck(m, 20)),
  }),
  def("supplemental.related_to", {
    category: "supplemental", severity: "required",
    guideline: 'Supplemental item titles should reference a main item or the STAR Methods, e.g. "Table S1. [Title], Related to Figure 1".',
    appliesWhen: (m) => m.supplementalItems.length > 0 || m.supplementalMentions.length > 0,
    detector: rule(supplementalTitlesCheck),
  }),
  def("star.as_described_previously", {
    category: "star_methods", severity: "required",
    guideline: "Report methods with sufficient detail so readers do not need to refer to other papers; avoid \"as described previously\".",
    appliesWhen: hasMethods, detector: rule(asDescribedPreviouslyCheck),
  }),
  def("ethics.vertebrates", {
    category: "ethics", severity: "required",
    guideline: "Animal work: name the approving committee, confirm compliance with regulations, and report the sex and age/developmental stage of subjects.",
    appliesWhen: (m) => m.features.vertebrates.present, detector: rule((m) => ethicsCheck(m, "animal")),
  }),
  def("ethics.humans", {
    category: "ethics", severity: "required",
    guideline: "Human work: name the approving committee, confirm informed consent, and report sex and/or gender and age of participants.",
    appliesWhen: (m) => m.features.humans.present, detector: rule((m) => ethicsCheck(m, "human")),
  }),
  def("references.in_text", {
    category: "references", severity: "required",
    question: "Are references cited other than by superscript numbers?",
    guideline: "References must be cited by superscript numbers running consecutively in the text.",
    detector: rule((m) => inTextCitationCheck(m, "superscript-numeric", "superscript numbers")), sourceRef: "FFC citations/references",
  }),
  def("references.entries", {
    category: "references", severity: "required",
    guideline: "Article references should include the author list, year, article title, journal abbreviation, volume, page range and DOI (fails when fewer than 80% of entries carry a DOI).",
    detector: rule((m) => referenceEntriesCheck(m, { requireDoi: true, doiThreshold: 0.8 })),
  }),
  def("references.in_press", {
    category: "references", severity: "required",
    question: "Does the reference list contain in-press, submitted or unpublished items?",
    guideline: "References should include only articles that are published or in press.",
    detector: rule(inPressCheck), sourceRef: "FFC citations/references",
  }),
  def("statements.acknowledgments", {
    category: "statements", severity: "required",
    guideline: "The Acknowledgments section should list funding sources with all grant numbers.",
    detector: rule(acknowledgmentsCheck),
  }),
  def("statements.author_contributions", {
    category: "statements", severity: "required",
    guideline: "A dedicated Author Contributions section is required, placed immediately after the Acknowledgments.",
    detector: rule(authorContributionsCheck),
  }),
  def("statements.declaration_of_interests", {
    category: "statements", severity: "required",
    guideline: 'Declarations must be included in a section titled "Declaration of Interests" preceding the References.',
    detector: rule(declarationOfInterestsCheck),
  }),
  def("statements.ai_declaration", {
    category: "statements", severity: "required",
    question: "Was generative AI used in the writing without a declaration after the Declaration of Interests?",
    guideline: 'If generative AI was used in the writing process, add a "Declaration of generative AI and AI-assisted technologies in the manuscript preparation process" after the Declaration of Interests.',
    appliesWhen: aiDeclarationApplies, detector: rule(aiDeclarationCheck), sourceRef: "FFC associated files and forms",
  }),
  def("figures.separate_files", {
    category: "figures", severity: "required",
    guideline: "Main figures should be uploaded individually as separate high-resolution TIFF or PDF files and not included in the main document.",
    detector: rule(separateFiguresCheck),
  }),
  def("figures.legends_list", {
    category: "figures", severity: "required",
    question: 'Are the figure legends interspersed in the text or titled other than "Figure 1. [Title]"?',
    guideline: 'Include the legends as one list after the main text, not interspersed; figures require a descriptive title (e.g., "Figure 1. [Title]").',
    detector: rule((m) => legendsListCheck(m, /^Figure\s+\d+\.?$/i, "Figure 1.")), sourceRef: "FFC main document / main-text items",
  }),
  def("figures.see_also", {
    category: "figures", severity: "recommended",
    question: 'Do the legends lack "See also" cross-references to supplemental items?',
    guideline: 'Figure, table and scheme legends should reference related supplemental items, e.g. "See also Figure S1 and Table S1."',
    detector: rule(seeAlsoCheck), sourceRef: "FFC main-text items",
  }),
  def("figures.error_bars", {
    category: "figures", severity: "required",
    guideline: 'For any figures presenting pooled data and/or error bars, the measures should be defined in the figure legends (e.g. "Data are represented as mean ± SEM").',
    appliesWhen: (m) => m.features.errorBars.present, detector: rule((m) => legendsAttributeCheck(m, "definesErrorBars", "define the error bars")),
  }),
  def("figures.asterisks", {
    category: "figures", severity: "required",
    guideline: "Where statistical tests are presented as asterisks, define them in each relevant legend together with the name of the test.",
    appliesWhen: statisticalTestsPresent, detector: rule(asterisksCheck),
  }),
  def("figures.scale_bars", {
    category: "figures", severity: "required",
    guideline: "Figures containing micrographs should include scale bars and the legends should state their size.",
    appliesWhen: (m) => m.features.micrographs.present, detector: rule((m) => legendsAttributeCheck(m, "mentionsScaleBar", "mention the scale bar", { minimumOne: true })),
  }),
  def("figures.blot_markers", {
    category: "figures", severity: "required",
    guideline: "Blots and gels must show the locations of molecular weight/size markers; at least one marker position must be present.",
    appliesWhen: (m) => m.features.blotsOrGels.present,
    detector: rule((m) => m.features.molecularWeightMarkers.present
      ? { status: "pass", summary: "Molecular weight markers mentioned for blots/gels", evidence: m.features.molecularWeightMarkers.evidence.slice(0, 2).map((q) => ({ quote: q })), confidence: "medium" }
      : { status: "fail", summary: "Blots/gels present but no mention of molecular weight/size markers", evidence: m.features.blotsOrGels.evidence.slice(0, 2).map((q) => ({ quote: q })), confidence: "medium" }),
  }),
  def("body.novel_compounds", {
    category: "body", severity: "required",
    guideline: "Structurally novel compounds must be characterised according to the journal's requirements.",
    appliesWhen: (m) => m.features.novelCompounds.present,
    detector: rule(featureReminder("novelCompounds", "Novel compounds reported; check the characterisation data against the journal requirements")),
  }),
  def("body.equations", {
    category: "body", severity: "required",
    guideline: "Equations should be created with OMML (or MathType); they must not be submitted as images.",
    appliesWhen: (m) => m.features.equations.present, detector: rule(equationsCheck),
  }),
  def("supplemental.excel_tables", {
    category: "supplemental", severity: "required",
    guideline: "Supplemental tables exceeding 3 pages should be provided as Excel files, with titles and legends in the main document after the STAR Methods.",
    appliesWhen: excelTablesApply, detector: rule(excelTablesCheck),
  }),
  def("supplemental.videos", {
    category: "supplemental", severity: "required",
    guideline: 'Supplemental videos: separate .mov/.avi/.mpg/.mp4 files; titles with "Related to" information and legends in the main document after the STAR Methods.',
    appliesWhen: (m) => m.features.videos.present || m.supplementalItems.some((i) => i.kind === "video"), detector: rule(videosCheck),
  }),
  def("associated.star_protocols", {
    category: "associated_files", severity: "info",
    guideline: "Optional: consider submitting a protocol to STAR Protocols.",
    detector: manual,
  }),
  def("statements.inclusion_diversity", {
    category: "statements", severity: "recommended",
    guideline: "An Inclusion and diversity statement based on the Cell Press form.",
    detector: rule(inclusionDiversityCheck),
  }),
  def("body.batteries_pv", {
    category: "body", severity: "required",
    guideline: "Battery and photovoltaic papers must complete the Cell Press reporting checklist.",
    appliesWhen: (m) => m.features.batteriesOrPV.present,
    detector: rule(featureReminder("batteriesOrPV", "Battery/photovoltaic work detected; the reporting checklist must be completed", "fail")),
  }),
  def("body.devices", {
    category: "body", severity: "required",
    guideline: "Papers on new devices must report results for all devices produced (at least three) with means and standard deviations.",
    appliesWhen: (m) => m.features.devices.present,
    detector: rule(featureReminder("devices", "New devices reported; check that results for all devices (at least three) with mean and SD are given")),
  }),
];

export const iscienceProfile: JournalProfile = {
  id: "iscience",
  name: "iScience",
  family: "Cell Press",
  version: "2026.10",
  sourceUrls: ["https://www.cell.com/iscience/authors", "https://www.cell.com/star-methods"],
  letterPreamble: ISCIENCE_LETTER_PREAMBLE,
  sectionOrder: ISCIENCE_SECTION_ORDER.map((s) => s.slot),
  checks: [...mainChecks, ...starChecks],
};
