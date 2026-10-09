/**
 * Assemble the target document: walk the journal's slots in order, pull the
 * matching content out of the manuscript model, and record every change as
 * a FormatOperation. The result (a FormatLayout) is file-format agnostic;
 * render-docx turns it into Word.
 */
import type { ManuscriptModel, Section, Statement } from "@/lib/format/manuscript-model";
import { buildKrtTable, prefillKrtRows } from "./krt";
import { buildFigureLegends, buildSupplementalTitles, buildTableBlocks } from "./legends";
import { needsExperimentalModelSection, routeMethods, type RoutedMethods, type StarChildId } from "./methods";
import { countWords, findSectionForSlot, makeOp, mentionsGenerativeAi, normalizeHeading, OpIdFactory, phrase, slotMatches, snippet, splitParagraphs, walkSections } from "./plan-utils";
import { buildDataAndCode, buildLeadContact, buildMaterialsAvailability, inferLeadContactName, leadContactFromAuthorsLine, markLeadContact, nextFootnoteNumber, statementBlocks } from "./statements";
import type { FormatLayout, FormatOperation, LayoutBlock, LayoutSlot, TargetSlot, TargetStructure } from "./types";

export interface LayoutResult {
  layout: FormatLayout;
  operations: FormatOperation[];
  /** Flat methods text, handy for KRT extraction and relatedTo inference. */
  methodsText: string;
}

/** Which model.statements entry backs a statement slot id. */
const STATEMENT_KEYS: Record<string, keyof ManuscriptModel["statements"]> = {
  limitations: "limitations",
  acknowledgments: "acknowledgments",
  author_contributions: "authorContributions",
  declaration_of_interests: "declarationOfInterests",
  competing_interests: "declarationOfInterests",
  ai_declaration: "aiDeclaration",
  data_availability: "dataAvailability",
  additional_resources: "additionalResources",
};

/** Paragraph + nested-heading blocks for a section (children one level down). */
export function sectionToBlocks(section: Section, childLevel: 2 | 3): LayoutBlock[] {
  const blocks: LayoutBlock[] = splitParagraphs(section.body).map((p) => ({ type: "paragraph", text: p }));
  for (const child of section.children) {
    blocks.push({ type: "heading", text: child.heading.text.replace(/^\s*\d+(\.\d+)*[.)]?\s+/, "").trim(), level: childLevel });
    blocks.push(...sectionToBlocks(child, 3));
  }
  return blocks;
}

function newSlot(slot: TargetSlot, inserted = false): LayoutSlot {
  return { slotId: slot.id, heading: slot.heading, level: slot.level, blocks: [], children: [], inserted };
}

export class LayoutBuilder {
  private ops: FormatOperation[] = [];
  private consumed = new Set<Section>();
  private sourceOrder: Array<{ slotId: string; start: number }> = [];
  private methodsText = "";

  constructor(private model: ManuscriptModel, private target: TargetStructure, private ids: OpIdFactory = new OpIdFactory()) {}

  build(): LayoutResult {
    const slots: LayoutSlot[] = [];
    for (const slot of this.target.slots) {
      const built = this.buildSlot(slot);
      if (built) slots.push(built);
    }
    this.placeUnmappedSections(slots);
    this.recordMoves();
    this.checkHighlights();
    return { layout: { titlePage: this.buildTitlePage(), slots }, operations: this.ops, methodsText: this.methodsText };
  }

  /* ----------------------------- title page ----------------------------- */

