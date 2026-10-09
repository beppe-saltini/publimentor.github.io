/**
 * iScience (Cell Press) target structure.
 *
 * Derived from the iScience Final File Requirements checklist. The order of
 * `slots` is the order the journal wants in the main document; `aliases`
 * are normalized source headings (see normalizeHeading in plan-utils) that
 * map onto each slot. Adding another Cell Press journal is mostly a matter
 * of copying this file and tweaking names/limits.
 */
import type { TargetSlot, TargetStructure } from "../types";

/** Standard STAR Methods Key Resources Table row groups (Cell Press). */
export const KRT_ROW_GROUPS = [
  "Antibodies",
  "Bacterial and virus strains",
  "Biological samples",
  "Chemicals, peptides, and recombinant proteins",
  "Critical commercial assays",
  "Deposited data",
  "Experimental models: Cell lines",
  "Experimental models: Organisms/strains",
  "Oligonucleotides",
  "Recombinant DNA",
  "Software and algorithms",
  "Other",
];

export const LEAD_CONTACT_TEMPLATE =
  "Further information and requests for resources and reagents should be directed to and will be fulfilled by the lead contact, [NAME] ([EMAIL]).";

export const MATERIALS_AVAILABILITY_TEMPLATE =
  "This study did not generate new unique reagents. / [Describe materials generated and how to obtain them]";

/** Three mandatory bullets of the Data and Code Availability statement. */
export const DATA_CODE_BULLETS = [
  "[Data type] data have been deposited at [repository] and are publicly available as of the date of publication. Accession numbers are listed in the key resources table.",
  "This paper does not report original code.",
  "Any additional information required to reanalyze the data reported in this paper is available from the lead contact upon request.",
];

const resourceAvailabilityChildren: TargetSlot[] = [
  {
    id: "lead_contact",
    heading: "Lead Contact",
    level: 2,
    aliases: ["lead contact", "corresponding author", "contact for reagent and resource sharing"],
    required: true,
    kind: "statement",
    placeholderTemplate: LEAD_CONTACT_TEMPLATE,
  },
  {
    id: "materials_availability",
    heading: "Materials Availability",
    level: 2,
    aliases: ["materials availability", "material availability", "availability of materials", "reagent availability"],
    required: true,
    kind: "statement",
    placeholderTemplate: MATERIALS_AVAILABILITY_TEMPLATE,
  },
  {
    id: "data_code_availability",
    heading: "Data and Code Availability",
    level: 2,
    aliases: [
      "data and code availability",
      "data availability",
      "code availability",
      "availability of data and materials",
      "data and software availability",
      "data availability statement",
      "accession codes",
    ],
    required: true,
    kind: "statement",
    placeholderTemplate: DATA_CODE_BULLETS.map((b) => `• ${b}`).join("\n"),
  },
];

const starMethodsChildren: TargetSlot[] = [
  {
    id: "krt",
    heading: "Key Resources Table",
    level: 2,
    aliases: ["key resources table", "key resource table", "krt"],
    required: true,
    kind: "krt",
    placeholderTemplate:
      "[Complete the Key Resources Table: one item per row under the standard subheadings; identifiers (Cat#, RRID, accession, URL) are mandatory.]",
  },
  {
    id: "experimental_model",
    heading: "Experimental Model and Study Participant Details",
    level: 2,
    aliases: [
      "experimental model and study participant details",
      "experimental model and subject details",
      "experimental models",
      "animals",
      "mice",
      "mice and tumor models",
      "cell lines",
      "cell culture",
      "human subjects",
      "patients",
      "study participants",
    ],
    required: false,
    kind: "methods",
    placeholderTemplate:
      "[Describe every experimental model: species, strain, sex, age, source, housing/approval (animals); cell line source, authentication and mycoplasma testing (cell lines); recruitment, consent, approving committee, sex/gender and age (human participants).]",
  },
  {
    id: "method_details",
    heading: "Method Details",
    level: 2,
    aliases: ["method details", "methods", "materials and methods", "experimental procedures", "methods details", "online methods"],
    required: true,
    kind: "methods",
    placeholderTemplate: "[Describe all experimental procedures in enough detail to be reproduced without consulting other papers.]",
  },
  {
    id: "quantification",
    heading: "Quantification and Statistical Analysis",
    level: 2,
    aliases: [
      "quantification and statistical analysis",
      "statistical analysis",
      "statistics",
      "statistics and reproducibility",
      "quantification and statistics",
      "statistical analyses",
      "data analysis",
    ],
    required: true,
    kind: "methods",
    placeholderTemplate:
      "[State the statistical tests used, exact value of n and what n represents, definition of center and dispersion, and the significance threshold; indicate where these details can be found (legends, Results).]",
  },
  {
    id: "additional_resources",
    heading: "Additional Resources",
    level: 2,
    aliases: ["additional resources", "additional information", "clinical trial registration", "pre-registration"],
    required: false,
    kind: "methods",
  },
];

