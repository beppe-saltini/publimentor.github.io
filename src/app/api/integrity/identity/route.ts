import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { verifyAuthors, type AuthorIdentityCheck } from "@/lib/identity-verifier";
import { z } from "zod";
import {
  checkRateLimit,
  getRateLimitResponse,
  sanitizeString,
} from "@/lib/security";

// Rate limit: 15 requests per minute
const IDENTITY_RATE_LIMIT = { windowMs: 60000, maxRequests: 15 };

const authorSchema = z.object({
  name: z.string().min(1, "Author name is required").max(200),
  email: z.string().email().max(254).optional().or(z.literal("")),
  orcid: z.string().max(50).optional().or(z.literal("")),
  affiliation: z.string().max(500).optional().or(z.literal("")),
});

const requestSchema = z.object({
  authors: z.array(authorSchema).min(1, "At least one author is required").max(20, "Maximum 20 authors per request"),
});

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Rate limiting
    const rateLimit = checkRateLimit(`identity:${session.user.id}`, IDENTITY_RATE_LIMIT);
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

    const { authors } = parseResult.data;

    // Convert to AuthorIdentityCheck format (handle empty strings)
    const authorsToCheck: AuthorIdentityCheck[] = authors.map(a => ({
      name: a.name,
      email: a.email || undefined,
      orcid: a.orcid || undefined,
      affiliation: a.affiliation || undefined,
    }));

    // Run verification
    const results = await verifyAuthors(authorsToCheck);

    // Calculate summary stats
    const totalIndicators = results.reduce((sum, r) => sum + r.indicatorsFound, 0);
    const authorsWithIssues = results.filter(r => r.indicatorsFound > 0).length;

    return NextResponse.json({
      results,
      summary: {
        totalAuthors: results.length,
        authorsWithIndicators: authorsWithIssues,
        totalIndicators,
        overallStatus: totalIndicators === 0 ? "clear" : totalIndicators <= 2 ? "review" : "attention",
      },
      disclaimer: "These results are automated indicators only. Identity verification involves many factors that cannot be fully assessed automatically. All findings require editorial review and human judgment before any action is taken.",
      metadata: {
        checkedAt: new Date().toISOString(),
        dataSources: ["ORCID Public API", "ROR API"],
        limitations: [
          "ORCID validation only checks public profile data",
          "Email domain classification may not catch all personal/institutional patterns",
          "ROR database may not include all institutions, especially smaller or newer ones",
          "Name matching cannot account for all legitimate variations",
        ],
      },
    });
  } catch (error) {
    console.error("Error verifying author identity:", error);
    return NextResponse.json(
      { error: "Failed to verify author identity" },
      { status: 500 }
    );
  }
}
