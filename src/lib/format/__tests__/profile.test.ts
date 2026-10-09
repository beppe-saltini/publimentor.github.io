/**
 * Rule helpers in profile.ts and the profile registry (profiles/index.ts).
 */

import { describe, it, expect } from "vitest";
import {
  blankModel,
  charLimit,
  countWords,
  featureImplies,
  hasSection,
  headingMatches,
  normalizeHeading,
  pass,
  quoteSpan,
  regexAbsent,
  regexPresent,
  sectionOrderCheck,
  statementHeading,
  wordLimit,
  type OrderSlot,
} from "../profile";
import { applyRules, genericProfile, iscienceProfile, profiles, resolveProfile } from "../profiles";
import { heading, makeModel, section, statement } from "./profile-fixtures";

describe("text helpers", () => {
  it("normalizes headings to lower-case words", () => {
    expect(normalizeHeading("  Declaration of Interests! ")).toBe("declaration of interests");
    expect(normalizeHeading("STAR★Methods")).toBe("star methods");
  });

  it("matches headings against aliases, tolerating glued line numbers", () => {
    expect(headingMatches("Abstract", ["summary", "abstract"])).toBe(true);
    expect(headingMatches("Abstract14", ["abstract"])).toBe(true);
    expect(headingMatches("Materials and Methods", ["methods"])).toBe(true);
    expect(headingMatches("Methodology", ["methods"])).toBe(false);
    expect(headingMatches("", ["methods"])).toBe(false);
  });

  it("counts words ignoring punctuation-only tokens", () => {
    expect(countWords("one two - three ± four.")).toBe(4);
  });

  it("quotes a span with padding and clamps to the text", () => {
    const model = blankModel({ text: "alpha beta gamma delta" });
    expect(quoteSpan(model, { start: 6, end: 10 })).toBe("beta");
    expect(quoteSpan(model, { start: 6, end: 10 }, 2)).toBe("a beta g");
    expect(quoteSpan(model, { start: 100, end: 200 })).toBe("");
  });

  it("resolves synthetic statement labels to the nearest heading", () => {
    const model = makeModel({ text: "Competing interests\nThe authors declare none.", outline: [heading("Competing interests", 0)] });
    expect(statementHeading(model, statement("(declaration of interests wording)", "The authors declare none.", 20))).toBe("Competing interests");
    expect(statementHeading(model, statement("(x)", "far away", 5000))).toBeUndefined();
    expect(statementHeading(model, statement("Declaration of Interests", "text", 0))).toBe("Declaration of Interests");
  });
});

describe("blankModel", () => {
  it("creates a model with every feature absent and overrides applied", () => {
    const model = blankModel({ sourceType: "pdf", features: { rnaSeq: { present: true, evidence: ["RNA-seq"] } } as never });
    expect(model.sourceType).toBe("pdf");
    expect(model.features.rnaSeq.present).toBe(true);
    expect(model.features.humans.present).toBe(false);
    expect(model.references.count).toBe(0);
  });
});

describe("hasSection", () => {
  it("passes when a section or outline heading matches", () => {
    const model = makeModel({ text: "Methods\nbody", sections: [section("Methods", 0, "body")] });
    expect(hasSection(model, ["methods"]).status).toBe("pass");
    const outlineOnly = makeModel({ text: "Materials and Methods", outline: [heading("Materials and Methods", 0)] });
    expect(hasSection(outlineOnly, ["methods"]).status).toBe("pass");
  });

  it("fails with the label when nothing matches", () => {
    const result = hasSection(makeModel(), ["methods"], "Methods");
    expect(result.status).toBe("fail");
    expect(result.summary).toContain('"Methods"');
  });
});