  private buildTitlePage(): FormatLayout["titlePage"] {
    const m = this.model;
    const t = this.target.title;
    const placeholders: string[] = [];
    const title = m.title?.trim();
    if (!title) placeholders.push("[Title]");
    else {
      if (title.length > t.maxChars) this.note("title_page", `Title has ${title.length} characters (limit ${t.maxChars}).`, phrase(this.target, "title", `Please shorten the title to ${t.maxChars} characters or fewer.`));
      if (t.noPunctuation && /[:;?!]/.test(title)) this.note("title_page", "Title contains punctuation.", phrase(this.target, "title", "Please remove punctuation from the title."));
      if (t.maxWords && countWords(title) > t.maxWords) this.note("title_page", `Title has more than ${t.maxWords} words.`, phrase(this.target, "title", `Please shorten the title to ${t.maxWords} words or fewer.`));
    }
    if (!m.authorsLine) placeholders.push("[Author list: First name Surname, spelled out, with affiliation numbers]");
    else if (/\b[A-Z]\.\s?[A-Z]?\.?\s+[A-Z][a-z]+/.test(m.authorsLine) && !/\b[A-Z][a-z]+\s+[A-Z][a-z]+/.test(m.authorsLine)) {
      this.note("title_page", "Author names appear as initials.", phrase(this.target, "author_names", "Please spell out all author names in the author list (First name Surname) rather than initials."));
    }
    if (m.affiliations.length === 0) placeholders.push("[Complete affiliations: department, institution, city, state/region, postal code, country]");
    const lead = m.hasLeadContactFootnote ? undefined : this.leadContactFootnote(placeholders);
    if (m.correspondingEmails.length === 0) {
      placeholders.push("[E-mail address of each corresponding author]");
      this.note("title_page", "No corresponding author e-mail found.", phrase(this.target, "corresponding_email", "Please include an e-mail address for each corresponding author on the title page."));
    }
    return { title, authorsLine: lead?.authorsLine ?? m.authorsLine, affiliations: m.affiliations, correspondingEmails: m.correspondingEmails, leadContactLine: lead?.line, placeholders };
  }

  /**
   * Cell Press marks the Lead Contact with a footnote in the author list
   * ("Jane Doe1,3*" + "3Lead contact"). When the manuscript names who takes
   * correspondence (a Nature-style "should be addressed to" line, or a single
   * starred author), the marker is added automatically and the operation is
   * linked to the title-page check; otherwise the authors are asked.
   */
  private leadContactFootnote(placeholders: string[]): { authorsLine?: string; line: string } | undefined {
    const m = this.model;
    const name = inferLeadContactName(m) || leadContactFromAuthorsLine(m.authorsLine);
    const marker = String(nextFootnoteNumber(m));
    const marked = name && m.authorsLine ? markLeadContact(m.authorsLine, name, marker) : undefined;
    if (name && marked) {
      const line = `${marker}Lead contact`;
      this.ops.push(makeOp(this.ids, "insert_section", `Added the Lead Contact footnote to the title page (${name} marked "${marker}" in the author list; "${line}" under the affiliations).`, { slotId: "title_page", topic: "lead_contact_footnote", before: snippet(m.authorsLine), after: snippet(marked) }));
      return { authorsLine: marked, line };
    }
    const ask = phrase(this.target, "lead_contact_footnote", "Please designate the Lead Contact with a footnote in the author list on the title page.");
    if (name) {
      // We know who, but cannot find the name in the author list (initials, missing line): write the footnote and ask for the marker.
      placeholders.push(`[Mark ${name} with the footnote marker "${marker}" in the author list]`);
      this.ops.push(makeOp(this.ids, "insert_placeholder", `Added the "${marker}Lead contact" footnote for ${name}; the marker must still be placed in the author list.`, { slotId: "title_page", topic: "lead_contact_footnote", needsAuthorInput: ask }));
      return { line: `${marker}Lead contact (${name})` };
    }
    placeholders.push("[Lead Contact footnote: mark the lead contact in the author list, e.g. 5Lead contact]");
    this.ops.push(makeOp(this.ids, "note", "No Lead Contact footnote in the author list.", { slotId: "title_page", topic: "lead_contact_footnote", needsAuthorInput: ask }));
    return undefined;
  }

  /* ------------------------------- slots ------------------------------- */

  private buildSlot(slot: TargetSlot): LayoutSlot | undefined {
    switch (slot.kind) {
      case "title_page":
        return undefined; // rendered separately
      case "summary":
        return this.buildSummary(slot);
      case "legends":
        return this.buildLegends(slot);
      case "tables":
        return this.buildTables(slot);
      case "methods":
        return slot.children ? this.buildStarMethods(slot) : this.buildBody(slot);
      case "supplemental_titles":
        return this.buildSupplemental(slot);
      case "references":
        return this.buildReferences(slot);
      case "statement":
        return slot.children ? this.buildResourceAvailability(slot) : this.buildStatement(slot);
      default:
        return this.buildBody(slot);
    }
  }

