import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  parseReferencesForMetadata,
  validateReferencesByMetadata,
  type ReferenceMetadataInput,
} from "@/lib/references/reference-metadata-validator";
import { z } from "zod";

const referenceSchema = z.object({
  raw: z.string(),
  doi: z.string().optional(),
  pmid: z.string().optional(),
  title: z.string().optional(),
  authors: z.string().optional(),
  year: z.number().optional(),
  journal: z.string().optional(),
});

const requestSchema = z.union([
  z.object({
    text: z.string().min(50, "Reference text must be at least 50 characters"),
  }),
  z.object({
    references: z.array(referenceSchema).min(1).max(500),
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

    let references: ReferenceMetadataInput[];

    if ("text" in parseResult.data) {
      references = parseReferencesForMetadata(parseResult.data.text);

      if (references.length === 0) {
        return NextResponse.json(
          { error: "No references found in the provided text" },
          { status: 400 }
        );
      }
    } else {
      references = parseResult.data.references;
    }

    const result = await validateReferencesByMetadata(references);

    return NextResponse.json({
      ...result,
      metadata: {
        checkedAt: new Date().toISOString(),
        dataSources: ["OpenAlex API", "Crossref Works API", "PubMed E-utilities"],
        limitations: [
          "Validation uses title/author/year fuzzy matching, not DOI resolution alone",
          "Preprints, books, and grey literature may be classified as unsure",
          "Retraction checks apply when a DOI is present or found on the best match",
          "Cannot verify citation context or relevance to manuscript claims",
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
