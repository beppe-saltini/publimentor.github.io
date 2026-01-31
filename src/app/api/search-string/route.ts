import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  parseAuthorList,
  generatePubMedSearchString,
  generatePubMedUrl,
  generateScholarSearchString,
  generateScholarUrl,
  generateOpenAlexQueries,
} from "@/lib/author-parser";

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { authorList, reviewerName } = body;

    if (!authorList || typeof authorList !== "string") {
      return NextResponse.json(
        { error: "Author list is required" },
        { status: 400 }
      );
    }

    // Parse the author list
    const parsedAuthors = parseAuthorList(authorList);

    if (parsedAuthors.length === 0) {
      return NextResponse.json(
        { error: "No authors could be parsed from the input" },
        { status: 400 }
      );
    }

    // Generate search strings
    const result = {
      parsedAuthors: parsedAuthors.map((a) => ({
        fullName: a.fullName,
        surname: a.surname,
        firstName: a.firstName,
        pubmedFormat: a.pubmedFormat,
        scholarFormat: a.scholarFormat,
      })),
      pubmed: {
        searchString: generatePubMedSearchString(parsedAuthors, reviewerName),
        url: generatePubMedUrl(parsedAuthors, reviewerName),
      },
      googleScholar: {
        searchString: generateScholarSearchString(parsedAuthors, reviewerName),
        url: generateScholarUrl(parsedAuthors, reviewerName),
      },
      openAlex: {
        queries: generateOpenAlexQueries(parsedAuthors),
      },
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error generating search strings:", error);
    return NextResponse.json(
      { error: "Failed to generate search strings" },
      { status: 500 }
    );
  }
}
