/**
 * Prometheus Metrics Endpoint
 * 
 * Exposes metrics in Prometheus format for scraping.
 * 
 * GET /api/metrics
 */

import { NextResponse } from "next/server";
import { metricsRegistry, metrics } from "@/lib/metrics";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(): Promise<NextResponse> {
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
