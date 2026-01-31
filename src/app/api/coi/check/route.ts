import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { coiDetector } from "@/lib/coi-detector";
import { z } from "zod";
import {
  checkRateLimit,
  getRateLimitResponse,
  sanitizeString,
  auditLog,
  getClientIp,
  getUserAgent,
} from "@/lib/security";

// Rate limit: 20 requests per minute
const COI_RATE_LIMIT = { windowMs: 60000, maxRequests: 20 };

const coiCheckSchema = z.object({
  authors: z.array(
    z.object({
      name: z.string().max(200),
      orcid: z.string().max(50).optional().nullable(),
      openAlexId: z.string().max(100).optional(),
    })
  ).min(1, "At least one author is required").max(50, "Maximum 50 authors"),
  reviewer: z.object({
    name: z.string().max(200),
    orcid: z.string().max(50).optional().nullable(),
    openAlexId: z.string().max(100).optional(),
  }),
  fromYear: z.number().min(1900).max(2100).optional(),
});

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const clientIp = getClientIp(request);
    
    // Rate limiting
    const rateLimit = checkRateLimit(`coi:${session.user.id}`, COI_RATE_LIMIT);
    if (!rateLimit.allowed) {
      return getRateLimitResponse(rateLimit.resetIn);
    }

    const body = await request.json();
    const result = coiCheckSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error.issues[0].message },
        { status: 400 }
      );
    }

    const { authors, reviewer, fromYear } = result.data;

    const report = await coiDetector.generateReport(authors, reviewer, fromYear);

    return NextResponse.json({ 
      report,
      disclaimer: "These results are automated indicators only and do not constitute accusations or determinations. All potential indicators require editorial review and human judgment before any action is taken.",
      metadata: {
        dataSources: ["OpenAlex"],
        limitations: [
          "Only checks co-authorship history available in OpenAlex database",
          "May not capture all name variations or affiliations",
          "Does not check funding overlaps, editorial board membership, or institutional conflicts"
        ]
      }
    });
  } catch (error) {
    console.error("Error checking COI:", error);
    return NextResponse.json(
      { error: "Failed to check conflict of interest" },
      { status: 500 }
    );
  }
}
