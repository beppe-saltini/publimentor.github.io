import type { ManuscriptStatus } from "@prisma/client";

/** Statuses while the processing pipeline is running. */
export const IN_FLIGHT_STATUSES: ManuscriptStatus[] = ["EXTRACTING", "EXTRACTED", "PROCESSING", "EMBEDDING"];

/**
 * Longest a processing run can legitimately take. The process route's function
 * limit is 300 s; anything still in flight after this is a run the platform
 * killed (timeout, crash, redeploy) and is reported as an error so the user can
 * retry instead of waiting forever.
 */
export const PROCESSING_TIMEOUT_MS = 6 * 60 * 1000;

export function isProcessingStale(status: ManuscriptStatus, processingStarted: Date | null, now = Date.now()): boolean {
  if (!IN_FLIGHT_STATUSES.includes(status)) return false;
  if (!processingStarted) return true;
  return now - processingStarted.getTime() > PROCESSING_TIMEOUT_MS;
}
