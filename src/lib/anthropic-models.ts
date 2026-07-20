/**
 * Central Anthropic model configuration.
 *
 * Model IDs were previously hardcoded across the codebase; when Anthropic
 * retired claude-sonnet-4-20250514, every manuscript upload failed with
 * "Claude API error: 404" (July 2026). Three defences against a repeat:
 *
 * 1. All model IDs live here and can be overridden via env vars in the
 *    Vercel dashboard — no redeploy needed.
 * 2. Defaults use undated aliases, which track the latest snapshot and
 *    survive snapshot retirements.
 * 3. resolveReplacementModel() lets critical paths recover at runtime by
 *    picking a live model from the API if even the alias disappears.
 *
 * A scheduled GitHub Action (anthropic-model-check.yml on the main branch)
 * additionally verifies these models daily and fails loudly if one is gone.
 */

function cleanEnv(value: string | undefined): string {
  // Vercel env vars occasionally carry a trailing literal "\n"
  return (value || "").replace(/(\\n|\s)+$/g, "").trim();
}

/** Primary model: metadata extraction, reviewer ranking, invitations, journal suggestions. */
export const ANTHROPIC_SONNET_MODEL =
  cleanEnv(process.env.ANTHROPIC_SONNET_MODEL) || "claude-sonnet-4-5";

/** Fast/cheap model: reference parsing, keyword suggestions. */
export const ANTHROPIC_HAIKU_MODEL =
  cleanEnv(process.env.ANTHROPIC_HAIKU_MODEL) || "claude-haiku-4-5";

/** True when a response indicates the requested model no longer exists. */
export function isModelNotFoundResponse(status: number, body: string): boolean {
  return status === 404 && /model/i.test(body);
}

const replacementCache = new Map<string, string>();

/**
 * Return the newest available model whose id starts with the given family
 * prefix (e.g. "claude-sonnet"), by querying the live models list.
 * The Anthropic API returns models newest-first.
 *
 * Used as a last-resort fallback when the configured model has been retired.
 */
export async function resolveReplacementModel(
  familyPrefix: string,
  apiKey: string
): Promise<string | null> {
  const cached = replacementCache.get(familyPrefix);
  if (cached) return cached;

  try {
    const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as { data?: Array<{ id: string }> };
    const match = data.data?.find((m) => m.id.startsWith(familyPrefix));
    if (!match) return null;

    replacementCache.set(familyPrefix, match.id);
    return match.id;
  } catch {
    return null;
  }
}

/** Family prefix ("claude-sonnet" / "claude-haiku") for a model id. */
export function modelFamily(model: string): string {
  const parts = model.split("-");
  return parts.length >= 2 ? `${parts[0]}-${parts[1]}` : model;
}
