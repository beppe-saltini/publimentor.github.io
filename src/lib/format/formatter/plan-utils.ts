/**
 * Small pure helpers shared by the planner modules.
 */
import type { ManuscriptModel, Section } from "@/lib/format/manuscript-model";
import type { FormatOperation, FormatOperationKind, TargetSlot, TargetStructure } from "./types";

/** Lower-case, strip numbering/punctuation, collapse spaces: "2. Results:" -> "results". */
export function normalizeHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/^\s*(?:\d+(?:\.\d+)*[.)]?|[ivxlc]+[.)]|[a-z][.)])\s+/i, "")
    .replace(/★/g, " ")
    .replace(/[^\p{L}\p{N}\s/&-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Does a source heading belong to this slot (by alias or exact heading)? */
export function slotMatches(slot: TargetSlot, headingText: string): boolean {
  const n = normalizeHeading(headingText);
  if (!n) return false;
  if (n === normalizeHeading(slot.heading)) return true;
  return slot.aliases.some((a) => a === n);
}

/** Find the first top-level (or nested) section whose heading matches a slot. */
export function findSectionForSlot(sections: Section[], slot: TargetSlot): Section | undefined {
  for (const s of sections) {
    if (slotMatches(slot, s.heading.text)) return s;
  }
  for (const s of sections) {
    const nested = findSectionForSlot(s.children, slot);
    if (nested) return nested;
  }
  return undefined;
}

/** Find every slot (top-level or child) a section heading maps to. */
export function findSlotForHeading(slots: TargetSlot[], headingText: string): TargetSlot | undefined {
  for (const slot of slots) {
    if (slotMatches(slot, headingText)) return slot;
    if (slot.children) {
      const child = findSlotForHeading(slot.children, headingText);
      if (child) return child;
    }
  }
  return undefined;
}

/**
 * Split a body of text into paragraphs. Blank lines are the primary
 * delimiter; when a body has none (typical for PDF-extracted text) we break
 * at line ends that close a sentence and are followed by a capital letter.
 */
export function splitParagraphs(body: string): string[] {
  const text = body.replace(/\r\n?/g, "\n").trim();
  if (!text) return [];
  if (/\n\s*\n/.test(text)) {
    return text
      .split(/\n\s*\n+/)
      .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
      .filter(Boolean);
  }
  const lines = text.split("\n");
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    cur = cur ? `${cur} ${line}` : line;
    const next = lines[i + 1]?.trim();
    const endsSentence = /[.!?]["’”)]?$/.test(line);
    const nextStartsParagraph = !next || /^[A-Z•\-–]/.test(next);
    // Short closing lines (< 60% of typical width) are a strong paragraph signal.
    if (endsSentence && nextStartsParagraph && (line.length < 70 || !next)) {
      out.push(cur);
      cur = "";
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/** Shorten text for before/after snippets in the change log. */
export function snippet(text: string | undefined, max = 120): string | undefined {
  if (!text) return undefined;
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Sequential operation ids ("op-001") so logs are stable and sortable. */
export class OpIdFactory {
  private n = 0;
  next(): string {
    this.n += 1;
    return `op-${String(this.n).padStart(3, "0")}`;
  }
}

/** Build an operation with sensible defaults. */
export function makeOp(ids: OpIdFactory, kind: FormatOperationKind, description: string, extra: Partial<Omit<FormatOperation, "id" | "kind" | "description">> = {}): FormatOperation {
  return {
    id: ids.next(),
    kind,
    automatic: extra.automatic ?? !extra.needsAuthorInput,
    description,
    ...extra,
  };
}

/** Journal letter phrase for a topic, or the fallback. */
export function phrase(target: TargetStructure, key: string, fallback: string): string {
  return target.letterPhrases?.[key] || fallback;
}

/** Collect "[TOKEN]" placeholders left in a text. */
export function placeholderTokens(text: string): string[] {
  return Array.from(text.matchAll(/\[[^\]\n]{1,80}\]/g), (m) => m[0]);
}

/** Does the manuscript mention generative AI tools anywhere? */
export function mentionsGenerativeAi(model: ManuscriptModel): boolean {
  return /\b(generative AI|ChatGPT|GPT-?[345]|large language model|LLMs?|Copilot|Gemini|Claude|AI-assisted|artificial intelligence[- ]assisted)\b/i.test(model.text);
}

/** Walk sections depth-first. */
export function* walkSections(sections: Section[]): Generator<Section> {
  for (const s of sections) {
    yield s;
    yield* walkSections(s.children);
  }
}

/** Case-insensitive "Figure 3"/"Fig. 3" -> "Figure 3" normalization. */
export function canonicalFigureRef(ref: string): string {
  const m = ref.match(/(?:supplementary|supplemental|extended data)?\s*(fig(?:ure)?\.?|table|video|data|scheme)\s*(S?\d+[A-Za-z]?)/i);
  if (!m) return ref.trim();
  const kind = /^fig/i.test(m[1]) ? "Figure" : m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  const suppl = /supplementary|supplemental|extended data/i.test(ref) && !/^S/i.test(m[2]);
  return `${kind} ${suppl ? "S" : ""}${m[2].toUpperCase().replace(/^S/, "S")}`;
}
