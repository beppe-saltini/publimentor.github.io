import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { parseReferences, validateReferences, type ReferenceInput } from "@/lib/reference-validator";
import { z } from "zod";

const referenceSchema = z.object({
  raw: z.string(),
  doi: z.string().optional(),
  pmid: z.string().optional(),
});

const requestSchema = z.union([
  z.object({
    text: z.string().min(50, "Reference text must be at least 50 characters"),
  }),
  z.object({
    references: z.array(referenceSchema).min(1).max(100),
  }),
]);

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parseResult = requestSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error.issues[0].message },
        { status: 400 }
      );
    }

    // Parse references from text or use provided references
    let references: ReferenceInput[];
    
    if ("text" in parseResult.data) {
      references = parseReferences(parseResult.data.text);
      
      if (references.length === 0) {
        return NextResponse.json(
          { error: "No references found in the provided text" },
          { status: 400 }
        );
      }
    } else {
      references = parseResult.data.references;
    }

    // Validate references
    const result = await validateReferences(references);

    return NextResponse.json({
      ...result,
      metadata: {
        checkedAt: new Date().toISOString(),
        dataSources: ["Crossref API", "PubMed E-utilities"],
        limitations: [
          "Retraction checks may not capture all retractions",
          "Only DOIs and PMIDs are validated - other identifiers are not checked",
          "Cannot verify citation context or relevance",
          "Some newer publications may not yet be indexed",
        ],
      },
    });
  } catch (error) {
    console.error("Error validating references:", error);
    return NextResponse.json(
      { error: "Failed to validate references" },
      { status: 500 }
    );
  }
}
