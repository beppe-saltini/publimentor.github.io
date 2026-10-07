import { describe, it, expect } from "vitest";
import { ndjsonResponse, readNdjson, splitNdjson, type DiscoveryEvent } from "../discovery-stream";

describe("discovery-stream", () => {
  it("splits complete lines from a partial buffer", () => {
    expect(splitNdjson('{"a":1}\n{"b":2}\n{"c"')).toEqual({ lines: ['{"a":1}', '{"b":2}'], rest: '{"c"' });
    expect(splitNdjson("")).toEqual({ lines: [], rest: "" });
  });

  it("streams events in order and closes when the work finishes", async () => {
    const res = ndjsonResponse(async (emit) => {
      emit({ event: "progress", stage: "candidates", label: "Found", reviewers: [{ id: "1" }], summary: {} });
      await new Promise((r) => setTimeout(r, 5));
      emit({ event: "done", reviewers: [{ id: "1" }], summary: {}, disclaimer: "", selectionCriteria: {} });
    }, new AbortController().signal);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const events: DiscoveryEvent[] = [];
    for await (const e of readNdjson<DiscoveryEvent>(res.body!)) events.push(e);
    expect(events.map((e) => e.event)).toEqual(["progress", "done"]);
  });

  it("turns a thrown error into an error event instead of a broken stream", async () => {
    const res = ndjsonResponse(async () => {
      throw new Error("boom");
    }, new AbortController().signal);
    const events: DiscoveryEvent[] = [];
    for await (const e of readNdjson<DiscoveryEvent>(res.body!)) events.push(e);
    expect(events).toEqual([{ event: "error", message: "Failed to discover reviewers" }]);
  });
});
