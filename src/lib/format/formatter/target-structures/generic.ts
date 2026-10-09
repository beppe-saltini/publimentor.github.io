/**
 * Generic IMRaD target used when no journal-specific structure exists.
 * Abstract/Introduction/Methods/Results/Discussion plus the usual
 * statements, Vancouver references with bracketed numeric citations.
 */
import type { TargetSlot, TargetStructure } from "../types";
import { headingRenamesFromSlots } from "./iscience";

export const genericSlots: TargetSlot[] = [
  { id: "title_page", heading: "Title page", level: 1, aliases: [], required: true, kind: "title_page", placeholderTemplate: "[Title, authors, affiliations and corresponding author e-mail]" },
  { id: "abstract", heading: "Abstract", level: 1, aliases: ["abstract", "summary"], required: true, kind: "summary", placeholderTemplate: "[Abstract of 250 words or fewer]" },
  { id: "introduction", heading: "Introduction", level: 1, aliases: ["introduction", "background"], required: true, kind: "body", placeholderTemplate: "[Introduction]" },
  { id: "methods", heading: "Methods", level: 1, aliases: ["methods", "materials and methods", "star methods", "online methods", "experimental procedures"], required: true, kind: "methods", placeholderTemplate: "[Methods]" },
  { id: "results", heading: "Results", level: 1, aliases: ["results"], required: true, kind: "body", placeholderTemplate: "[Results]" },
  { id: "discussion", heading: "Discussion", level: 1, aliases: ["discussion", "conclusions", "conclusion"], required: true, kind: "body", placeholderTemplate: "[Discussion]" },
  { id: "acknowledgments", heading: "Acknowledgments", level: 1, aliases: ["acknowledgments", "acknowledgements", "funding"], required: false, kind: "statement" },
  { id: "author_contributions", heading: "Author Contributions", level: 1, aliases: ["author contributions", "contributions"], required: false, kind: "statement" },
  { id: "competing_interests", heading: "Competing Interests", level: 1, aliases: ["competing interests", "declaration of interests", "conflict of interest", "conflicts of interest", "disclosure"], required: true, kind: "statement", placeholderTemplate: "[Competing interests statement]" },
  { id: "data_availability", heading: "Data Availability", level: 1, aliases: ["data availability", "data and code availability", "availability of data and materials", "code availability"], required: true, kind: "statement", placeholderTemplate: "[Data availability statement: repository and accession numbers]" },
  { id: "figure_legends", heading: "Figure Legends", level: 1, aliases: ["figure legends", "figure titles and legends", "legends", "figures"], required: true, kind: "legends", placeholderTemplate: "[Figure 1. Title. Legend...]" },
  { id: "tables", heading: "Tables", level: 1, aliases: ["tables"], required: false, kind: "tables" },
  { id: "supplemental_titles", heading: "Supplementary Information", level: 1, aliases: ["supplementary information", "supplemental information", "supporting information"], required: false, kind: "supplemental_titles" },
  { id: "references", heading: "References", level: 1, aliases: ["references", "bibliography", "literature cited"], required: true, kind: "references", placeholderTemplate: "[References]" },
];

export const genericTarget: TargetStructure = {
  profileId: "generic",
  fileFormat: "docx",
  slots: genericSlots,
  headingRenames: (() => {
    const renames = headingRenamesFromSlots(genericSlots);
    // The iScience helper forces Cell Press names for methods; undo for generic.
    for (const k of ["methods", "materials and methods", "online methods", "experimental procedures"]) renames[k] = "Methods";
    renames["data availability"] = "Data Availability";
    renames["code availability"] = "Data Availability";
    renames["availability of data and materials"] = "Data Availability";
    return renames;
  })(),
  legendTitle: { template: "Figure {n}. {title}", label: "Figure", separator: ". " },
  supplementalTitle: {
    figure: "Supplementary Figure {n}. {title}",
    table: "Supplementary Table {n}. {title}",
    video: "Supplementary Video {n}. {title}",
    data: "Supplementary Data {n}. {title}",
    scheme: "Supplementary Scheme {n}. {title}",
    relatedToTemplate: "",
  },
  references: { style: "vancouver", citationStyle: "bracketed-numeric", etAlAfter: 6, includeDoi: true, doiAsUrl: false },
  summary: { heading: "Abstract", maxWords: 250, singleParagraph: true },
  title: { maxChars: 200, noPunctuation: false },
  placeholderStyle: { prefix: "[AUTHOR ACTION NEEDED] ", highlight: "yellow" },
};
