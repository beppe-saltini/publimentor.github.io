import { describe, expect, it, vi } from "vitest";
import type { CandidateWork } from "@/lib/references/reference-match";
import { dottedAbbreviation, normalizeCrossrefWork, type CrossrefWorkRecord } from "../crossref-work";
import { parseRawReference, splitAuthors } from "../reference-parse";
import { renderReference } from "../reference-render";
import { formatReferencesOffline, mapWithConcurrency, repairReferences, type RepairDeps } from "../references";
import { iscienceTarget } from "../target-structures";
import { ref, SAMPLE_REFS } from "./fixtures";

describe("parseRawReference", () => {
  it("parses a Nature-style numbered reference", () => {
    const p = parseRawReference(SAMPLE_REFS[0]);
    expect(p.style).toBe("nature");
    expect(p.authors).toEqual([{ family: "Doe", given: "J." }, { family: "Roe", given: "R." }, { family: "Poe", given: "E.A." }]);
    expect(p.title).toBe("Widgets regulate gadget assembly in cells");
    expect(p.journal).toBe("Nat Widget Biol");
    expect(p.volume).toBe("12");
    expect(p.pages).toBe("100–110");
    expect(p.year).toBe(2021);
  });

  it("parses Cell-style e-pages", () => {
    const p = parseRawReference("17. Lu, C. et al. DNA Sensing in Tumor Cells. Cancer Cell 39, 96–108 e106 (2021).");
    expect(p.journal).toBe("Cancer Cell");
    expect(p.volume).toBe("39");
    expect(p.pages).toBe("96–108.e106");
  });

  it("handles et al., in-press entries without volume, and wrapped page ranges", () => {
    const p = parseRawReference(SAMPLE_REFS[1]);
    expect(p.truncated).toBe(true);
    expect(p.authors[0]).toEqual({ family: "Smith", given: "A.B." });
    const q = parseRawReference(SAMPLE_REFS[2]);
    expect(q.journal).toBe("Cog Lett");
    expect(q.volume).toBeUndefined();
    expect(q.year).toBe(2024);
    const w = parseRawReference("7. Fucikova, J. et al. Detection of cell death. Cell Death Dis 11, 1013– 1020 (2020).");
    expect(w.pages).toBe("1013–1020");
  });

  it("parses Cell Press and Vancouver forms and extracts DOIs", () => {
    const c = parseRawReference("Doe, J., and Roe, R. (2020). A title here. Cell 180, 1–10. https://doi.org/10.1016/j.cell.2020.01.001");
    expect(c.style).toBe("cell-press");
    expect(c.doi).toBe("10.1016/j.cell.2020.01.001");
    expect(c.volume).toBe("180");
    const v = parseRawReference("3. Doe J, Roe RA, et al. A Vancouver title. J Test. 2018;12(3):45-50.");
    expect(v.style).toBe("vancouver");
    expect(v.authors[0]).toEqual({ family: "Doe", given: "J." });
    expect(v.issue).toBe("3");
    expect(v.pages).toBe("45–50");
  });

  it("splitAuthors handles hyphenated initials and multi-word surnames", () => {
    const { authors } = splitAuthors("van der Berg, J.-P., D'Andrea, A.D. & Lee, K.");
    expect(authors.map((a) => a.family)).toEqual(["van der Berg", "D'Andrea", "Lee"]);
    expect(authors[0].given).toBe("J.-P.");
  });
});

describe("renderReference", () => {
  const fields = {
    authors: [{ family: "Galluzzi", given: "Lorenzo" }, { family: "Kroemer", given: "Guido" }],
    year: 2024,
    title: "Targeting immunogenic cell stress and death for cancer therapy",
    journal: "Nature Reviews Drug Discovery",
    journalAbbrev: "Nat. Rev. Drug Discov.",
    volume: "23",
    pages: "445–460",
  };

  it("renders Cell Press style with 'and' before the last author and the DOI as URL", () => {
    expect(renderReference(fields, "cell-press", 1, { doi: "10.1038/s41573-024-00920-9" })).toBe(
      "Galluzzi, L., and Kroemer, G. (2024). Targeting immunogenic cell stress and death for cancer therapy. Nat. Rev. Drug Discov. 23, 445–460. https://doi.org/10.1038/s41573-024-00920-9"
    );
  });

  it("truncates to the first ten authors plus et al. in Cell Press style", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ family: `Auth${i + 1}`, given: "A." }));
    const out = renderReference({ ...fields, authors: many }, "cell-press");
    expect(out).toMatch(/^Auth1, A., Auth2, A., .*Auth10, A., et al\. \(2024\)\./);
    expect(out).not.toContain("Auth11");
  });

  it("omits volume/pages for in-press records and renders single authors", () => {
    const out = renderReference({ authors: [{ family: "Yu", given: "Li" }], year: 2026, title: "In press title", journalAbbrev: "Nat. Immunol." }, "cell-press", 1, { doi: "10.1000/x" });
    expect(out).toBe("Yu, L. (2026). In press title. Nat. Immunol. https://doi.org/10.1000/x");
  });

  it("renders Nature, Vancouver and APA styles", () => {
    expect(renderReference(fields, "nature", 1, { includeDoi: false })).toBe("Galluzzi, L. & Kroemer, G. Targeting immunogenic cell stress and death for cancer therapy. Nat. Rev. Drug Discov. 23, 445–460 (2024).");
    expect(renderReference({ ...fields, issue: "6" }, "vancouver", 1, { doi: "10.1000/x" })).toBe("Galluzzi L, Kroemer G. Targeting immunogenic cell stress and death for cancer therapy. Nat. Rev. Drug Discov. 2024;23(6):445-460. doi:10.1000/x");
    expect(renderReference(fields, "apa", 1, { includeDoi: false })).toBe("Galluzzi, L., & Kroemer, G. (2024). Targeting immunogenic cell stress and death for cancer therapy. Nat. Rev. Drug Discov., 23, 445–460.");
  });
});