  private buildSummary(slot: TargetSlot): LayoutSlot {
    const out = newSlot(slot);
    const m = this.model;
    const section = findSectionForSlot(m.sections, slot);
    if (section) this.consumed.add(section);
    const headingText = m.summary?.headingText || section?.heading.text;
    const text = m.summary?.text || section?.body || "";
    if (!text.trim()) {
      return this.insertPlaceholder(slot, out);
    }
    this.track(slot.id, m.summary ? m.text.indexOf(text.slice(0, 40)) : section?.span.start);
    this.renameIfNeeded(slot, headingText);
    const paragraphs = splitParagraphs(text);
    if (this.target.summary.singleParagraph && paragraphs.length > 1) {
      this.ops.push(makeOp(this.ids, "merge_sections", `Merged the ${paragraphs.length} ${slot.heading} paragraphs into a single paragraph.`, { slotId: slot.id, before: snippet(paragraphs[0]), after: snippet(paragraphs.join(" ")) }));
      out.blocks.push({ type: "paragraph", text: paragraphs.join(" ") });
    } else out.blocks.push(...paragraphs.map((p): LayoutBlock => ({ type: "paragraph", text: p })));
    const words = m.summary?.wordCount || countWords(text);
    if (words > this.target.summary.maxWords) {
      this.note(slot.id, `${slot.heading} has ${words} words (limit ${this.target.summary.maxWords}).`, phrase(this.target, "summary_length", `Please shorten the ${slot.heading} to ${this.target.summary.maxWords} words or fewer.`));
    }
    if (m.summary?.containsCitations) this.note(slot.id, `${slot.heading} contains citations.`, phrase(this.target, "summary_citations", `Please do not include references in the ${slot.heading}.`));
    return out;
  }

  private buildBody(slot: TargetSlot): LayoutSlot | undefined {
    const section = findSectionForSlot(this.model.sections, slot);
    if (!section) return slot.required ? this.insertPlaceholder(slot, newSlot(slot)) : undefined;
    this.consumed.add(section);
    this.track(slot.id, section.span.start);
    this.renameIfNeeded(slot, section.heading.text);
    const out = newSlot(slot);
    out.blocks = dropSlotHeading(sectionToBlocks(section, slot.level === 1 ? 2 : 3), slot.heading);
    if (slot.id === "results" && section.children.length === 0) {
      this.note(slot.id, "Results has no subheadings.", phrase(this.target, "results_subheadings", "Please divide the Results section with subheadings."));
    }
    return out;
  }

  private statementFor(slot: TargetSlot): { stmt?: Statement; section?: Section } {
    const key = STATEMENT_KEYS[slot.id];
    const stmt = key ? (this.model.statements[key] as Statement | undefined) : undefined;
    const section = findSectionForSlot(this.model.sections, slot);
    return { stmt: stmt && "text" in stmt ? stmt : undefined, section };
  }

  private buildStatement(slot: TargetSlot): LayoutSlot | undefined {
    const { stmt, section } = this.statementFor(slot);
    if (section) this.consumed.add(section);
    const blocks = statementBlocks(stmt) || (section ? sectionToBlocks(section, 2) : undefined);
    if (!blocks || blocks.length === 0) {
      if (slot.id === "ai_declaration" && !mentionsGenerativeAi(this.model)) return undefined;
      if (!slot.required && slot.id !== "ai_declaration") return undefined;
      return this.insertPlaceholder(slot, newSlot(slot));
    }
    this.track(slot.id, stmt?.span.start ?? section?.span.start);
    this.renameIfNeeded(slot, stmt?.headingText || section?.heading.text);
    const out = newSlot(slot);
    out.blocks = blocks;
    return out;
  }

