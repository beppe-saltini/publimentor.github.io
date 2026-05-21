import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { z } from "zod";

export const dynamic = "force-dynamic";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

const requestSchema = z.object({
  text: z.string().min(20, "Text must be at least 20 characters").max(10000),
});

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "AI service not configured" }, { status: 503 });
    }

    const body = await request.json();
    const parseResult = requestSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error.issues[0].message },
        { status: 400 }
      );
    }

    const { text } = parseResult.data;

    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages: [
          {
            role: "user",
            content: `Extract 5-10 specific research keywords from the following text. Focus on scientific terms, methodologies, diseases, genes, proteins, or topics that would be useful for finding peer reviewers.

Return ONLY a JSON array of strings, nothing else. Example: ["keyword1", "keyword2", "keyword3"]

Text:
${text}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("[SuggestKeywords] API error:", err);
      return NextResponse.json({ error: "AI service error" }, { status: 502 });
    }

    const data = await response.json();
    const content = data.content?.[0]?.text || "[]";

    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return NextResponse.json({ keywords: [] });
    }

    const keywords: string[] = JSON.parse(jsonMatch[0])
      .filter((k: unknown) => typeof k === "string" && k.trim().length > 0)
      .map((k: string) => k.trim())
      .slice(0, 15);

    return NextResponse.json({ keywords });
  } catch (error) {
    console.error("[SuggestKeywords] Error:", error);
    return NextResponse.json({ error: "Failed to suggest keywords" }, { status: 500 });
  }
}