describe("crossref-work helpers", () => {
  it("adds periods to abbreviated words using the full container title", () => {
    expect(dottedAbbreviation("Nat Rev Drug Discov", "Nature Reviews Drug Discovery")).toBe("Nat. Rev. Drug Discov.");
    expect(dottedAbbreviation("Cell", "Cell")).toBe("Cell");
    expect(dottedAbbreviation("J. Immunother. Cancer", "Journal for ImmunoTherapy of Cancer")).toBe("J. Immunother. Cancer");
    expect(dottedAbbreviation(undefined, "Cell Research")).toBe("Cell Research");
  });

  it("normalizes raw Crossref records", () => {
    const rec = normalizeCrossrefWork({ DOI: "10.1/abc", title: ["A <i>title</i>"], author: [{ given: "Jane", family: "Doe" }, { name: "Consortium X" }], issued: { "date-parts": [[2021, 3]] }, "container-title": ["Journal of Things"], "short-container-title": ["J Things"], volume: "5", page: "1-9" });
    expect(rec.title).toBe("A title");
    expect(rec.authors).toEqual([{ family: "Doe", given: "Jane" }, { family: "Consortium X" }]);
    expect(rec.year).toBe(2021);
    expect(rec.shortContainerTitle).toBe("J Things");
  });
});

/* ------------------------- repairReferences (fake network) ------------------------- */

const WORKS: Record<string, CrossrefWorkRecord> = {
  "10.1000/widgets": { DOI: "10.1000/widgets", title: "Widgets regulate gadget assembly in cells", authors: [{ family: "Doe", given: "Jane" }, { family: "Roe", given: "Richard" }, { family: "Poe", given: "Edgar Allan" }], year: 2021, containerTitle: "Nature Widget Biology", shortContainerTitle: "Nat Widget Biol", volume: "12", page: "100-110" },
  "10.1000/sprockets": { DOI: "10.1000/sprockets", title: "A survey of sprocket biology", authors: [{ family: "Smith", given: "Ann B." }, { family: "Jones", given: "Kim" }], year: 2019, containerTitle: "Journal of Sprocket Research", shortContainerTitle: "J Sprocket Res", volume: "3", page: "55-60" },
};

function fakeDeps(overrides: Partial<RepairDeps> = {}): RepairDeps & { searchCalls: number; fetchCalls: string[] } {
  const state = { searchCalls: 0, fetchCalls: [] as string[] };
  const deps: RepairDeps = {
    search: async (parsed) => {
      state.searchCalls++;
      const hits: CandidateWork[] = Object.values(WORKS).map((w) => ({ title: w.title, authors: [], year: w.year, journal: w.containerTitle, doi: w.DOI, source: "crossref" }));
      return hits.filter((h) => h.title.toLowerCase().split(" ")[0] === (parsed.title || "").toLowerCase().split(" ")[0]);
    },
    fetchWork: async (doi) => {
      state.fetchCalls.push(doi);
      return WORKS[doi] || null;
    },
    timeoutMs: 500,
    concurrency: 3,
    pauseMs: 0,
    ...overrides,
  };
  return Object.assign(deps, state);
}

