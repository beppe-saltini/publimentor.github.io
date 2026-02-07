/**
 * Environment Variable Validation
 *
 * Validates all required environment variables at startup using Zod.
 * Fails fast with clear error messages if configuration is missing.
 */

import { z } from "zod";

// ============================================================
// Schema Definition
// ============================================================

const envSchema = z.object({
  // --- Core ---
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().default(3000),

  // --- Database ---
  DATABASE_URL: z
    .string()
    .url("DATABASE_URL must be a valid PostgreSQL connection string"),
  DIRECT_URL: z
    .string()
    .url()
    .optional(),

  // --- Authentication ---
  NEXTAUTH_SECRET: z
    .string()
    .min(16, "NEXTAUTH_SECRET must be at least 16 characters")
    .refine(
      (val) => !["super-secret", "change-me", "secret"].some((s) => val.includes(s)),
      "NEXTAUTH_SECRET must not contain default/weak values"
    ),
  NEXTAUTH_URL: z.string().url().optional(),
  AUTH_TRUST_HOST: z
    .enum(["true", "false"])
    .transform((val) => val === "true")
    .optional(),

  // --- OAuth ---
  ORCID_CLIENT_ID: z.string().optional(),
  ORCID_CLIENT_SECRET: z.string().optional(),

  // --- External APIs ---
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENALEX_EMAIL: z.string().email().optional(),

  // --- Storage ---
  STORAGE_PROVIDER: z
    .enum(["local", "s3", "supabase"])
    .default("local"),
  LOCAL_STORAGE_PATH: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_ENDPOINT: z.string().url().optional(),

  // --- Redis (for production rate limiting) ---
  REDIS_URL: z.string().url().optional(),

  // --- Monitoring ---
  SENTRY_DSN: z.string().url().optional(),

  // --- Logging ---
  LOG_LEVEL: z
    .enum(["debug", "info", "warn", "error"])
    .default("info"),
  SERVICE_NAME: z.string().default("publimentor"),
  APP_VERSION: z.string().default("0.1.0"),
});

// ============================================================
// Type Export
// ============================================================

export type Env = z.infer<typeof envSchema>;

// ============================================================
// Validation
// ============================================================

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.issues.map((issue) => {
      const path = issue.path.join(".");
      return `  - ${path}: ${issue.message}`;
    });

    console.error(
      "\n" +
      "╔══════════════════════════════════════════════════╗\n" +
      "║  ENVIRONMENT VALIDATION FAILED                  ║\n" +
      "╠══════════════════════════════════════════════════╣\n" +
      "║  The following environment variables are         ║\n" +
      "║  missing or invalid:                             ║\n" +
      "╚══════════════════════════════════════════════════╝\n" +
      "\n" +
      errors.join("\n") +
      "\n\n" +
      "Check your .env file or environment configuration.\n"
    );

    // In development, warn but continue (some vars might not be needed)
    if (process.env.NODE_ENV === "development") {
      console.warn("[ENV] Running in development mode with incomplete env vars.\n");
      // SECURITY: DATABASE_URL still gets a safe local default, but
      // NEXTAUTH_SECRET must always be explicitly set — even in dev.
      // A hardcoded fallback could leak into production via misconfiguration.
      if (!process.env.NEXTAUTH_SECRET) {
        throw new Error(
          "NEXTAUTH_SECRET is required even in development.\n" +
          "Generate one with: openssl rand -base64 32\n" +
          "Then add it to your .env file."
        );
      }
      return envSchema.parse({
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/publimentor",
      });
    }

    throw new Error(
      `Environment validation failed:\n${errors.join("\n")}`
    );
  }

  return result.data;
}

// ============================================================
// Singleton Export
// ============================================================

/** Validated environment variables. Access with `env.DATABASE_URL` etc. */
export const env = validateEnv();
