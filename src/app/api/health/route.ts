/**
 * Health Check Endpoints
 * 
 * Provides health status for load balancers and monitoring.
 * 
 * - GET /api/health - Overall health status
 * - GET /api/health/live - Liveness probe (is the process running?)
 * - GET /api/health/ready - Readiness probe (can it handle traffic?)
 *
 * SECURITY: Detailed diagnostics (version, latency, memory) are only
 * returned to authenticated callers. Unauthenticated callers receive
 * only the top-level status code (200 / 503) for load-balancer probes.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface ComponentHealth {
  status: "healthy" | "unhealthy";
  latency?: number;
  message?: string;
}

interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  version?: string;
  uptime?: number;
  checks?: {
    database: ComponentHealth;
    memory: ComponentHealth;
  };
}

const startTime = Date.now();

/**
 * Main health endpoint - checks all components.
 * Returns minimal response to unauthenticated callers,
 * detailed diagnostics only to authenticated users.
 */
export async function GET(request: Request): Promise<NextResponse<HealthStatus>> {
  const checks = await runHealthChecks();
  
  // Determine overall status
  const allHealthy = Object.values(checks).every((c) => c.status === "healthy");
  const anyUnhealthy = Object.values(checks).some((c) => c.status === "unhealthy");
  const overallStatus = allHealthy ? "healthy" : anyUnhealthy ? "unhealthy" : "degraded";
  const httpStatus = overallStatus === "unhealthy" ? 503 : 200;

  // Check if caller is authenticated — detailed info is privileged
  const isAuthenticated = await isCallerAuthorized(request);

  if (!isAuthenticated) {
    // Minimal response for load-balancer probes — no internal details
    return NextResponse.json(
      { status: overallStatus, timestamp: new Date().toISOString() },
      {
        status: httpStatus,
        headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
      }
    );
  }

  const status: HealthStatus = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    version: process.env.APP_VERSION || "1.0.0",
    uptime: Math.floor((Date.now() - startTime) / 1000),
    checks,
  };
  
  return NextResponse.json(status, { 
    status: httpStatus,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

/** Allow access via METRICS_SECRET bearer token or authenticated session */
async function isCallerAuthorized(request: Request): Promise<boolean> {
  const metricsSecret = process.env.METRICS_SECRET;
  if (metricsSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader === `Bearer ${metricsSecret}`) return true;
  }
  const session = await auth();
  return !!session?.user?.id;
}

async function runHealthChecks(): Promise<{ database: ComponentHealth; memory: ComponentHealth }> {
  const [database, memory] = await Promise.all([
    checkDatabase(),
    checkMemory(),
  ]);
  
  return { database, memory };
}

async function checkDatabase(): Promise<ComponentHealth> {
  const start = Date.now();
  
  try {
    // Simple query to check database connectivity
    await prisma.$queryRaw`SELECT 1`;
    
    return {
      status: "healthy",
      latency: Date.now() - start,
    };
  } catch (error) {
    // SECURITY: Do not expose raw database error messages (may contain
    // connection strings or internal hostnames). Log internally only.
    console.error("[Health] Database check failed:", error);
    return {
      status: "unhealthy",
      latency: Date.now() - start,
      message: "Database connection failed",
    };
  }
}

function checkMemory(): ComponentHealth {
  const used = process.memoryUsage();
  const heapUsedMB = Math.round(used.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(used.heapTotal / 1024 / 1024);
  const percentUsed = (used.heapUsed / used.heapTotal) * 100;
  
  // Consider unhealthy if using more than 90% of heap
  const isHealthy = percentUsed < 90;
  
  return {
    status: isHealthy ? "healthy" : "unhealthy",
    message: `Heap: ${heapUsedMB}MB / ${heapTotalMB}MB (${percentUsed.toFixed(1)}%)`,
  };
}
