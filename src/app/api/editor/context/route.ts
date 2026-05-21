import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getEditorContext } from "@/lib/editor-context";

export const dynamic = "force-dynamic";

/**
 * GET /api/editor/context
 * Returns editor workspace IDs only (no journal name).
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ctx = await getEditorContext(session.user.id);

    if (!ctx.hasJournal) {
      return NextResponse.json({
        hasJournal: false,
        journalId: null,
        publisherId: null,
      });
    }

    return NextResponse.json({
      hasJournal: true,
      journalId: ctx.journalId,
      publisherId: ctx.publisherId,
    });
  } catch (error) {
    console.error("[EditorContext] Error:", error);
    return NextResponse.json(
      { error: "Failed to get editor context" },
      { status: 500 }
    );
  }
}
