import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { detectTorturedPhrases } from "@/lib/tortured-phrases";
import { verifyAuthors, type AuthorIdentityCheck } from "@/lib/identity-verifier";
import {
  parseReferencesForMetadata,
  validateReferencesByMetadata,
} from "@/lib/references/reference-metadata-validator";
import { z } from "zod";
import {
  checkRateLimit,
  getRateLimitResponse,
} from "@/lib/security";

// Rate limit: 5 full reports per minute (expensive operation)
const FULL_REPORT_RATE_LIMIT = { windowMs: 60000, maxRequests: 5 };

const authorSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(254).optional().or(z.literal("")),
  orcid: z.string().max(50).optional().or(z.literal("")),
  affiliation: z.string().max(500).optional().or(z.literal("")),
});

const requestSchema = z.object({
  // Text for tortured phrase detection
  text: z.string().min(100, "Text must be at least 100 characters").optional(),
  // Authors for identity verification
  authors: z.array(authorSchema).max(20).optional(),
  // References for validation (raw text or structured)
  referenceText: z.string().min(50).optional(),
  // Which checks to run (default: all provided)
  checks: z.object({
    torturedPhrases: z.boolean().default(true),
    authorIdentity: z.boolean().default(true),
    references: z.boolean().default(true),
  }).optional(),
});

