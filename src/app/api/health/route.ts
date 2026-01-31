/**
 * Health Check Endpoints
 * 
 * Provides health status for load balancers and monitoring.
 * 
 * - GET /api/health - Overall health status
 * - GET /api/health/live - Liveness probe (is the process running?)
 * - GET /api/health/ready - Readiness probe (can it handle traffic?)
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  version: string;
  uptime: number;
  checks: {
    database: ComponentHealth;
    memory: ComponentHealth;
  };
}

interface ComponentHealth {
  status: "healthy" | "unhealthy";
  latency?: number;
  message?: string;
}

const startTime = Date.now();

/**
 * Main health endpoint - checks all components
 */
export async function GET(): Promise<NextResponse<HealthStatus>> {
  const checks = await runHealthChecks();
  
  // Determine overall status
  const allHealthy = Object.values(checks).every((c) => c.status === "healthy");
  const anyUnhealthy = Object.values(checks).some((c) => c.status === "unhealthy");
  
  const status: HealthStatus = {
    status: allHealthy ? "healthy" : anyUnhealthy ? "unhealthy" : "degraded",
    timestamp: new Date().toISOString(),
    version: process.env.APP_VERSION || "1.0.0",
    uptime: Math.floor((Date.now() - startTime) / 1000),
    checks,
  };
  
  const httpStatus = status.status === "healthy" ? 200 : status.status === "degraded" ? 200 : 503;
  
  return NextResponse.json(status, { 
    status: httpStatus,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

async function runHealthChecks(): Promise<HealthStatus["checks"]> {
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
    return {
      status: "unhealthy",
      latency: Date.now() - start,
      message: error instanceof Error ? error.message : "Database connection failed",
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
