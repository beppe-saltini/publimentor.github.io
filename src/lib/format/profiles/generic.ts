/**
 * Generic journal profile: a sensible default for journals without a dedicated
 * profile, so the editor still gets a useful checklist (abstract length, IMRaD
 * structure, references, ethics, data, competing interests, funding, author
 * contributions). Phrases are neutral so they can be pasted into any letter.
 */

import type { ManuscriptModel } from "../manuscript-model";
import type { FormatCheck, JournalProfile, OrderSlot, RuleOutcome } from "../profile";
import { pass, fail, sectionOrderCheck } from "../profile";
import {
  METHODS_ALIASES,
  RESULTS_ALIASES,
  SUMMARY_ALIASES,
  ethicsCheck,
  inPressCheck,
  noveltyCheck,
  personalCommunicationCheck,
  referenceEntriesCheck,
  statementCheck,
  statementSpan,
  summaryLengthCheck,
  titleCheck,
} from "./shared-rules";

export const GENERIC_LETTER_PREAMBLE =
  "Please pay particular attention to the following points, and use the tracked changes feature of Microsoft Word to make changes to the manuscript:";

const GENERIC_SECTION_ORDER: readonly OrderSlot[] = [
  { slot: "Abstract", aliases: SUMMARY_ALIASES },
  { slot: "Introduction", aliases: ["introduction", "background"] },
  { slot: "Methods", aliases: METHODS_ALIASES, optional: true },
  { slot: "Results", aliases: RESULTS_ALIASES },
  { slot: "Discussion", aliases: ["discussion", "results and discussion", "conclusions", "conclusion"] },
  { slot: "References", aliases: ["references", "bibliography", "literature cited"] },
];

const rule = (evaluate: (m: ManuscriptModel) => RuleOutcome): FormatCheck["detector"] => ({ kind: "rule", evaluate });

function methodsAnywhere(m: ManuscriptModel): RuleOutcome {
  const slot = GENERIC_SECTION_ORDER[2];
  const found = m.outline.some((h) => slot.aliases.some((a) => h.normalized === a || h.text.trim().toLowerCase() === a)) || m.starMethods.present;
  return found ? pass("Methods section present") : fail("No Methods section found");
}

function dataAvailability(m: ManuscriptModel): RuleOutcome {
  if (m.statements.dataAndCodeAvailability) return statementCheck(m, "dataAndCodeAvailability", "Data availability");
  if (m.statements.dataAvailability) return statementCheck(m, "dataAvailability", "Data availability");
  return fail("No data availability statement found");
}

