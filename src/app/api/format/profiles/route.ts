/**
 * GET /api/format/profiles -> { profiles: Array<{ id, name, version, family? }> }
 *
 * The journal-profile registry (src/lib/format/profiles), for the profile
 * picker in the format-check UI. Ids are what the check routes accept as
 * `profileId`.
 */

import { NextResponse } from "next/server";
import { profiles } from "../_lib/format-lib";
import { requireUser } from "../_lib/guards";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;
  return NextResponse.json({
    profiles: Object.values(profiles).map((p) => ({
      id: p.id,
      name: p.name,
      version: p.version,
      ...(p.family ? { family: p.family } : {}),
    })),
  });
}