export const iscienceSlots: TargetSlot[] = [
  {
    id: "title_page",
    heading: "Title page",
    level: 1,
    aliases: [],
    required: true,
    kind: "title_page",
    placeholderTemplate:
      "[Title (<= 145 characters, no punctuation); author names spelled out (First name Surname); complete affiliations with department, institution, city, state/region, postal code and country; Lead Contact footnote; e-mail of every corresponding author.]",
  },
  {
    id: "summary",
    heading: "Summary",
    level: 1,
    aliases: ["summary", "abstract", "synopsis"],
    required: true,
    kind: "summary",
    placeholderTemplate: "[Summary: a single paragraph of 150 words or fewer with background, results and broader significance; no references.]",
  },
  { id: "introduction", heading: "Introduction", level: 1, aliases: ["introduction", "background"], required: true, kind: "body", placeholderTemplate: "[Introduction]" },
  { id: "results", heading: "Results", level: 1, aliases: ["results", "results and discussion"], required: true, kind: "body", placeholderTemplate: "[Results]" },
  { id: "discussion", heading: "Discussion", level: 1, aliases: ["discussion", "conclusions", "conclusion"], required: true, kind: "body", placeholderTemplate: "[Discussion]" },
  {
    id: "resource_availability",
    heading: "Resource Availability",
    level: 1,
    aliases: ["resource availability", "availability", "availability of data and materials"],
    required: true,
    kind: "statement",
    children: resourceAvailabilityChildren,
  },
  {
    id: "limitations",
    heading: "Limitations of the Study",
    level: 1,
    aliases: ["limitations of the study", "limitations of study", "limitations", "study limitations", "limitation of the study"],
    required: true,
    kind: "statement",
    placeholderTemplate: "[Limitations of the study: a paragraph highlighting the potential caveats of the work.]",
  },
  {
    id: "acknowledgments",
    heading: "Acknowledgments",
    level: 1,
    aliases: ["acknowledgments", "acknowledgements", "acknowledgment", "acknowledgement", "funding", "funding sources"],
    required: true,
    kind: "statement",
    placeholderTemplate: "[Acknowledgments: non-author contributions and all funding sources with grant numbers.]",
  },
  {
    id: "author_contributions",
    heading: "Author Contributions",
    level: 1,
    aliases: ["author contributions", "authors contributions", "contributions", "credit authorship contribution statement", "credit author statement"],
    required: true,
    kind: "statement",
    placeholderTemplate: "[Author contributions using initials, e.g. A.B. and C.D. conducted the experiments; E.F. designed the experiments and wrote the paper. CRediT taxonomy is encouraged.]",
  },
  {
    id: "declaration_of_interests",
    heading: "Declaration of Interests",
    level: 1,
    aliases: [
      "declaration of interests",
      "declaration of interest",
      "competing interests",
      "competing interest",
      "conflict of interest",
      "conflicts of interest",
      "conflict of interests",
      "disclosure",
      "disclosures",
      "competing financial interests",
      "declaration of competing interest",
    ],
    required: true,
    kind: "statement",
    placeholderTemplate: "[Declaration of interests, e.g. The authors declare no competing interests.]",
  },
  {
    id: "ai_declaration",
    heading: "Declaration of generative AI and AI-assisted technologies in the manuscript preparation process",
    level: 1,
    aliases: ["declaration of generative ai", "declaration of generative ai and ai-assisted technologies", "use of ai", "ai disclosure"],
    required: false,
    kind: "statement",
    placeholderTemplate:
      "During the preparation of this work the author(s) used [NAME TOOL / SERVICE] in order to [REASON]. After using this tool/service, the author(s) reviewed and edited the content as needed and take(s) full responsibility for the content of the publication.",
  },
  {
    id: "figure_legends",
    heading: "Figure titles and legends",
    level: 1,
    aliases: ["figure legends", "figure titles and legends", "legends", "figures", "figure captions", "legends to figures"],
    required: true,
    kind: "legends",
    placeholderTemplate: "[Figure 1. Title. Legend...]",
  },
  {
    id: "tables",
    heading: "Main tables and legends",
    level: 1,
    aliases: ["tables", "main tables", "tables and legends"],
    required: false,
    kind: "tables",
  },
  {
    id: "star_methods",
    heading: "STAR Methods",
    level: 1,
    aliases: ["star methods", "methods", "materials and methods", "online methods", "experimental procedures", "star★methods"],
    required: true,
    kind: "methods",
    children: starMethodsChildren,
  },
  {
    id: "supplemental_titles",
    heading: "Supplemental information titles and legends",
    level: 1,
    aliases: ["supplemental information", "supplementary information", "supplementary materials", "supplemental items", "supporting information", "supplementary data"],
    required: false,
    kind: "supplemental_titles",
  },
  {
    id: "references",
    heading: "References",
    level: 1,
    aliases: ["references", "bibliography", "literature cited", "reference list"],
    required: true,
    kind: "references",
    placeholderTemplate: "[References in Cell Press style]",
  },
];