export const genericChecks: FormatCheck[] = [
  {
    id: "generic.title.length", category: "title_page", severity: "recommended",
    question: "Is the title longer than 250 characters?", guideline: "Titles should be concise (at most 250 characters, 30 words).",
    detector: rule((m) => titleCheck(m, { maxChars: 250, maxWords: 30 })),
    phrase: "* Please shorten the title; most journals require a concise title of no more than 250 characters.",
  },
  {
    id: "generic.summary.length", category: "summary", severity: "required",
    question: "Is the abstract longer than 300 words or does it contain references?", guideline: "Abstract: a single paragraph of at most 300 words without references.",
    detector: rule((m) => summaryLengthCheck(m, 300, { singleParagraph: true, noCitations: true })),
    phrase: "* Please shorten the abstract to 300 words or fewer, as a single paragraph without references.",
  },
  {
    id: "generic.sections.imrad", category: "sections", severity: "required",
    question: "Are the standard sections (Abstract, Introduction, Methods, Results, Discussion, References) missing or out of order?",
    guideline: "Research articles follow the IMRaD structure: Abstract, Introduction, Methods, Results, Discussion, References.",
    detector: rule((m) => sectionOrderCheck(m, GENERIC_SECTION_ORDER)),
    phrase: "* Please structure the main document with the standard sections in this order: Abstract, Introduction, Methods, Results, Discussion, References.",
  },
  {
    id: "generic.sections.methods", category: "sections", severity: "required",
    question: "Is a Methods section missing?", guideline: "A Methods (or Materials and Methods) section is required.",
    detector: rule(methodsAnywhere),
    phrase: "* Please include a Methods section describing the procedures in enough detail for them to be reproduced.",
  },
  {
    id: "generic.body.novelty", category: "body", severity: "recommended",
    question: 'Does the text contain excessive use of "novel", "for the first time"?', guideline: "Novelty claims are discouraged.",
    detector: rule((m) => noveltyCheck(m, 3)),
    phrase: "* We discourage novelty claims (e.g., use of the word “novel”) because they are overused, tend not to add meaning, and are difficult to verify.",
  },
  {
    id: "generic.body.personal_communication", category: "body", severity: "recommended",
    question: "Are there references to personal communication or unpublished data?", guideline: "Personal communications and unpublished data should be cited in the text only, with permission.",
    detector: rule(personalCommunicationCheck),
    phrase: "* Unpublished data and personal communications should be cited within the text only, with a letter of permission for personal communications.",
  },
  {
    id: "generic.references.entries", category: "references", severity: "required",
    question: "Are the references incomplete (missing year, title, journal, volume or pages)?", guideline: "Each article reference includes authors, year, title, journal, volume and pages.",
    detector: rule((m) => referenceEntriesCheck(m)),
    phrase: "* Please check that every article reference includes the author list, year, article title, journal, volume and page range (and DOI where available).",
  },
  {
    id: "generic.references.in_press", category: "references", severity: "required",
    question: "Does the reference list contain submitted or unpublished items?", guideline: "References should include only published or in-press articles.",
    detector: rule(inPressCheck),
    phrase: "* References should include only articles that are published or in press; please cite submitted or unpublished work in the text only.",
  },
  {
    id: "generic.ethics.animals", category: "ethics", severity: "required",
    question: "Are there experiments with vertebrates?", guideline: "Animal work requires an ethics approval statement with the committee name, and the sex and age of the animals.",
    appliesWhen: (m) => m.features.vertebrates.present, detector: rule((m) => ethicsCheck(m, "animal")),
    phrase: "* Please include a statement identifying the committee that approved the animal experiments and confirming that they conform to the relevant regulatory standards, and report the sex and age of the animals.",
  },
  {
    id: "generic.ethics.humans", category: "ethics", severity: "required",
    question: "Are there experiments with humans?", guideline: "Human work requires ethics approval and informed consent statements, and the sex/gender and age of participants.",
    appliesWhen: (m) => m.features.humans.present, detector: rule((m) => ethicsCheck(m, "human")),
    phrase: "* Please include statements identifying the committee that approved the human studies and confirming that informed consent was obtained from all participants, and report the sex/gender and age of participants.",
  },
  {
    id: "generic.statements.data_availability", category: "statements", severity: "required",
    question: "Is a data availability statement missing?", guideline: "A data availability statement is required.",
    detector: rule(dataAvailability),
    phrase: "* Please include a Data Availability statement describing where the data supporting the findings can be accessed, with accession codes where applicable.",
  },
  {
    id: "generic.statements.competing_interests", category: "statements", severity: "required",
    question: "Is a competing interests / declaration of interests statement missing?", guideline: "A competing interests statement is required.",
    detector: rule((m) => statementCheck(m, "declarationOfInterests", "Competing interests")),
    phrase: "* Please include a competing interests statement (or state that the authors declare no competing interests).",
  },
  {
    id: "generic.statements.funding", category: "statements", severity: "required",
    question: "Is a funding / acknowledgements statement missing?", guideline: "Funding sources with grant numbers should be acknowledged.",
    detector: rule((m) => statementCheck(m, "acknowledgments", "Acknowledgments / funding", (t) => (/\d{3,}|grant|fund|support/i.test(t) ? null : "no funding sources or grant numbers found"))),
    phrase: "* Please include an Acknowledgements section listing all funding sources with grant numbers.",
  },
  {
    id: "generic.statements.author_contributions", category: "statements", severity: "recommended",
    question: "Is an author contributions statement missing?", guideline: "An author contributions statement is required for primary research papers.",
    detector: rule((m) => (statementSpan(m, "authorContributions") ? pass("Author contributions present") : fail("No author contributions statement found"))),
    phrase: "* Please include an Author Contributions section describing the contribution of each author.",
  },
];

export const genericProfile: JournalProfile = {
  id: "generic",
  name: "Generic journal",
  version: "2026.10",
  sourceUrls: [],
  letterPreamble: GENERIC_LETTER_PREAMBLE,
  sectionOrder: GENERIC_SECTION_ORDER.map((s) => s.slot),
  checks: genericChecks,
};
