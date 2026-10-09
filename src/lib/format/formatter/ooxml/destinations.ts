/**
 * Where does content go? Operations name a destination by slot id (from the
 * TargetStructure) or by the heading text of a section. This module maps
 * those onto a DOM anchor ("insert before this node") and, when the section
 * does not exist yet, creates its heading as a tracked insertion at the
 * position the journal's slot order implies.
 */
import type { TargetSlot, TargetStructure } from "../types";
import type { ApplyContext } from "./context";
import {
  bodyBlocks,
  locateParagraph,
  normalizeText,
  sectionEnd,
  type Located,
} from "./paragraphs";
import { headingStyleId } from "./styles";
import { createInsertedParagraph } from "./tracked";
import { childW, type XmlElement, type XmlNode } from "./xml";

export interface SlotRef {
  slot: TargetSlot;
  parent?: TargetSlot;
}

/** Find a slot by id anywhere in the slot tree. */
export function findSlot(target: TargetStructure, id: string | undefined): SlotRef | null {
  if (!id) return null;
  const visit = (slots: TargetSlot[], parent?: TargetSlot): SlotRef | null => {
    for (const slot of slots) {
      if (slot.id === id) return { slot, parent };
      const nested = slot.children ? visit(slot.children, slot) : null;
      if (nested) return nested;
    }
    return null;
  };
  return visit(target.slots);
}

/** First slot of a given semantic kind. */
export function findSlotByKind(target: TargetStructure, kind: TargetSlot["kind"]): SlotRef | null {
  const visit = (slots: TargetSlot[], parent?: TargetSlot): SlotRef | null => {
    for (const slot of slots) {
      if (slot.kind === kind) return { slot, parent };
      const nested = slot.children ? visit(slot.children, slot) : null;
      if (nested) return nested;
    }
    return null;
  };
  return visit(target.slots);
}

/** Heading texts under which a slot may currently appear in the manuscript. */
export function slotCandidates(target: TargetStructure, slot: TargetSlot): string[] {
  const names = new Set<string>([slot.heading, ...slot.aliases]);
  for (const [from, to] of Object.entries(target.headingRenames)) {
    if (normalizeText(to) === normalizeText(slot.heading)) names.add(from);
  }
  return [...names];
}

/**
 * Heading paragraph for `text`: a heading matching by prefix, or any paragraph
 * whose text is exactly `text` (bold pseudo-headings the classifier missed).
 */
export function findHeadingByText(ctx: ApplyContext, text: string, exclude?: XmlElement[]): Located | null {
  const blocks = bodyBlocks(ctx.body);
  return (
    locateParagraph(blocks, text, ctx.heading, { headingsOnly: true, minScore: 0.9, exclude }) ??
    locateParagraph(blocks, text, ctx.heading, { minScore: 1, exclude })
  );
}

export function findSlotHeading(ctx: ApplyContext, slot: TargetSlot, exclude?: XmlElement[]): Located | null {
  for (const candidate of slotCandidates(ctx.target, slot)) {
    const found = findHeadingByText(ctx, candidate, exclude);
    if (found) return found;
  }
  return null;
}

/** The sectPr at the end of the body, which is the fallback insertion anchor. */
export function bodySectPr(ctx: ApplyContext): XmlNode | null {
  return childW(ctx.body, "sectPr");
}

/** Node before which content goes to land at the end of the section starting at `headingIndex`. */
export function sectionEndAnchor(ctx: ApplyContext, headingIndex: number): XmlNode | null {
  const blocks = bodyBlocks(ctx.body);
  const end = sectionEnd(blocks, headingIndex, ctx.heading);
  return blocks[end] ?? bodySectPr(ctx);
}

/** Node right after the heading at `headingIndex` (start of its section). */
export function sectionStartAnchor(ctx: ApplyContext, headingIndex: number): XmlNode | null {
  const blocks = bodyBlocks(ctx.body);
  return blocks[headingIndex + 1] ?? bodySectPr(ctx);
}

export interface Destination {
  /** Insert new content before this node (null = append to body). */
  anchor: XmlNode | null;
  /** Block index of the section heading when one exists. */
  headingIndex: number | null;
  /** True when the heading had to be created. */
  created: boolean;
  heading?: XmlElement;
}

export interface DestinationQuery {
  slotId?: string;
  /** Heading text of the destination section (takes precedence over slotId). */
  after?: string;
  /** Create the slot's heading when the section is missing. */
  createIfMissing?: boolean;
  /** "end" (default) appends to the section; "start" inserts right after its heading. */
  position?: "start" | "end";
  /** Headings that must not be chosen (e.g. the section being merged away). */
  exclude?: XmlElement[];
}

