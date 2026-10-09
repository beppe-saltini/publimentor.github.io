/**
 * Registry of journal target structures. To support a new journal, add a
 * file exporting a `TargetStructure` and register it here.
 */
import type { TargetStructure } from "../types";
import { genericTarget } from "./generic";
import { iscienceTarget, KRT_ROW_GROUPS } from "./iscience";

const TARGETS: Record<string, TargetStructure> = {
  iscience: iscienceTarget,
  generic: genericTarget,
};

/** Resolve by profile id (case-insensitive); unknown ids fall back to generic. */
export function resolveTargetStructure(profileId: string | undefined | null): TargetStructure {
  const key = (profileId || "").trim().toLowerCase();
  return TARGETS[key] || genericTarget;
}

export function listTargetStructures(): TargetStructure[] {
  return Object.values(TARGETS);
}

export { iscienceTarget, genericTarget, KRT_ROW_GROUPS };