describe("sectionOrderCheck", () => {
  const slots: OrderSlot[] = [
    { slot: "Summary", aliases: ["summary", "abstract"] },
    { slot: "Results", aliases: ["results"] },
    { slot: "Discussion", aliases: ["discussion"] },
    { slot: "Tables", aliases: ["tables"], optional: true },
    { slot: "References", aliases: ["references"], locate: (m) => m.statements.limitations?.span },
  ];

  it("passes when all required slots are present in order", () => {
    const model = makeModel({ outline: [heading("Summary", 0), heading("Results", 100), heading("Discussion", 200), heading("References", 300)] });
    const result = sectionOrderCheck(model, slots);
    expect(result.status).toBe("pass");
    expect(result.evidence.map((e) => e.location)).toEqual(["Summary", "Results", "Discussion", "References"]);
  });

  it("fails and names missing and out-of-order slots", () => {
    const model = makeModel({ outline: [heading("Discussion", 0), heading("Results", 100)] });
    const result = sectionOrderCheck(model, slots);
    expect(result.status).toBe("fail");
    expect(result.summary).toContain("missing: Summary, References");
    expect(result.summary).toContain("out of order: Discussion appears before Results");
  });

  it("uses the slot locator when no heading matches and honours allowMissing", () => {
    const model = makeModel({
      outline: [heading("Abstract", 0), heading("Results", 100), heading("Discussion", 200)],
      statements: { limitations: statement("x", "y", 300) },
    });
    expect(sectionOrderCheck(model, slots).status).toBe("pass");
    const partial = makeModel({ outline: [heading("Abstract", 0), heading("Results", 100)] });
    expect(sectionOrderCheck(partial, slots, { allowMissing: true }).status).toBe("review");
  });
});

describe("limits and regex helpers", () => {
  it("wordLimit and charLimit report counts", () => {
    expect(wordLimit("one two three", 3, "Summary").status).toBe("pass");
    expect(wordLimit("one two three four", 3, "Summary")).toMatchObject({ status: "fail", summary: expect.stringContaining("4 words") });
    expect(wordLimit(undefined, 3, "Summary").status).toBe("unknown");
    expect(charLimit("abc", 2, "Title").status).toBe("fail");
    expect(charLimit("abc", 3, "Title").status).toBe("pass");
  });

  it("regexAbsent counts occurrences with context, regexPresent requires one", () => {
    const absent = regexAbsent("a novel idea and a novel method", /\bnovel\b/i, "novelty words");
    expect(absent.status).toBe("fail");
    expect(absent.summary).toContain("2 occurrences");
    expect(absent.evidence[0].quote).toContain("novel");
    expect(regexAbsent("plain text", /novel/i, "novelty words").status).toBe("pass");
    expect(regexPresent("Data are mean ± SEM", /mean ± SEM/, "error bar definition").status).toBe("pass");
    expect(regexPresent("nothing", /mean ± SEM/, "error bar definition").status).toBe("fail");
  });

  it("featureImplies is not applicable without the feature and appends feature evidence otherwise", () => {
    const model = makeModel();
    expect(featureImplies(model, "rnaSeq", () => pass("ok")).status).toBe("not_applicable");
    model.features.rnaSeq = { present: true, evidence: ["RNA-seq libraries"] };
    const result = featureImplies(model, "rnaSeq", () => pass("ok"));
    expect(result.status).toBe("pass");
    expect(result.evidence.some((e) => e.quote === "RNA-seq libraries")).toBe(true);
  });
});

describe("resolveProfile", () => {
  it("maps iscience slugs and names to the iScience profile, otherwise generic", () => {
    expect(resolveProfile({ slug: "iscience" }).id).toBe("iscience");
    expect(resolveProfile({ slug: "cell-iscience-2026" }).id).toBe("iscience");
    expect(resolveProfile({ slug: "x", name: "iScience" }).id).toBe("iscience");
    expect(resolveProfile({ slug: "nature-comms" }).id).toBe("generic");
    expect(resolveProfile(null).id).toBe("generic");
    expect(profiles.generic).toBe(genericProfile);
  });

  it("honours formatGuidelines.rules: profileId, disabledChecks and phraseOverrides", () => {
    const profile = resolveProfile({
      slug: "some-journal",
      formatGuidelines: { rules: { profileId: "iscience", disabledChecks: ["iscience.body.nomenclature"], phraseOverrides: { "iscience.file.word": "* Word please." } } },
    });
    expect(profile.id).toBe("iscience");
    expect(profile.checks.some((c) => c.id === "iscience.body.nomenclature")).toBe(false);
    expect(profile.checks.find((c) => c.id === "iscience.file.word")?.phrase).toBe("* Word please.");
    // The base profile is untouched.
    expect(iscienceProfile.checks.find((c) => c.id === "iscience.file.word")?.phrase).not.toBe("* Word please.");
  });

  it("ignores malformed rules and returns the base profile when nothing changes", () => {
    expect(resolveProfile({ slug: "iscience", formatGuidelines: { rules: "garbage" } })).toBe(iscienceProfile);
    expect(resolveProfile({ slug: "iscience", formatGuidelines: { rules: { profileId: "nope" } } }).id).toBe("iscience");
    expect(applyRules(genericProfile, {})).toBe(genericProfile);
  });
});
