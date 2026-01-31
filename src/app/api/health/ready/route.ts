/**
 * Readiness Probe
 * 
 * Indicates whether the application is ready to handle traffic.
 * Used by Kubernetes to know when to add/remove from load balancer.
 * 
 * Checks critical dependencies (database, etc.)
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface ReadinessResponse {
  status: "ready" | "not_ready";
  timestamp: string;
  checks: {
    database: boolean;
  };
}

export async function GET(): Promise<NextResponse<ReadinessResponse>> {
  const checks = {
    database: await checkDatabase(),
  };
  
  const allReady = Object.values(checks).every((ready) => ready);
  
  const response: ReadinessResponse = {
    status: allReady ? "ready" : "not_ready",
    timestamp: new Date().toISOString(),
    checks,
  };
  
  return NextResponse.json(response, {
    status: allReady ? 200 : 503,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

async function checkDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