  private buildResourceAvailability(slot: TargetSlot): LayoutSlot {
    const out = newSlot(slot);
    const m = this.model;
    const sources = [m.statements.leadContact, m.statements.materialsAvailability, m.statements.dataAndCodeAvailability, m.statements.dataAvailability, m.statements.codeAvailability].filter((s): s is Statement => !!s);
    // Consume source sections with availability headings so they are not duplicated.
    for (const sec of m.sections) {
      for (const child of slot.children || []) if (slotMatches(child, sec.heading.text)) this.consumed.add(sec);
      if (slotMatches(slot, sec.heading.text)) this.consumed.add(sec);
    }
    const start = Math.min(...sources.map((s) => s.span.start), Number.POSITIVE_INFINITY);
    this.track(slot.id, Number.isFinite(start) ? start : undefined);
    if (sources.length > 0) {
      this.ops.push(makeOp(this.ids, "merge_sections", `Merged ${sources.map((s) => `"${s.headingText}"`).join(", ")} under "${slot.heading}" with the subheadings ${(slot.children || []).map((c) => `"${c.heading}"`).join(", ")}.`, { slotId: slot.id, before: sources.map((s) => s.headingText).join(" / "), after: (slot.children || []).map((c) => c.heading).join(" / ") }));
      out.inserted = false;
    } else {
      out.inserted = true;
      this.ops.push(makeOp(this.ids, "insert_section", `Inserted the mandatory "${slot.heading}" section with its three subheadings.`, { slotId: slot.id, after: slot.heading }));
    }
    for (const child of slot.children || []) {
      const childSlot = newSlot(child);
      const built = child.id === "lead_contact" ? buildLeadContact(m) : child.id === "materials_availability" ? buildMaterialsAvailability(m) : child.id === "data_code_availability" ? buildDataAndCode(m) : undefined;
      if (!built) {
        out.children.push(this.insertPlaceholder(child, childSlot));
        continue;
      }
      childSlot.blocks = built.blocks;
      childSlot.inserted = built.needsAuthor;
      const kind = built.needsAuthor ? "insert_placeholder" : built.fromSource ? "move_block" : "insert_section";
      this.ops.push(makeOp(this.ids, kind, built.note, { slotId: child.id, after: snippet(built.blocks.map((b) => ("text" in b ? b.text : "")).join(" "), 200), ...(built.needsAuthor ? { needsAuthorInput: phrase(this.target, child.id, `Please complete the "${child.heading}" statement under Resource Availability.`) } : {}) }));
      out.children.push(childSlot);
    }
    return out;
  }

  private buildLegends(slot: TargetSlot): LayoutSlot {
    const out = newSlot(slot);
    const { blocks, operations } = buildFigureLegends(this.model, this.target, this.ids);
    this.ops.push(...operations);
    const section = findSectionForSlot(this.model.sections, slot);
    if (section) this.consumed.add(section);
    if (blocks.length === 0) return this.insertPlaceholder(slot, out);
    this.track(slot.id, this.model.figureLegends[0]?.span.start);
    out.blocks = blocks;
    // A PDF source loses its figures: the rebuilt document carries the legends
    // only, so the authors must upload every figure as a separate file.
    if (this.model.sourceType === "pdf") {
      this.ops.push(makeOp(this.ids, "note", "The source is a PDF: the formatted document carries the figure titles and legends only; the figures themselves must be uploaded as separate files.", { slotId: slot.id, topic: "figures_separate_files", needsAuthorInput: phrase(this.target, "figures_separate_files", "Please supply figures as separate files with high resolution.") }));
    }
    return out;
  }

  private buildTables(slot: TargetSlot): LayoutSlot | undefined {
    const { blocks, operations } = buildTableBlocks(this.model.tableCaptions, this.ids);
    if (blocks.length === 0) return undefined;
    this.ops.push(...operations);
    const out = newSlot(slot);
    out.blocks = blocks;
    return out;
  }

