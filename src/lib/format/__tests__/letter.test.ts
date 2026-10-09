/**
 * Letter assembly (order, "* " prefix, dedupe, overrides) and the minimal .docx writer.
 */

import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import type { CheckResult, FormatCheck, JournalProfile } from "../profile";
import { NO_ITEMS_LINE, buildLetter, escapeXml, letterLines, letterToDocx } from "../letter";

const check = (id: string, phrase: string): FormatCheck => ({
  id, category: "body", question: "q", guideline: "g", severity: "required", detector: { kind: "manual" }, phrase,
});
const result = (checkId: string, status: CheckResult["status"], letterPhrase?: string): CheckResult => ({
  checkId, status, summary: "", evidence: [], confidence: "high", detector: "rule", letterPhrase,
});
const profile: JournalProfile = {
  id: "p", name: "Journal", version: "1", sourceUrls: [], letterPreamble: "Please pay particular attention to the following points:", sectionOrder: [],
  checks: [check("a", "* First point"), check("b", "* Second point"), check("c", "* Shared point"), check("d", "* Shared point"), check("e", "* Fifth point")],
};

describe("buildLetter", () => {
  it("lists the phrases of failed checks in profile order under the preamble", () => {
    // Results arrive in a different order than the profile; the letter must follow the profile.
    const letter = buildLetter(profile, [result("e", "fail"), result("b", "review"), result("a", "fail"), result("c", "pass")]);
    expect(letter.preamble).toBe(profile.letterPreamble);
    expect(letter.items).toEqual([{ checkId: "a", text: "* First point" }, { checkId: "e", text: "* Fifth point" }]);
    expect(letter.text).toBe(`${profile.letterPreamble}\n\n* First point\n* Fifth point`);
  });

  it("includes only fail (not review/unknown) and dedupes identical phrases", () => {
    const letter = buildLetter(profile, [result("c", "fail"), result("d", "fail"), result("b", "unknown")]);
    expect(letter.items.map((i) => i.checkId)).toEqual(["c"]);
  });

  it("prefers the result's letterPhrase and ignores results for unknown checks", () => {
    const letter = buildLetter(profile, [result("a", "fail", "* Custom wording"), result("zzz", "fail")]);
    expect(letter.items).toEqual([{ checkId: "a", text: "* Custom wording" }]);
  });

  it("applies status overrides and falls back to a no-items line", () => {
    const letter = buildLetter(profile, [result("a", "fail"), result("b", "pass")], { a: { status: "pass" }, b: { status: "fail" } });
    expect(letter.items.map((i) => i.checkId)).toEqual(["b"]);
    const empty = buildLetter(profile, [result("a", "pass")]);
    expect(empty.items).toEqual([]);
    expect(empty.text).toContain(NO_ITEMS_LINE);
  });
});

describe("letterToDocx", () => {
  it("produces a valid zip with the OOXML parts and the letter text in Calibri 11pt", async () => {
    const letter = buildLetter(profile, [result("a", "fail"), result("b", "fail")]);
    const buffer = await letterToDocx(letter, { manuscriptTitle: "A <title> & more", journalName: "Journal" });
    expect(Buffer.isBuffer(buffer)).toBe(true);
    // PK zip signature
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");
    const zip = await JSZip.loadAsync(buffer);
    expect(Object.keys(zip.files).sort()).toEqual(["[Content_Types].xml", "_rels/.rels", "word/document.xml"]);
    const doc = await zip.file("word/document.xml")!.async("string");
    expect(doc).toContain("* First point");
    expect(doc).toContain("* Second point");
    expect(doc).toContain(escapeXml(profile.letterPreamble));
    expect(doc).toContain("A &lt;title&gt; &amp; more");
    expect(doc).toContain('w:ascii="Calibri"');
    expect(doc).toContain('<w:sz w:val="22"/>');
    const types = await zip.file("[Content_Types].xml")!.async("string");
    expect(types).toContain("wordprocessingml.document.main+xml");
  });

  it("emits one paragraph per line of the (possibly hand-edited) letter text", () => {
    const letter = { preamble: "P", items: [], text: "P\n\n* one\n* two" };
    const lines = letterLines(letter, { journalName: "J" });
    expect(lines.map((l) => l.text)).toEqual(["J - pre-acceptance formatting checks", "", "P", "", "* one", "* two"]);
    expect(lines[0].bold).toBe(true);
  });

  it("escapes XML special characters and strips control characters", () => {
    expect(escapeXml('a < b & "c" > \u0001d')).toBe("a &lt; b &amp; &quot;c&quot; &gt; d");
  });
});