/** Build the alias -> heading rename map from a slot tree. */
export function headingRenamesFromSlots(slots: TargetSlot[]): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (list: TargetSlot[]) => {
    for (const slot of list) {
      for (const alias of slot.aliases) {
        if (alias !== slot.heading.toLowerCase() && !(alias in out)) out[alias] = slot.heading;
      }
      if (slot.children) walk(slot.children);
    }
  };
  walk(slots);
  // Explicit overrides where the generic alias walk would be ambiguous.
  out["methods"] = "STAR Methods";
  out["materials and methods"] = "STAR Methods";
  out["online methods"] = "STAR Methods";
  out["experimental procedures"] = "STAR Methods";
  out["data availability"] = "Data and Code Availability";
  out["code availability"] = "Data and Code Availability";
  out["availability of data and materials"] = "Resource Availability";
  return out;
}


/**
 * Editorial-office wording for the author letter, keyed by slot id or topic.
 * Taken from the iScience production checklist so the letter sounds like the
 * journal's own correspondence.
 */
export const ISCIENCE_LETTER_PHRASES: Record<string, string> = {
  title: "For reasons of journal style and clarity, we would like to suggest a revision to the title. We would be happy to consider alternative suggestions - please ensure that the title does not exceed 145 characters and does not contain punctuation.",
  summary_length: "Please shorten the Summary to 150 words or fewer. The Summary should include the following elements: (1) a brief background of the question that avoids statements about how a process is not well understood; (2) a description of the results and approaches/model systems framed in the context of their conceptual interest; and (3) an indication of the broader significance of the work. We discourage novelty claims (e.g., use of the word \"novel\") because they are overused, tend not to add meaning, and are difficult to verify. Please do not include references in the Summary.",
  summary_citations: "Please do not include references in the Summary.",
  summary: "Please supply a Summary consisting of a single paragraph of 150 words or fewer.",
  introduction: "The main document must include an Introduction section.",
  results: "The main document must include a Results section.",
  results_subheadings: "Please divide the Results section with subheadings. We recommend that you use similar language in your figure titles for clarity and structural harmony.",
  discussion: "The main document must include a Discussion section.",
  limitations: "Please include a paragraph entitled \"Limitations of the study\" that highlights some potential caveats of the work.",
  acknowledgments: "Please supply an Acknowledgments section after the Discussion/Limitations of the study section, including all funding sources and grant numbers.",
  author_contributions: "Please supply an Author Contributions section after the Acknowledgments section, using initials to indicate author identity (the CRediT taxonomy is encouraged).",
  declaration_of_interests: "Please make a statement of declaration of interests after the Author Contributions section, in a section titled \"Declaration of Interests\". Please also fill in and upload our Declaration of Interests form.",
  ai_declaration: "If generative AI and/or AI-assisted technology was used in the writing process, please disclose this in a section entitled \"Declaration of generative AI and AI-assisted technologies in the manuscript preparation process\" placed after the Declaration of Interests.",
  lead_contact_footnote: "We require identification and contact information for a Lead Contact, who is the main point of contact for responding to material and resource requests. Please designate the Lead Contact with a footnote in the author list on the title page.",
  corresponding_email: "An email address should be included for each corresponding author on the title page.",
  author_names: "Author names should be spelled out in the author list, rather than set in initials (First name Surname).",
  lead_contact: "Please provide the full name and email address for the author taking responsibility for the Lead Contact role in the \"Lead Contact\" statement under Resource Availability; this should match the Lead Contact designated in the title page.",
  materials_availability: "For publication we will require a \"Materials Availability\" statement under Resource Availability even if no reagents were generated in the study (e.g., \"This study did not generate new unique reagents\" or a description of how materials can be obtained and any restrictions).",
  data_code_availability: "Please complete the \"Data and Code Availability\" paragraph in the Resource Availability section in a structured form: a bullet point for Data, one for Code and one for all other items, using the standard wording. Accession codes for this information should also appear in the Key Resources Table.",
  krt: "Please complete the Key Resources Table using the standardized subheadings (one item per row, no merged cells or customized headings). Please provide a source and identifier (Cat#, RRID, accession number, URL or DOI) for every entry; accession codes for deposited data and software must be listed here as well.",
  experimental_model: "Please list under \"Experimental Model and Study Participant Details\", under separate headings, all the experimental models (animals, human subjects, cell lines, primary cultures) used in the study, including species, strain, sex, age, source and housing, the committee approving the experiments, and for human subjects informed consent and sex/gender.",
  quantification: "Please describe all of the statistical analyses and software used in the \"Quantification and Statistical Analysis\" section and indicate where the statistical details of experiments can be found, including the statistical tests used, exact value of n and what n represents, definition of center and dispersion, and how significance was defined.",
  method_details: "Please provide sufficient information in Method Details so that readers do not need to consult the cited papers to understand how the methods and analyses were conducted.",
  star_methods: "Please include a STAR Methods section. STAR Methods follows a standardized structure including these specific headings in the following order: KEY RESOURCES TABLE; RESOURCE AVAILABILITY; EXPERIMENTAL MODEL AND STUDY PARTICIPANT DETAILS (omit if not applicable); METHOD DETAILS; QUANTIFICATION AND STATISTICAL ANALYSIS; ADDITIONAL RESOURCES (optional).",
  figure_legends: "Figures are required to include a descriptive title (e.g., Figure 1. [Title]); please include the figure legends as one list after the Declaration of Interests, not interspersed within the text.",
  legend_asterisks: "Where statistical tests are presented as asterisks, please ensure that the asterisks are defined in each relevant figure legend, together with the name of the statistical test. This information should also go in the STAR Methods under the QUANTIFICATION AND STATISTICAL ANALYSIS paragraph.",
  figures_separate_files: "Please supply figures as separate files with high resolution; the main document carries only the figure titles and legends. Please refer to our guidelines (https://www.cell.com/iscience/figureguidelines).",
  subject_details: "Please report the {missing} of all animal subjects and human participants in the \"Experimental Model and Study Participant Details\" section of the STAR Methods. In cases where this is appropriate, the influence (or association) of sex, gender, or both on the results of the study must be reported.",
  legend_statistics: "For any figures presenting pooled data and/or error bars, the measures should be defined in the figure legends (e.g., \"Data are represented as mean ± SEM\"). Where statistical tests are presented as asterisks, please ensure that the asterisks are defined in each relevant figure legend, together with the name of the statistical test.",
  supplemental_related: "Titles of all supplemental figures and items, including videos, tables and schemes, should reference a main item or the STAR Methods (e.g., \"Table S1. [Title], Related to Figure 1\" or \"Figure S3. [Title], Related to STAR Methods\").",
  highlights: "Please include the Highlights as a separate Word document. Highlights are bullet points that convey the core findings of your paper. You may include up to four highlights; the length of each highlight cannot exceed 85 characters (including spaces).",
  references: "References should include only articles that are published or in press. Article references should include the author list, year, article title, journal abbreviation, volume, page range and DOI.",
};

