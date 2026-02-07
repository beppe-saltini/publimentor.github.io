/**
 * Prometheus Metrics Endpoint
 * 
 * Exposes metrics in Prometheus format for scraping.
 * Protected by a bearer token (METRICS_SECRET) in production,
 * or falls back to requiring authenticated session.
 * 
 * GET /api/metrics
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { metricsRegistry, metrics } from "@/lib/metrics";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Verify the caller is authorized to access internal metrics.
 * Accepts either a METRICS_SECRET bearer token (for Prometheus scrapers)
 * or a valid authenticated session (for admin dashboards).
 */
async function isAuthorized(request: Request): Promise<boolean> {
  // 1. Check bearer token (for Prometheus / infrastructure scrapers)
  const metricsSecret = process.env.METRICS_SECRET;
  if (metricsSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader === `Bearer ${metricsSecret}`) {
      return true;
    }
  }

  // 2. Fall back to session auth
  const session = await auth();
  return !!session?.user?.id;
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Update system metrics before export
  metrics.system.updateMemory();
  metrics.system.uptime();

  const body = metricsRegistry.export();

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
