/**
 * Small constructors shared by the two iScience check files so neither has to
 * import the other (avoids a module cycle between iscience.ts and iscience-star.ts).
 */

import type { ManuscriptModel } from "../manuscript-model";
import type { DetectorSpec, FormatCheck, RuleOutcome } from "../profile";
import { ISCIENCE_PHRASES, SPREADSHEET_QUESTIONS } from "./iscience-phrases";
import { methodsSection } from "./shared-rules";

export type CheckInput = Omit<FormatCheck, "id" | "phrase" | "question" | "sourceRef"> & {
  question?: string;
  phrase?: string;
  sourceRef?: string;
};

/**
 * Build an iScience check: the phrase (and, when the row exists, the question)
 * come from the spreadsheet tables so they stay verbatim. Throws at module load
 * when a check id has no phrase, so a typo cannot ship.
 */
export function def(idSuffix: string, input: CheckInput): FormatCheck {
  const row = SPREADSHEET_QUESTIONS[idSuffix];
  const phrase = input.phrase ?? ISCIENCE_PHRASES[idSuffix];
  if (!phrase) throw new Error(`No letter phrase for iscience.${idSuffix}`);
  const question = input.question ?? row?.question;
  if (!question) throw new Error(`No question for iscience.${idSuffix}`);
  return {
    ...input,
    id: `iscience.${idSuffix}`,
    question,
    phrase,
    sourceRef: input.sourceRef ?? (row ? `pre-accept checklist row ${row.row}` : undefined),
  };
}

export const rule = (evaluate: (m: ManuscriptModel) => RuleOutcome): DetectorSpec => ({ kind: "rule", evaluate });
export const manual: DetectorSpec = { kind: "manual" };

/** The manuscript has some methods text (STAR or classic) to judge. */
export const hasMethods = (m: ManuscriptModel) => m.starMethods.present || Boolean(methodsSection(m));

export const clipText = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}\n[...]` : t);
