/**
 * Liveness Probe
 * 
 * Indicates whether the application is running.
 * Used by Kubernetes to know when to restart a container.
 * 
 * Should be fast and simple - just checks if the process is alive.
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface LivenessResponse {
  status: "ok";
  timestamp: string;
}

export async function GET(): Promise<NextResponse<LivenessResponse>> {
  return NextResponse.json(
    {
      status: "ok",
      timestamp: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}
