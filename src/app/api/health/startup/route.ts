/**
 * Startup Probe
 * 
 * Indicates whether the application has completed initialization.
 * Used by Kubernetes to know when to start liveness/readiness probes.
 * 
 * More lenient than readiness - allows time for database migrations, etc.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface StartupResponse {
  status: "started" | "starting";
  timestamp: string;
  initialized: boolean;
}

let initialized = false;
let initializationAttempted = false;

export async function GET(): Promise<NextResponse<StartupResponse>> {
  // Only try initialization once
  if (!initializationAttempted) {
    initializationAttempted = true;
    initialized = await checkInitialization();
  }
  
  const response: StartupResponse = {
    status: initialized ? "started" : "starting",
    timestamp: new Date().toISOString(),
    initialized,
  };
  
  return NextResponse.json(response, {
    status: initialized ? 200 : 503,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

async function checkInitialization(): Promise<boolean> {
  try {
    // Check database connectivity
    await prisma.$queryRaw`SELECT 1`;
    
    // Could add more initialization checks here:
    // - Check if migrations are applied
    // - Check if required environment variables are set
    // - Check if external services are reachable
    
    return true;
  } catch {
    return false;
  }
}
