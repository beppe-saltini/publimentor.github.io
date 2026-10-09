/**
 * API Input Validation Schemas
 *
 * Centralized Zod schemas for all API route input validation.
 * Every API endpoint should validate input at the boundary using these schemas.
 */

import { z } from "zod";

// ============================================================
// Common Primitives
// ============================================================

export const cuidSchema = z.string().cuid();
export const slugSchema = z.string().min(2).max(100).regex(/^[a-z0-9-]+$/);
export const emailSchema = z.string().email();
export const urlSchema = z.string().url();

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const searchSchema = z.object({
  q: z.string().min(1).max(500).optional(),
  ...paginationSchema.shape,
});

// ============================================================
// Authentication
// ============================================================

export const registerSchema = z.object({
  name: z.string().min(2).max(100).trim(),
  email: z.string().email("Invalid email address"),
  password: z
    .string()
    .min(10, "Password must be at least 10 characters")
    .max(128)
    .regex(/[A-Z]/, "Must contain an uppercase letter")
    .regex(/[a-z]/, "Must contain a lowercase letter")
    .regex(/[0-9]/, "Must contain a number")
    .regex(/[!@#$%^&*(),.?":{}|<>]/, "Must contain a special character"),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ============================================================
// Publishers
// ============================================================

export const createPublisherSchema = z.object({
  name: z.string().min(2).max(200).trim(),
  slug: slugSchema,
  website: z.string().url().optional(),
  logoUrl: z.string().url().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

export const updatePublisherSchema = createPublisherSchema.partial();

// ============================================================
// Journals
// ============================================================

export const createJournalSchema = z.object({
  name: z.string().min(2).max(200).trim(),
  slug: slugSchema,
  description: z.string().max(2000).optional(),
  logoUrl: z.string().url().optional(),
  publisherId: cuidSchema.optional(),
});

export const updateJournalSchema = createJournalSchema.partial();

export const addJournalMemberSchema = z.object({
  userId: cuidSchema,
  role: z.enum(["ADMIN", "EDITOR", "REVIEWER"]).default("REVIEWER"),
});

// ============================================================
// Manuscripts
// ============================================================

export const uploadManuscriptSchema = z.object({
  publisherId: cuidSchema,
  journalId: cuidSchema.optional(),
});

export const updateManuscriptSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  abstract: z.string().max(10000).optional(),
  keywords: z.array(z.string().max(100)).max(20).optional(),
  journalId: cuidSchema.nullable().optional(),
});

// ============================================================
// Submissions
// ============================================================

export const createSubmissionSchema = z.object({
  title: z.string().min(5).max(500).trim(),
  abstract: z.string().max(10000).optional(),
  authors: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        email: z.string().email().optional(),
        orcid: z.string().optional(),
        affiliation: z.string().optional(),
        order: z.number().int().min(0),
      })
    )
    .min(1, "At least one author is required"),
});

// ============================================================
// Reviewer Discovery
// ============================================================

export const reviewerSearchSchema = z.object({
  primaryKeywords: z.array(z.string().max(200)).min(1).max(10),
  secondaryKeywords: z.array(z.string().max(200)).max(10).optional(),
  excludeAuthors: z.array(z.string()).optional(),
  count: z.coerce.number().int().min(1).max(50).default(15),
  requireSenior: z.boolean().default(false),
  diversifyGeography: z.boolean().default(true),
  diversifyInstitutions: z.boolean().default(true),
});

// ============================================================
// COI (Conflict of Interest)
// ============================================================

export const coiCheckSchema = z.object({
  authorName: z.string().min(1).max(200),
  reviewerName: z.string().min(1).max(200),
  authorInstitution: z.string().optional(),
  reviewerInstitution: z.string().optional(),
  yearsBack: z.coerce.number().int().min(1).max(20).default(5),
});

export const coiBatchCheckSchema = z.object({
  authorNames: z.array(z.string().min(1).max(200)).min(1).max(50),
  reviewerName: z.string().min(1).max(200),
  yearsBack: z.coerce.number().int().min(1).max(20).default(5),
});

// ============================================================
// Format Check
// ============================================================

/** Status an editor may assign to a check when overriding the automatic result. */
export const formatCheckStatusSchema = z.enum([
  "pass",
  "fail",
  "review",
  "not_applicable",
  "unknown",
]);

/**
 * Explicit journal-profile override (e.g. "iscience"). Only the shape is checked
 * here; the routes verify the id exists in the profile registry and answer 400.
 */
export const formatProfileIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._-]*$/i, "Invalid profile id");

/**
 * `format` flag of the check routes: run the Journal-Ready Formatter after the
 * checks (default true). Multipart fields arrive as strings, so "false"/"0"/"no"
 * are accepted alongside a JSON boolean.
 */
export const formatFlagSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const v = value.trim().toLowerCase();
  if (["false", "0", "no", "off"].includes(v)) return false;
  if (["true", "1", "yes", "on", ""].includes(v)) return true;
  return value;
}, z.boolean().default(true));

/** Text fields of POST /api/format/check (multipart; the file itself is validated separately). */
export const formatCheckUploadSchema = z.object({
  journalSlug: slugSchema.optional(),
  manuscriptId: cuidSchema.optional(),
  profileId: formatProfileIdSchema.optional(),
  format: formatFlagSchema,
});

/** Body of POST /api/format/check-manuscript. */
export const formatCheckManuscriptSchema = z.object({
  manuscriptId: cuidSchema,
  journalSlug: slugSchema.optional(),
  profileId: formatProfileIdSchema.optional(),
  format: formatFlagSchema,
});

/** Body of POST /api/format/reports/[id]/format (re-run formatting on a stored report). */
export const formatReformatSchema = z
  .object({
    profileId: formatProfileIdSchema.optional(),
    repairReferences: z.boolean().optional(),
  })
  .default({});

/** ?kind= of GET /api/format/reports/[id]/file. */
export const formatFileKindSchema = z.enum(["formatted", "tracked", "change-log", "letter"]);

/** Query string of GET /api/format/reports. */
export const formatReportsQuerySchema = z.object({
  manuscriptId: cuidSchema.optional(),
  journalSlug: slugSchema.optional(),
});

/** One editor override: force a status and/or attach a note to a check. */
export const formatCheckOverrideSchema = z.object({
  status: formatCheckStatusSchema.optional(),
  note: z.string().max(2000).optional(),
});

/** Body of PATCH /api/format/reports/[id]; at least one field must be present. */
export const formatReportPatchSchema = z
  .object({
    overrides: z.record(z.string().min(1).max(100), formatCheckOverrideSchema).optional(),
    letterText: z.string().max(200_000).optional(),
  })
  .refine((v) => v.overrides !== undefined || v.letterText !== undefined, {
    message: "Provide overrides and/or letterText",
  });

/** ?format= of GET /api/format/reports/[id]/letter (txt default) and ...?kind=letter (docx default). */
export const formatLetterFormatSchema = z.enum(["docx", "txt"]).default("txt");
export const formatLetterFileFormatSchema = z.enum(["docx", "txt"]).default("docx");

// ============================================================
// Integrity Check
// ============================================================

export const integrityCheckSchema = z.object({
  text: z.string().min(10).max(500000),
  checkType: z.enum([
    "tortured-phrases",
    "identity",
    "references",
  ]),
});

// ============================================================
// Search String Builder
// ============================================================

export const searchStringSchema = z.object({
  keywords: z.array(z.string()).min(1).max(20),
  operators: z
    .enum(["AND", "OR"])
    .default("AND"),
  database: z
    .enum(["pubmed", "scopus", "wos"])
    .default("pubmed"),
});