describe("repairReferences", () => {
  it("matches entries on Crossref and renders them in Cell Press style with DOIs", async () => {
    const deps = fakeDeps();
    const out = await repairReferences(SAMPLE_REFS.map((r, i) => ref(i + 1, r)), iscienceTarget.references, deps);
    expect(out).toHaveLength(3);
    expect(out[0].matched).toBe(true);
    expect(out[0].doi).toBe("10.1000/widgets");
    expect(out[0].formatted).toBe("Doe, J., Roe, R., and Poe, E.A. (2021). Widgets regulate gadget assembly in cells. Nat. Widget Biol. 12, 100–110. https://doi.org/10.1000/widgets");
    expect(out[0].confidence).toBeGreaterThanOrEqual(0.88);
    // Crossref's full author list replaces the truncated "et al." list.
    expect(out[1].fields.authors.map((a) => a.family)).toEqual(["Smith", "Jones"]);
    // No Crossref record for the in-press entry: kept as written.
    expect(out[2].matched).toBe(false);
    expect(out[2].formatted).toBe(SAMPLE_REFS[2]);
    expect(out[2].fields.journal).toBe("Cog Lett");
  });

  it("rejects candidates below the title-similarity threshold", async () => {
    const deps = fakeDeps({ search: async () => [{ title: "Completely different topic entirely", authors: [], year: 2021, doi: "10.1000/widgets", source: "crossref" }] });
    const [out] = await repairReferences([ref(1, SAMPLE_REFS[0])], iscienceTarget.references, deps);
    expect(out.matched).toBe(false);
    expect(out.source).toBe("unmatched");
  });

  it("uses a DOI in the raw text directly, caches per DOI, and verifies the title", async () => {
    const deps = fakeDeps();
    const raw = "Doe, J., Roe, R., and Poe, E.A. (2021). Widgets regulate gadget assembly in cells. Nat. Widget Biol. 12, 100–110. https://doi.org/10.1000/widgets";
    const out = await repairReferences([ref(1, raw), ref(2, raw)], iscienceTarget.references, deps);
    expect(out.every((r) => r.matched && r.source === "crossref-doi")).toBe(true);
    expect(deps.searchCalls).toBe(0);
    expect(deps.fetchCalls.filter((d) => d === "10.1000/widgets")).toHaveLength(2); // cache lives inside fetchCrossrefWork; the fake has none
    const mismatch = await repairReferences([ref(1, "Lee, K. (2021). An unrelated title about cogs. J. Cogs 1, 1–2. https://doi.org/10.1000/widgets")], iscienceTarget.references, deps);
    expect(mismatch[0].matched).toBe(false);
    expect(mismatch[0].source).toBe("doi-unverified");
  });

  it("retries a failing search before giving up", async () => {
    let calls = 0;
    const flaky = fakeDeps({
      pauseMs: 1,
      search: async (parsed) => {
        calls++;
        if (calls < 2) throw new Error("429 Too Many Requests");
        return [{ title: parsed.title || "", authors: [], year: 2021, doi: "10.1000/widgets", source: "crossref" }];
      },
    });
    const [out] = await repairReferences([ref(1, SAMPLE_REFS[0])], iscienceTarget.references, flaky);
    expect(calls).toBe(2);
    expect(out.matched).toBe(true);
  });

  it("runs a slow second pass over unmatched entries when the network works", async () => {
    let sprocketCalls = 0;
    const deps = fakeDeps({
      pauseMs: 1,
      search: async (parsed) => {
        // The sprocket entry finds nothing on the first pass (as after exhausted 429 retries) and succeeds on the second.
        if (/sprocket/i.test(parsed.title || "") && ++sprocketCalls < 2) return [];
        const w = /sprocket/i.test(parsed.title || "") ? WORKS["10.1000/sprockets"] : WORKS["10.1000/widgets"];
        return [{ title: w.title, authors: [], year: w.year, doi: w.DOI, source: "crossref" }];
      },
    });
    const out = await repairReferences([ref(1, SAMPLE_REFS[0]), ref(2, SAMPLE_REFS[1])], iscienceTarget.references, deps);
    expect(out.map((r) => r.matched)).toEqual([true, true]);
  });

  it("never throws on network failures or timeouts", async () => {
    const failing = fakeDeps({
      search: async () => {
        throw new Error("boom");
      },
      fetchWork: () => new Promise(() => {}), // hangs forever
      timeoutMs: 20,
    });
    const out = await repairReferences([ref(1, SAMPLE_REFS[0]), ref(2, "Doe, J. (2021). X y z. J. 1, 1. https://doi.org/10.1000/widgets")], iscienceTarget.references, failing);
    expect(out.map((r) => r.matched)).toEqual([false, false]);
    expect(out[0].formatted).toBe(SAMPLE_REFS[0]);
  });

  it("limits concurrency to the configured number of workers", async () => {
    let active = 0;
    let peak = 0;
    const deps = fakeDeps({
      search: async (parsed) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return [{ title: parsed.title || "", authors: [], doi: "10.1000/widgets", source: "crossref" }];
      },
    });
    const entries = Array.from({ length: 9 }, (_, i) => ref(i + 1, SAMPLE_REFS[0]));
    await repairReferences(entries, iscienceTarget.references, deps);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it("mapWithConcurrency preserves order", async () => {
    const out = await mapWithConcurrency([3, 1, 2], 2, async (n) => {
      await new Promise((r) => setTimeout(r, n));
      return n * 10;
    });
    expect(out).toEqual([30, 10, 20]);
  });
});

describe("formatReferencesOffline", () => {
  it("renders parseable entries in the target style without network", () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const out = formatReferencesOffline([ref(1, SAMPLE_REFS[0])], iscienceTarget.references);
    expect(spy).not.toHaveBeenCalled();
    expect(out[0].matched).toBe(false);
    expect(out[0].formatted).toBe("Doe, J., Roe, R., and Poe, E.A. (2021). Widgets regulate gadget assembly in cells. Nat Widget Biol 12, 100–110.");
    spy.mockRestore();
  });
});
