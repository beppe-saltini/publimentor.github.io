import { describe, it, expect } from "vitest";
import { z } from "zod";
import { claudeJsonFormat, toClaudeJsonSchema } from "../claude-schema";

describe("claude-schema", () => {
  it("strips constraints the API rejects and closes every object", () => {
    const schema = z.object({
      name: z.string().max(300),
      score: z.number().min(0).max(100),
      tags: z.array(z.string().max(20)).max(5),
      nested: z.object({ email: z.string().email(), note: z.string().nullable() }),
      kind: z.enum(["a", "b"]),
    });
    const json = toClaudeJsonSchema(schema) as Record<string, unknown>;
    const text = JSON.stringify(json);
    for (const key of ["maxLength", "minimum", "maximum", "maxItems", "$schema"]) expect(text).not.toContain(`"${key}"`);
    expect(json.additionalProperties).toBe(false);
    const nested = (json.properties as Record<string, Record<string, unknown>>).nested;
    expect(nested.additionalProperties).toBe(false);
    expect(text).toContain('"format":"email"');
    expect((json.required as string[]).sort()).toEqual(["kind", "name", "nested", "score", "tags"]);
  });

  it("wraps the schema as an output format", () => {
    const fmt = claudeJsonFormat(z.object({ ok: z.boolean() }));
    expect(fmt.type).toBe("json_schema");
    expect(fmt.schema.type).toBe("object");
  });
});
