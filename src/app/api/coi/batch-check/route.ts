import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { coiDetector } from "@/lib/coi-detector";
import { z } from "zod";

// Author roles with priority mapping (scientific convention)
// Last author = PI/senior (most important)
// First author = did the work (second most important)
// Middle authors: early (2nd-3rd) more important than late (4th+)
type AuthorRole = "corresponding" | "first" | "last" | "middle_early" | "middle_late";

const ROLE_SEVERITY: Record<AuthorRole, "critical" | "high" | "medium"> = {
  last: "critical",         // PI/senior author - most important
  first: "critical",        // Primary author - second most important  
  corresponding: "critical", // Often same as last, but if different still critical
  middle_early: "high",     // 2nd-3rd authors
  middle_late: "medium",    // 4th+ authors
};

const authorSchema = z.object({
  name: z.string().min(1),
  orcid: z.string().optional().nullable(),
  role: z.enum(["corresponding", "first", "last", "middle_early", "middle_late"]),
  position: z.number().optional(),
});

const reviewerSchema = z.object({
  name: z.string().min(1),
  orcid: z.string().optional().nullable(),
});

const batchCheckSchema = z.object({
  authors: z.array(authorSchema).min(1, "At least one author is required").max(50),
  reviewers: z.array(reviewerSchema).min(1, "At least one reviewer is required").max(20),
  fromYear: z.number().optional(),
});

interface ConflictIndicator {
  type: "coauthorship" | "affiliation";
  authorName: string;
  authorRole: AuthorRole;
  reviewerName: string;
  details: {
    title?: string;
    year?: number;
    doi?: string;
    openAlexId?: string;
    institutionName?: string;
    affiliationType?: string;
  };
  severity: "critical" | "high" | "medium" | "low";
}

interface BatchResult {
  summary: {
    totalChecks: number;
    conflictsFound: number;
    criticalConflicts: number;
    highConflicts: number;
    mediumConflicts: number;
    lowConflicts: number;
  };
  conflicts: ConflictIndicator[];
  clearPairs: { author: string; reviewer: string }[];
  checkedAt: string;
}

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parseResult = batchCheckSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error.issues[0].message },
        { status: 400 }
      );
    }

    const { authors, reviewers, fromYear } = parseResult.data;
    
    const conflicts: ConflictIndicator[] = [];
    const clearPairs: { author: string; reviewer: string }[] = [];
    const totalChecks = authors.length * reviewers.length;

    console.log(`[COI Batch] Starting batch check: ${authors.length} authors x ${reviewers.length} reviewers = ${totalChecks} checks`);

    // Check each author against each reviewer
    for (const author of authors) {
      for (const reviewer of reviewers) {
        console.log(`[COI Batch] Checking: ${author.name} (${author.role}) vs ${reviewer.name}`);
        
        try {
          // Run COI check for this pair
          const report = await coiDetector.generateReport(
            [{ name: author.name, orcid: author.orcid }],
            { name: reviewer.name, orcid: reviewer.orcid },
            fromYear,
            true // Check affiliations
          );

          if (report.hasConflict) {
            // Determine severity based on author role
            const baseSeverity = ROLE_SEVERITY[author.role as AuthorRole];
            
            // Add co-authored papers as conflicts
            for (const paper of report.coauthoredPapers) {
              conflicts.push({
                type: "coauthorship",
                authorName: author.name,
                authorRole: author.role as AuthorRole,
                reviewerName: reviewer.name,
                details: {
                  title: paper.title,
                  year: paper.year,
                  doi: paper.doi,
                  openAlexId: paper.openAlexId,
                },
                severity: baseSeverity,
              });
            }

            // Add shared institutions as conflicts
            if (report.sharedInstitutions) {
              for (const inst of report.sharedInstitutions) {
                // Institution conflicts are slightly lower priority
                const instSeverity = baseSeverity === "critical" ? "high" : 
                                     baseSeverity === "high" ? "medium" : "low";
                
                conflicts.push({
                  type: "affiliation",
                  authorName: author.name,
                  authorRole: author.role as AuthorRole,
                  reviewerName: reviewer.name,
                  details: {
                    institutionName: inst.name,
                    affiliationType: inst.type,
                  },
                  severity: instSeverity as "critical" | "high" | "medium" | "low",
                });
              }
            }
          } else {
            clearPairs.push({
              author: author.name,
              reviewer: reviewer.name,
            });
          }
        } catch (error) {
          console.error(`[COI Batch] Error checking ${author.name} vs ${reviewer.name}:`, error);
          // Continue with other pairs
        }

        // Small delay to avoid overwhelming APIs
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Sort conflicts by severity
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    conflicts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    // Calculate summary
    const summary = {
      totalChecks,
      conflictsFound: conflicts.length,
      criticalConflicts: conflicts.filter(c => c.severity === "critical").length,
      highConflicts: conflicts.filter(c => c.severity === "high").length,
      mediumConflicts: conflicts.filter(c => c.severity === "medium").length,
      lowConflicts: conflicts.filter(c => c.severity === "low").length,
    };

    const result: BatchResult = {
      summary,
      conflicts,
      clearPairs,
      checkedAt: new Date().toISOString(),
    };

    console.log(`[COI Batch] Complete: ${summary.conflictsFound} conflicts found (${summary.criticalConflicts} critical)`);

    return NextResponse.json({
      result,
      disclaimer: "These results are automated indicators only. Author role-based priority helps triage but all conflicts require editorial review. Clear results do not guarantee absence of all potential conflicts.",
      metadata: {
        dataSources: ["OpenAlex"],
        limitations: [
          "Only checks co-authorship and institutional affiliation",
          "May not capture all name variations",
          "Does not check funding, editorial boards, or other conflict types"
        ]
      }
    });
  } catch (error) {
    console.error("Error in batch COI check:", error);
    return NextResponse.json(
      { error: "Failed to complete batch COI check" },
      { status: 500 }
    );
  }
}
