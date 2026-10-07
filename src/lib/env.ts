/**
 * Environment Variable Validation
 *
 * Runs once when the server starts (see src/instrumentation.ts). Two tiers:
 *   - required: the app cannot serve a single request without them; in
 *     production a problem here throws and the deployment fails loudly.
 *   - optional: features that degrade gracefully; a bad value is logged as a
 *     warning and the variable is treated as unset.
 */

import { z } from "zod";

const WEAK_SECRETS = ["super-secret", "change-me", "secret", "password"];

const secret = z
  .string()
  .min(16, "must be at least 16 characters")
  .refine((val) => !WEAK_SECRETS.some((s) => val.toLowerCase().includes(s)), "must not be a default/weak value");

const requiredSchema = z.object({
  DATABASE_URL: z.string().url("must be a PostgreSQL connection string"),
});

const optionalSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3000),
  DIRECT_URL: z.string().url().optional(),

  // --- Authentication (one of the two secrets is required, checked below) ---
  NEXTAUTH_SECRET: secret.optional(),
  AUTH_SECRET: secret.optional(),
  NEXTAUTH_URL: z.string().url().optional(),
  AUTH_TRUST_HOST: z.enum(["true", "false"]).optional(),
  ORCID_CLIENT_ID: z.string().optional(),
  ORCID_CLIENT_SECRET: z.string().optional(),

  // --- Claude ---
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_PRIMARY_MODEL: z.string().optional(),
  ANTHROPIC_HAIKU_MODEL: z.string().optional(),

  // --- Literature / web search ---
  OPENALEX_EMAIL: z.string().email().optional(),
  GOOGLE_CSE_API_KEY: z.string().optional(),
  GOOGLE_CSE_ID: z.string().optional(),
  SERPER_API_KEY: z.string().optional(),
  BRAVE_SEARCH_API_KEY: z.string().optional(),
  DECEASED_CLAUDE_SEARCH: z.enum(["on", "off"]).optional(),
  DECEASED_CLAUDE_MAX_PER_SEARCH: z.coerce.number().int().min(0).optional(),

  // --- Storage ---
  STORAGE_PROVIDER: z.enum(["local", "s3", "supabase"]).default("local"),
  LOCAL_STORAGE_PATH: z.string().optional(),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_KEY: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_ENDPOINT: z.string().url().optional(),

  // --- Rate limiting (Upstash Redis over REST; Vercel KV names or Upstash names) ---
  KV_REST_API_URL: z.string().url().optional(),
  KV_REST_API_TOKEN: z.string().optional(),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  // --- Embeddings ---
  HF_API_TOKEN: z.string().optional(),
  EMBEDDING_MODEL: z.string().optional(),

  // --- Monitoring / logging ---
  SENTRY_DSN: z.string().url().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  SERVICE_NAME: z.string().default("publimentor"),
  APP_VERSION: z.string().default("0.1.0"),
});

export type Env = z.infer<typeof requiredSchema> & z.infer<typeof optionalSchema>;

export interface EnvValidation {
  env: Env | null;
  errors: string[];
  warnings: string[];
}

function issues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
}

/**
 * Validate a set of variables without side effects. Exported for tests.
 */
export function validateEnvValues(source: Record<string, string | undefined>): EnvValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Values pasted into hosting dashboards sometimes carry a trailing newline;
  // the rest of the code trims before use, so validation does the same.
  source = Object.fromEntries(Object.entries(source).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]));

  const required = requiredSchema.safeParse(source);
  if (!required.success) errors.push(...issues(required.error));

  // Optional variables are checked one by one so a single bad value only drops that value.
  const cleaned: Record<string, string | undefined> = { ...source };
  for (const key of Object.keys(optionalSchema.shape) as Array<keyof typeof optionalSchema.shape>) {
    if (source[key] === undefined || source[key] === "") {
      delete cleaned[key];
      continue;
    }
    const check = optionalSchema.shape[key].safeParse(source[key]);
    if (!check.success) {
      warnings.push(`${key}: ${check.error.issues[0]?.message ?? "invalid"} (ignored)`);
      delete cleaned[key];
    }
  }
  const optional = optionalSchema.parse(cleaned);

  if (!optional.NEXTAUTH_SECRET && !optional.AUTH_SECRET) {
    errors.push("AUTH_SECRET or NEXTAUTH_SECRET: required (generate one with `openssl rand -base64 32`)");
  }
  if (optional.STORAGE_PROVIDER === "supabase" && (!optional.SUPABASE_URL || !optional.SUPABASE_SERVICE_KEY)) {
    warnings.push("STORAGE_PROVIDER=supabase but SUPABASE_URL/SUPABASE_SERVICE_KEY are missing: uploads will fail");
  }
  if (!optional.ANTHROPIC_API_KEY) {
    warnings.push("ANTHROPIC_API_KEY is not set: metadata extraction, keyword suggestions and reviewer ranking are disabled");
  }
  if (optional.NODE_ENV === "production" && !(optional.KV_REST_API_URL && optional.KV_REST_API_TOKEN) && !(optional.UPSTASH_REDIS_REST_URL && optional.UPSTASH_REDIS_REST_TOKEN)) {
    warnings.push("No Upstash/KV credentials: rate limits are per server instance only");
  }

  return {
    env: errors.length === 0 && required.success ? { ...required.data, ...optional } : null,
    errors,
    warnings,
  };
}

let validated: EnvValidation | null = null;

/**
 * Validate process.env once at server start. Logs warnings; throws in
 * production when a required variable is missing. In development it logs the
 * errors and continues, so a half-configured checkout still boots.
 */
export function validateEnv(): EnvValidation {
  if (validated) return validated;
  const result = validateEnvValues(process.env);

  for (const warning of result.warnings) console.warn(`[ENV] ${warning}`);
  if (result.errors.length > 0) {
    const text = result.errors.map((e) => `  - ${e}`).join("\n");
    if (process.env.NODE_ENV === "production") {
      throw new Error(`Environment validation failed:\n${text}`);
    }
    console.error(`[ENV] Missing or invalid configuration:\n${text}\n[ENV] Continuing in ${process.env.NODE_ENV || "development"} mode.`);
  }

  validated = result;
  return result;
}