export const iscienceTarget: TargetStructure = {
  profileId: "iscience",
  fileFormat: "docx",
  slots: iscienceSlots,
  headingRenames: headingRenamesFromSlots(iscienceSlots),
  legendTitle: { template: "Figure {n}. {title}", label: "Figure", separator: ". " },
  supplementalTitle: {
    figure: "Figure S{n}. {title}",
    table: "Table S{n}. {title}",
    video: "Video S{n}. {title}",
    data: "Data S{n}. {title}",
    scheme: "Scheme S{n}. {title}",
    relatedToTemplate: ", Related to {related}",
  },
  references: {
    style: "cell-press",
    citationStyle: "superscript-numeric",
    etAlAfter: 10,
    includeDoi: true,
    doiAsUrl: true,
  },
  summary: { heading: "Summary", maxWords: 150, singleParagraph: true },
  title: { maxChars: 145, noPunctuation: true },
  highlights: { count: [3, 4], maxChars: 85 },
  placeholderStyle: { prefix: "[AUTHOR ACTION NEEDED] ", highlight: "yellow" },
  krtTemplate: { headings: ["REAGENT or RESOURCE", "SOURCE", "IDENTIFIER"], rowGroups: KRT_ROW_GROUPS },
  letterPhrases: ISCIENCE_LETTER_PHRASES,
};
