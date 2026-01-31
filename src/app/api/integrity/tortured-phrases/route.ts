import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { detectTorturedPhrases } from "@/lib/tortured-phrases";
import { z } from "zod";

const requestSchema = z.object({
  text: z.string().min(100, "Text must be at least 100 characters for meaningful analysis"),
});

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const result = requestSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error.issues[0].message },
        { status: 400 }
      );
    }

    const { text } = result.data;

    // Run detection
    const detectionResult = detectTorturedPhrases(text);

    return NextResponse.json({
      result: detectionResult,
      metadata: {
        textLength: text.length,
        wordCount: text.split(/\s+/).filter(Boolean).length,
        patternsChecked: 60, // Approximate number of patterns
        checkedAt: new Date().toISOString(),
        dataSources: ["Problematic Paper Screener corpus", "Cabanac et al. research"],
        limitations: [
          "Only checks for known tortured phrase patterns",
          "May not detect novel or emerging patterns",
          "Legitimate non-English translations may trigger false positives",
          "Specialized terminology in some fields may resemble tortured phrases"
        ]
      }
    });
  } catch (error) {
    console.error("Error detecting tortured phrases:", error);
    return NextResponse.json(
      { error: "Failed to analyze text for language anomalies" },
      { status: 500 }
    );
  }
}
