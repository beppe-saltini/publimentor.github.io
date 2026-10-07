import { z } from "zod";

/**
 * Turns a Zod schema into the `output_config.format` value for Claude's structured
 * outputs. The API guarantees the response matches the schema, so JSON parsing can
 * no longer fail; constraints the API does not accept (lengths, numeric bounds,
 * item counts, patterns) are stripped here and stay enforced client-side by Zod.
 */

const UNSUPPORTED_KEYS = new Set([
  "minLength", "maxLength", "pattern",
  "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
  "minItems", "maxItems", "uniqueItems", "minContains", "maxContains",
  "minProperties", "maxProperties", "propertyNames",
]);
const SUPPORTED_FORMATS = new Set(["date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid"]);

function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (UNSUPPORTED_KEYS.has(key) || key === "$schema") continue;
    if (key === "format" && typeof value === "string" && !SUPPORTED_FORMATS.has(value)) continue;
    out[key] = key === "enum" || key === "required" ? value : clean(value);
  }
  if (out.type === "object" && out.properties) out.additionalProperties = false;
  return out;
}

export function toClaudeJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return clean(z.toJSONSchema(schema)) as Record<string, unknown>;
}

export function claudeJsonFormat(schema: z.ZodType): { type: "json_schema"; schema: Record<string, unknown> } {
  return { type: "json_schema", schema: toClaudeJsonSchema(schema) };
}
