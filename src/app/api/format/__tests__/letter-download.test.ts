import { describe, expect, it } from "vitest";
import { fileResponse, letterFileName } from "../_lib/letter-download";

describe("letterFileName", () => {
  it("slugs the manuscript title", () => {
    expect(letterFileName("Glial Cells & Neurons: a Study", "rep1")).toBe("pre-accept-letter-glial-cells-neurons-a-study");
  });
  it("strips non-ASCII characters and falls back to the report id", () => {
    expect(letterFileName("Étude ñ", "rep1")).toBe("pre-accept-letter-etude-n");
    expect(letterFileName("日本語", "rep1")).toBe("pre-accept-letter-rep1");
    expect(letterFileName(undefined, "rep1")).toBe("pre-accept-letter-rep1");
  });
  it("caps very long titles", () => {
    expect(letterFileName("x".repeat(200), "rep1").length).toBeLessThanOrEqual("pre-accept-letter-".length + 60);
  });
});

describe("fileResponse", () => {
  it("sets download headers and streams the bytes", async () => {
    const body = Buffer.from("Dear authors");
    const response = fileResponse(body, "text/plain; charset=utf-8", "letter.txt");
    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="letter.txt"');
    expect(response.headers.get("Content-Length")).toBe(String(body.length));
    expect(await response.text()).toBe("Dear authors");
  });
});