  private buildStarMethods(slot: TargetSlot): LayoutSlot {
    const out = newSlot(slot);
    const m = this.model;
    const section = findSectionForSlot(m.sections, slot) || m.sections.find((s) => normalizeHeading(s.heading.text) === normalizeHeading(m.starMethods.headingText || ""));
    if (section) {
      this.consumed.add(section);
      this.track(slot.id, section.span.start);
      this.renameIfNeeded(slot, section.heading.text);
    } else {
      out.inserted = true;
      this.ops.push(makeOp(this.ids, "insert_section", `Inserted the "${slot.heading}" section (no Methods section was found).`, { slotId: slot.id, needsAuthorInput: phrase(this.target, "star_methods", "Please include a STAR Methods section with the standard headings.") }));
    }
    const routed: RoutedMethods = routeMethods(section, m);
    this.methodsText = routed.text;
    if (routed.hadNumbering || routed.renamed.length > 0) {
      this.ops.push(makeOp(this.ids, "rename_heading", `Removed numbering/re-cased ${routed.renamed.length || "the"} methods subheadings (numbering is not allowed in STAR Methods).`, { slotId: slot.id, before: routed.renamed[0]?.before, after: routed.renamed[0]?.after }));
    }
    for (const child of slot.children || []) {
      const childSlot = newSlot(child);
      if (child.kind === "krt") {
        const rows = prefillKrtRows(m, routed.text);
        const headings = this.target.krtTemplate?.headings || ["REAGENT or RESOURCE", "SOURCE", "IDENTIFIER"];
        childSlot.blocks.push(buildKrtTable(rows, headings, this.target.krtTemplate?.rowGroups));
        childSlot.blocks.push({ type: "placeholder", text: child.placeholderTemplate || "[Complete the Key Resources Table]" });
        childSlot.inserted = !m.starMethods.hasKeyResourcesTable;
        this.ops.push(makeOp(this.ids, "prefill_krt", `Prefilled the Key Resources Table skeleton with ${rows.length} row(s) detected in the manuscript (${summarizeGroups(rows.map((r) => r.group))}); identifiers that could not be found are marked N/A.`, { slotId: child.id, needsAuthorInput: phrase(this.target, "krt", "Please complete the Key Resources Table: one item per row under the standard subheadings, with a source and identifier (Cat#, RRID, accession or URL) for every entry.") }));
        out.children.push(childSlot);
        continue;
      }
      const blocks = routed.byChild[child.id as StarChildId] || [];
      if (blocks.length === 0) {
        if (child.id === "experimental_model" && !needsExperimentalModelSection(m, routed)) continue;
        if (child.id === "additional_resources" && !/clinical ?trial|NCT\d{8}|pre-?registered|ChiCTR/i.test(m.text)) continue;
        if (child.id === "experimental_model") {
          const ethics = [m.statements.ethicsAnimal, m.statements.ethicsHuman, m.statements.informedConsent].filter((s): s is Statement => !!s);
          if (ethics.length > 0) {
            childSlot.blocks.push(...ethics.flatMap((e) => statementBlocks(e) || []));
            childSlot.blocks.push({ type: "placeholder", text: child.placeholderTemplate || "[Describe experimental models]" });
            this.ops.push(makeOp(this.ids, "insert_placeholder", `Moved the ethics statement(s) under "${child.heading}"; model details still required.`, { slotId: child.id, needsAuthorInput: phrase(this.target, child.id, `Please complete "${child.heading}".`) }));
            out.children.push(childSlot);
            continue;
          }
        }
        out.children.push(this.insertPlaceholder(child, childSlot));
        continue;
      }
      childSlot.blocks = dropSlotHeading(blocks, child.heading);
      out.children.push(childSlot);
    }
    this.checkSubjectDetails();
    return out;
  }

  /**
   * Cell Press wants the sex and the age/developmental stage of every animal
   * and human subject. The checker reports a missing one as "review" (it may
   * sit in a table), which never reaches the letter, so the planner asks for
   * it explicitly whenever the study has such subjects.
   */
  private checkSubjectDetails() {
    const f = this.model.features;
    if (!f.vertebrates?.present && !f.humans?.present) return;
    const missing = [!f.sexReported?.present && "sex", !f.ageReported?.present && "age or developmental stage"].filter((x): x is string => Boolean(x));
    if (missing.length === 0) return;
    const what = missing.join(" and ");
    const template = phrase(this.target, "subject_details", 'Please report the {missing} of all animal subjects and human participants in the "Experimental Model and Study Participant Details" section.');
    this.ops.push(makeOp(this.ids, "note", `Methods do not report the ${what} of the animal/human subjects.`, { slotId: "experimental_model", topic: "subject_details", needsAuthorInput: template.replace("{missing}", what) }));
  }