export type FullIntegrityReportResponse = {
  reportId: string;
  generatedAt: string;
  overallAssessment: {
    riskLevel: "clear" | "review" | "attention";
    totalIndicators: number;
    checksCompleted: number;
    checksFailed: number;
  };
  torturedPhrases?: {
    ran: boolean;
    result?: {
      found: boolean;
      matchCount: number;
      severity: string;
      summary: string;
      matches: Array<{
        matchedText: string;
        originalPhrase: string;
        category: string;
        severity: string;
        context: string;
      }>;
    };
    error?: string;
  };
  authorIdentity?: {
    ran: boolean;
    result?: {
      totalAuthors: number;
      authorsWithIndicators: number;
      totalIndicators: number;
      authors: Array<{
        name: string;
        overallConfidence: string;
        indicatorsFound: number;
        summary: string;
      }>;
    };
    error?: string;
  };
  references?: {
    ran: boolean;
    result?: {
      total: number;
      validated: number;
      fake: number;
      unsure: number;
    };
    error?: string;
  };
  disclaimer: string;
  metadata: {
    dataSources: string[];
    limitations: string[];
  };
};

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Rate limiting
    const rateLimit = checkRateLimit(`full-report:${session.user.id}`, FULL_REPORT_RATE_LIMIT);
    if (!rateLimit.allowed) {
      return getRateLimitResponse(rateLimit.resetIn);
    }

    const body = await request.json();
    const parseResult = requestSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error.issues[0].message },
        { status: 400 }
      );
    }

    const { text, authors, referenceText, checks } = parseResult.data;

    const shouldRunTortured = (checks?.torturedPhrases ?? true) && !!text;
    const shouldRunIdentity = (checks?.authorIdentity ?? true) && !!authors && authors.length > 0;
    const shouldRunReferences = (checks?.references ?? true) && !!referenceText;

    if (!shouldRunTortured && !shouldRunIdentity && !shouldRunReferences) {
      return NextResponse.json(
        { error: "No checks to run. Provide text, authors, or references." },
        { status: 400 }
      );
    }

    // Run all checks in parallel
    const [torturedResult, identityResult, referenceResult] = await Promise.allSettled([
      shouldRunTortured
        ? Promise.resolve(detectTorturedPhrases(text!))
        : Promise.resolve(null),
      shouldRunIdentity
        ? verifyAuthors(
            authors!.map((a): AuthorIdentityCheck => ({
              name: a.name,
              email: a.email || undefined,
              orcid: a.orcid || undefined,
              affiliation: a.affiliation || undefined,
            }))
          )
        : Promise.resolve(null),
      shouldRunReferences
        ? (async () => {
            const refs = parseReferencesForMetadata(referenceText!);
            if (refs.length === 0) return null;
            return validateReferencesByMetadata(refs);
          })()
        : Promise.resolve(null),
    ]);

    // Assemble report
    let totalIndicators = 0;
    let checksCompleted = 0;
    let checksFailed = 0;
    const dataSources: string[] = [];
    const limitations: string[] = [];

    // Process tortured phrases result
    let torturedReport: FullIntegrityReportResponse["torturedPhrases"];
    if (shouldRunTortured) {
      if (torturedResult.status === "fulfilled" && torturedResult.value) {
        const r = torturedResult.value;
        checksCompleted++;
        totalIndicators += r.matchCount;
        dataSources.push("Problematic Paper Screener corpus");
        limitations.push("Only checks for known tortured phrase patterns");
        torturedReport = {
          ran: true,
          result: {
            found: r.found,
            matchCount: r.matchCount,
            severity: r.severity,
            summary: r.summary,
            matches: r.matches.map((m) => ({
              matchedText: m.matchedText,
              originalPhrase: m.pattern.originalPhrase,
              category: m.pattern.category,
              severity: m.pattern.severity,
              context: m.location.context,
            })),
          },
        };
      } else {
        checksFailed++;
        torturedReport = {
          ran: true,
          error: torturedResult.status === "rejected"
            ? torturedResult.reason?.message || "Analysis failed"
            : "No result",
        };
      }
    }

    // Process identity result
    let identityReport: FullIntegrityReportResponse["authorIdentity"];
    if (shouldRunIdentity) {
      if (identityResult.status === "fulfilled" && identityResult.value) {
        const results = identityResult.value;
        checksCompleted++;
        const authIndicators = results.reduce((sum, r) => sum + r.indicatorsFound, 0);
        totalIndicators += authIndicators;
        dataSources.push("ORCID Public API", "ROR API");
        limitations.push("ORCID validation only checks public profile data");
        identityReport = {
          ran: true,
          result: {
            totalAuthors: results.length,
            authorsWithIndicators: results.filter((r) => r.indicatorsFound > 0).length,
            totalIndicators: authIndicators,
            authors: results.map((r) => ({
              name: r.author.name,
              overallConfidence: r.overallConfidence,
              indicatorsFound: r.indicatorsFound,
              summary: r.summary,
            })),
          },
        };
      } else {
        checksFailed++;
        identityReport = {
          ran: true,
          error: identityResult.status === "rejected"
            ? identityResult.reason?.message || "Verification failed"
            : "No result",
        };
      }
    }

    // Process reference result
    let referenceReport: FullIntegrityReportResponse["references"];
    if (shouldRunReferences) {
      if (referenceResult.status === "fulfilled" && referenceResult.value) {
        const r = referenceResult.value;
        checksCompleted++;
        totalIndicators += r.summary.fake + r.summary.unsure;
        dataSources.push("OpenAlex API", "Crossref Works API", "PubMed E-utilities");
        limitations.push("Reference validation uses title/author/year matching, not DOI alone");
        referenceReport = {
          ran: true,
          result: {
            total: r.summary.total,
            validated: r.summary.validated,
            fake: r.summary.fake,
            unsure: r.summary.unsure,
          },
        };
      } else {
        checksFailed++;
        referenceReport = {
          ran: true,
          error: referenceResult.status === "rejected"
            ? referenceResult.reason?.message || "Validation failed"
            : "No result",
        };
      }
    }

    // Determine overall risk level
    let riskLevel: "clear" | "review" | "attention" = "clear";
    if (totalIndicators > 0) riskLevel = "review";
    if (totalIndicators >= 3) riskLevel = "attention";
    if (referenceReport?.result?.fake && referenceReport.result.fake > 0) {
      riskLevel = "attention";
    }

    const report: FullIntegrityReportResponse = {
      reportId: `ir-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      generatedAt: new Date().toISOString(),
      overallAssessment: {
        riskLevel,
        totalIndicators,
        checksCompleted,
        checksFailed,
      },
      torturedPhrases: torturedReport,
      authorIdentity: identityReport,
      references: referenceReport,
      disclaimer:
        "This automated integrity screening provides indicators only and does not constitute " +
        "accusations or determinations of misconduct. All findings require editorial review " +
        "and human judgment. Unusual patterns may have legitimate explanations.",
      metadata: {
        dataSources: [...new Set(dataSources)],
        limitations: [...new Set(limitations)],
      },
    };

    return NextResponse.json(report);
  } catch (error) {
    console.error("Error generating full integrity report:", error);
    return NextResponse.json(
      { error: "Failed to generate integrity report" },
      { status: 500 }
    );
  }
}
