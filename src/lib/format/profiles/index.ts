/**
 * Journal profile registry and resolution.
 *
 * resolveProfile maps a Journal record to a profile: an explicit
 * formatGuidelines.rules.profileId wins, then a slug containing "iscience",
 * otherwise the generic profile. The rules object may also disable checks or
 * override letter phrases per journal without touching the code:
 *   { profileId: "iscience", disabledChecks: ["iscience.body.nomenclature"],
 *     phraseOverrides: { "iscience.title.length": "* ..." } }
 */

import type { JournalProfile } from "../profile";
import { genericProfile } from "./generic";
import { iscienceProfile } from "./iscience";

export const profiles: Record<string, JournalProfile> = {
  [iscienceProfile.id]: iscienceProfile,
  [genericProfile.id]: genericProfile,
};

export interface ProfileRules {
  profileId?: string;
  disabledChecks?: string[];
  phraseOverrides?: Record<string, string>;
}

export interface JournalLike {
  slug: string;
  name?: string;
  formatGuidelines?: { rules: unknown } | null;
}

function readRules(rules: unknown): ProfileRules {
  if (!rules || typeof rules !== "object") return {};
  const r = rules as Record<string, unknown>;
  return {
    profileId: typeof r.profileId === "string" ? r.profileId : undefined,
    disabledChecks: Array.isArray(r.disabledChecks) ? r.disabledChecks.filter((x): x is string => typeof x === "string") : undefined,
    phraseOverrides:
      r.phraseOverrides && typeof r.phraseOverrides === "object"
        ? Object.fromEntries(Object.entries(r.phraseOverrides as Record<string, unknown>).filter(([, v]) => typeof v === "string") as [string, string][])
        : undefined,
  };
}

export function resolveProfile(journal: JournalLike | null | undefined): JournalProfile {
  const rules = readRules(journal?.formatGuidelines?.rules);
  const slug = (journal?.slug ?? "").toLowerCase();
  const name = (journal?.name ?? "").toLowerCase();
  const base =
    (rules.profileId && profiles[rules.profileId]) ||
    (slug.includes("iscience") || name.replace(/\s+/g, "").includes("iscience") ? profiles.iscience : profiles.generic);
  return applyRules(base, rules);
}

/** A derived profile with disabled checks removed and phrases overridden. */
export function applyRules(base: JournalProfile, rules: ProfileRules): JournalProfile {
  const disabled = new Set(rules.disabledChecks ?? []);
  const overrides = rules.phraseOverrides ?? {};
  if (!disabled.size && !Object.keys(overrides).length) return base;
  return {
    ...base,
    checks: base.checks
      .filter((c) => !disabled.has(c.id))
      .map((c) => (overrides[c.id] ? { ...c, phrase: overrides[c.id] } : c)),
  };
}

export { iscienceProfile, genericProfile };
