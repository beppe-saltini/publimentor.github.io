import { describe, expect, it } from "vitest";
import { genericTarget, iscienceTarget, KRT_ROW_GROUPS, resolveTargetStructure } from "../target-structures";
import type { TargetSlot } from "../types";

function walk(slots: TargetSlot[]): TargetSlot[] {
  return slots.flatMap((s) => [s, ...(s.children ? walk(s.children) : [])]);
}

describe("iscienceTarget", () => {
  it("lists the main-document slots in the Final File Requirements order", () => {
    expect(iscienceTarget.slots.map((s) => s.id)).toEqual([
      "title_page", "summary", "introduction", "results", "discussion", "resource_availability", "limitations", "acknowledgments", "author_contributions", "declaration_of_interests", "ai_declaration", "figure_legends", "tables", "star_methods", "supplemental_titles", "references",
    ]);
  });

  it("nests the three Resource Availability subheadings and the STAR Methods children in order", () => {
    const ra = iscienceTarget.slots.find((s) => s.id === "resource_availability")!;
    expect(ra.children!.map((c) => c.heading)).toEqual(["Lead Contact", "Materials Availability", "Data and Code Availability"]);
    const star = iscienceTarget.slots.find((s) => s.id === "star_methods")!;
    expect(star.children!.map((c) => c.id)).toEqual(["krt", "experimental_model", "method_details", "quantification", "additional_resources"]);
  });

  it("maps common source headings onto journal headings", () => {
    const r = iscienceTarget.headingRenames;
    expect(r["abstract"]).toBe("Summary");
    expect(r["competing interests"]).toBe("Declaration of Interests");
    expect(r["conflict of interest"]).toBe("Declaration of Interests");
    expect(r["materials and methods"]).toBe("STAR Methods");
    expect(r["data availability"]).toBe("Data and Code Availability");
    expect(r["code availability"]).toBe("Data and Code Availability");
    expect(r["acknowledgements"]).toBe("Acknowledgments");
  });

  it("gives every required slot a placeholder template or children", () => {
    for (const slot of walk(iscienceTarget.slots)) {
      if (slot.required) expect(!!slot.placeholderTemplate || !!slot.children, slot.id).toBe(true);
    }
  });

  it("encodes the journal limits and reference style", () => {
    expect(iscienceTarget.summary).toEqual({ heading: "Summary", maxWords: 150, singleParagraph: true });
    expect(iscienceTarget.title).toEqual({ maxChars: 145, noPunctuation: true });
    expect(iscienceTarget.highlights).toEqual({ count: [3, 4], maxChars: 85 });
    expect(iscienceTarget.references.style).toBe("cell-press");
    expect(iscienceTarget.references.citationStyle).toBe("superscript-numeric");
    expect(iscienceTarget.references.etAlAfter).toBe(10);
    expect(iscienceTarget.krtTemplate?.headings).toEqual(["REAGENT or RESOURCE", "SOURCE", "IDENTIFIER"]);
    expect(KRT_ROW_GROUPS).toHaveLength(12);
    expect(iscienceTarget.letterPhrases?.limitations).toMatch(/Limitations of the study/);
  });
});

describe("resolveTargetStructure", () => {
  it("resolves ids case-insensitively and falls back to generic", () => {
    expect(resolveTargetStructure("iScience")).toBe(iscienceTarget);
    expect(resolveTargetStructure("nope")).toBe(genericTarget);
    expect(resolveTargetStructure(undefined)).toBe(genericTarget);
  });

  it("generic target is IMRaD with Vancouver references", () => {
    expect(genericTarget.slots.map((s) => s.id)).toContain("methods");
    expect(genericTarget.references.style).toBe("vancouver");
    expect(genericTarget.headingRenames["materials and methods"]).toBe("Methods");
  });
});