/**
 * Resolve a destination section. Returns null when nothing matches and the
 * section cannot be created (no slot known).
 */
export function resolveDestination(ctx: ApplyContext, query: DestinationQuery): Destination | null {
  const pick = (index: number): Destination => ({
    anchor: query.position === "start" ? sectionStartAnchor(ctx, index) : sectionEndAnchor(ctx, index),
    headingIndex: index,
    created: false,
    heading: bodyBlocks(ctx.body)[index],
  });

  if (query.after) {
    const found = findHeadingByText(ctx, query.after, query.exclude);
    if (found) return pick(found.index);
  }
  const ref = findSlot(ctx.target, query.slotId);
  if (ref) {
    const found = findSlotHeading(ctx, ref.slot, query.exclude);
    if (found) return pick(found.index);
    if (query.createIfMissing) return createSlotHeading(ctx, ref, query.exclude);
  }
  if (query.after && query.createIfMissing) {
    // Unknown section named by text: create it at the end of the body.
    const heading = insertHeadingParagraph(ctx, query.after, 1, bodySectPr(ctx));
    return { anchor: bodySectPr(ctx), headingIndex: bodyBlocks(ctx.body).indexOf(heading), created: true, heading };
  }
  return null;
}

/**
 * Create the heading for a missing slot at the position the slot order
 * implies: after the nearest preceding sibling slot that exists in the
 * manuscript, else before the nearest following one. A child slot with no
 * existing siblings goes at the start of its parent's section when it is
 * the parent's first child (e.g. the Key Resources Table) and at the end
 * otherwise; the parent is created first when needed.
 */
function createSlotHeading(ctx: ApplyContext, ref: SlotRef, exclude?: XmlElement[]): Destination {
  const siblings = ref.parent ? ref.parent.children ?? [] : ctx.target.slots;
  let anchor = siblingAnchor(ctx, siblings, ref.slot, exclude);
  if (anchor === undefined) {
    if (ref.parent) {
      const first = siblings[0]?.id === ref.slot.id;
      const parentDest = resolveDestination(ctx, { slotId: ref.parent.id, createIfMissing: true, position: first ? "start" : "end", exclude });
      anchor = parentDest?.anchor ?? bodySectPr(ctx);
    } else anchor = bodySectPr(ctx);
  }
  const heading = insertHeadingParagraph(ctx, ref.slot.heading, ref.slot.level, anchor);
  return { anchor, headingIndex: bodyBlocks(ctx.body).indexOf(heading), created: true, heading };
}

/**
 * Anchor for moving an existing section to the position its slot has in the
 * journal order (the section's own heading is ignored while looking). Falls
 * back to the end of the body.
 */
export function slotOrderAnchor(ctx: ApplyContext, slotId: string, exclude: XmlElement[]): XmlNode | null {
  const ref = findSlot(ctx.target, slotId);
  if (!ref) return bodySectPr(ctx);
  const siblings = ref.parent ? ref.parent.children ?? [] : ctx.target.slots;
  const anchor = siblingAnchor(ctx, siblings, ref.slot, exclude);
  if (anchor !== undefined) return anchor;
  if (ref.parent) {
    const parentDest = resolveDestination(ctx, { slotId: ref.parent.id, createIfMissing: true, exclude });
    return parentDest?.anchor ?? bodySectPr(ctx);
  }
  return bodySectPr(ctx);
}

/** Anchor derived from existing sibling slots, or undefined when none exists. */
function siblingAnchor(ctx: ApplyContext, siblings: TargetSlot[], slot: TargetSlot, exclude?: XmlElement[]): XmlNode | null | undefined {
  const position = siblings.findIndex((s) => s.id === slot.id);
  for (let i = position - 1; i >= 0; i--) {
    const found = findSlotHeading(ctx, siblings[i], exclude);
    if (found) return sectionEndAnchor(ctx, found.index);
  }
  for (let i = position + 1; i < siblings.length; i++) {
    const found = findSlotHeading(ctx, siblings[i], exclude);
    if (found) return found.paragraph;
  }
  return undefined;
}

/** Insert a tracked heading paragraph before `anchor` and return it. */
export function insertHeadingParagraph(ctx: ApplyContext, text: string, level: 1 | 2, anchor: XmlNode | null): XmlElement {
  const p = createInsertedParagraph(ctx.doc, ctx.rev, {
    styleId: headingStyleId(ctx.styles, level),
    runs: [{ text }],
  });
  ctx.body.insertBefore(p, anchor);
  return p;
}