  private buildSupplemental(slot: TargetSlot): LayoutSlot | undefined {
    const section = findSectionForSlot(this.model.sections, slot);
    if (section) this.consumed.add(section);
    const { blocks, operations } = buildSupplementalTitles(this.model, this.target, this.ids, this.methodsText);
    if (blocks.length === 0) return undefined;
    this.ops.push(...operations);
    this.track(slot.id, this.model.supplementalItems[0]?.span.start);
    if (section && normalizeHeading(section.heading.text) !== normalizeHeading(slot.heading)) this.renameIfNeeded(slot, section.heading.text);
    const out = newSlot(slot);
    out.blocks = blocks;
    return out;
  }

  private buildReferences(slot: TargetSlot): LayoutSlot {
    const out = newSlot(slot);
    const section = findSectionForSlot(this.model.sections, slot);
    if (section) this.consumed.add(section);
    if (this.model.references.count === 0 && !section) return this.insertPlaceholder(slot, out);
    this.track(slot.id, section?.span.start);
    this.renameIfNeeded(slot, this.model.references.headingText || section?.heading.text);
    out.blocks.push({ type: "references" });
    return out;
  }

  /* ------------------------------ helpers ------------------------------ */

  private insertPlaceholder(slot: TargetSlot, out: LayoutSlot): LayoutSlot {
    out.inserted = true;
    const text = slot.placeholderTemplate || `[${slot.heading}]`;
    for (const line of text.split("\n")) out.blocks.push({ type: "placeholder", text: line });
    this.ops.push(makeOp(this.ids, "insert_section", `Inserted the missing "${slot.heading}" section with a placeholder.`, { slotId: slot.id, after: snippet(text), needsAuthorInput: phrase(this.target, slot.id, `Please supply the "${slot.heading}" section.`) }));
    return out;
  }

  private renameIfNeeded(slot: TargetSlot, sourceHeading: string | undefined) {
    if (!sourceHeading) return;
    if (normalizeHeading(sourceHeading) === normalizeHeading(slot.heading)) return;
    this.ops.push(makeOp(this.ids, "rename_heading", `Renamed "${sourceHeading.trim()}" to "${slot.heading}".`, { slotId: slot.id, before: sourceHeading.trim(), after: slot.heading }));
  }

  private note(slotId: string, description: string, needsAuthorInput: string) {
    this.ops.push(makeOp(this.ids, "note", description, { slotId, needsAuthorInput }));
  }

  private track(slotId: string, start: number | undefined) {
    if (typeof start === "number" && start >= 0) this.sourceOrder.push({ slotId, start });
  }

  /** Sections that matched no slot: keep them (end of Discussion) and flag them. */
  private placeUnmappedSections(slots: LayoutSlot[]) {
    const discussion = slots.find((s) => s.slotId === "discussion");
    for (const sec of this.model.sections) {
      if (this.consumed.has(sec)) continue;
      const n = normalizeHeading(sec.heading.text);
      if (!n || /^(references|supplementary information|supplemental information|highlights|graphical abstract|key ?words|keywords|abstract|summary|extended data)$/.test(n)) continue;
      const fullText = [sec.body, ...Array.from(walkSections(sec.children), (c) => `${c.heading.text} ${c.body}`)].join(" ");
      if (/^additional information$/.test(n) && /correspond/i.test(fullText)) {
        this.ops.push(makeOp(this.ids, "note", `Dropped the Nature-style "${sec.heading.text.trim()}" paragraph (its correspondence information is now in the Lead Contact statement).`, { before: snippet(sec.body) }));
        continue;
      }
      if (/^(materials? and methods|methods|online methods)$/.test(n)) continue; // consumed by STAR Methods via alias
      const target = discussion || slots[slots.length - 1];
      if (!target) continue;
      target.blocks.push({ type: "heading", text: sec.heading.text.trim(), level: 2 }, ...sectionToBlocks(sec, 3));
      this.ops.push(makeOp(this.ids, "move_block", `"${sec.heading.text.trim()}" has no equivalent in the journal structure; kept at the end of "${target.heading}".`, { slotId: target.slotId, before: sec.heading.text.trim(), needsAuthorInput: `Please integrate or remove the section "${sec.heading.text.trim()}", which has no place in the required section order; it was kept at the end of ${target.heading}.` }));
    }
  }

  /** Slots not in the longest increasing run of source positions were moved. */
  private recordMoves() {
    const items = this.sourceOrder;
    if (items.length < 2) return;
    const lis = longestIncreasingRun(items.map((i) => i.start));
    const slotName = (id: string) => this.findSlot(id)?.heading || id;
    items.forEach((item, i) => {
      if (lis.has(i)) return;
      const after = i > 0 ? slotName(items[i - 1].slotId) : "the title page";
      this.ops.push(makeOp(this.ids, "move_block", `Moved "${slotName(item.slotId)}" to its required position (after ${after}).`, { slotId: item.slotId }));
    });
  }

  private checkHighlights() {
    const h = this.target.highlights;
    if (!h) return;
    const bullets = this.model.statements.highlights?.bullets || [];
    if (bullets.length === 0) {
      this.note("highlights", "No Highlights found.", phrase(this.target, "highlights", `Please provide ${h.count[0]}–${h.count[1]} Highlights of no more than ${h.maxChars} characters each as a separate Word document.`));
      return;
    }
    const tooLong = bullets.filter((b) => b.length > h.maxChars).length;
    if (bullets.length < h.count[0] || bullets.length > h.count[1] || tooLong > 0) {
      this.note("highlights", `Highlights: ${bullets.length} bullets, ${tooLong} over ${h.maxChars} characters.`, phrase(this.target, "highlights", `Please provide ${h.count[0]}–${h.count[1]} Highlights of no more than ${h.maxChars} characters each.`));
    } else this.ops.push(makeOp(this.ids, "note", "Highlights were found; upload them as a separate Word document (not part of the main document).", { slotId: "highlights" }));
  }

  private findSlot(id: string): TargetSlot | undefined {
    const walk = (list: TargetSlot[]): TargetSlot | undefined => {
      for (const s of list) {
        if (s.id === id) return s;
        const c = s.children ? walk(s.children) : undefined;
        if (c) return c;
      }
      return undefined;
    };
    return walk(this.target.slots);
  }
}

/**
 * Drop sub-heading blocks that repeat the slot heading itself: a source
 * "Quantification and statistical analysis" subsection routed into the slot
 * of the same name would otherwise print its heading twice.
 */
export function dropSlotHeading(blocks: LayoutBlock[], slotHeading: string): LayoutBlock[] {
  const target = normalizeHeading(slotHeading);
  return blocks.filter((b) => !(b.type === "heading" && normalizeHeading(b.text) === target));
}

function summarizeGroups(groups: string[]): string {
  const counts = new Map<string, number>();
  for (const g of groups) counts.set(g, (counts.get(g) || 0) + 1);
  if (counts.size === 0) return "no items detected";
  return Array.from(counts.entries())
    .map(([g, n]) => `${n} ${g}`)
    .join(", ");
}

/** Indices of one longest strictly increasing subsequence (O(n²), n is tiny). */
export function longestIncreasingRun(values: number[]): Set<number> {
  const n = values.length;
  const len = new Array<number>(n).fill(1);
  const prev = new Array<number>(n).fill(-1);
  let bestEnd = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      if (values[j] < values[i] && len[j] + 1 > len[i]) {
        len[i] = len[j] + 1;
        prev[i] = j;
      }
    }
    if (len[i] > len[bestEnd]) bestEnd = i;
  }
  const out = new Set<number>();
  for (let i = bestEnd; i >= 0; i = prev[i]) out.add(i);
  return out;
}

export function buildLayout(model: ManuscriptModel, target: TargetStructure, ids?: OpIdFactory): LayoutResult {
  return new LayoutBuilder(model, target, ids).build();
}
