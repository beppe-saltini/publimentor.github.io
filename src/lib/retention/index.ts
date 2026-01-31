/**
 * Data Retention Policy Management
 * 
 * Implements automated data lifecycle management for compliance.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

// ============================================================
// Types
// ============================================================

export interface RetentionPolicy {
  entityType: string;
  retentionDays: number;
  archiveAfterDays?: number;
  deletionStrategy: "soft" | "hard" | "anonymize";
  legalHoldExempt: boolean;
  complianceFrameworks: string[];
}

export interface RetentionResult {
  entityType: string;
  recordsProcessed: number;
  recordsDeleted: number;
  recordsAnonymized: number;
  recordsArchived: number;
  errors: string[];
}

// ============================================================
// Default Retention Policies
// ============================================================

export const DEFAULT_RETENTION_POLICIES: RetentionPolicy[] = [
  {
    entityType: "audit_logs",
    retentionDays: 2555, // 7 years (SOX compliance)
    archiveAfterDays: 365, // Archive after 1 year
    deletionStrategy: "hard",
    legalHoldExempt: false,
    complianceFrameworks: ["SOX", "GDPR"],
  },
  {
    entityType: "sessions",
    retentionDays: 30, // 30 days
    deletionStrategy: "hard",
    legalHoldExempt: true,
    complianceFrameworks: [],
  },
  {
    entityType: "processing_jobs",
    retentionDays: 90, // 90 days
    deletionStrategy: "hard",
    legalHoldExempt: true,
    complianceFrameworks: [],
  },
  {
    entityType: "deleted_manuscripts",
    retentionDays: 365, // 1 year after soft delete
    deletionStrategy: "hard",
    legalHoldExempt: false,
    complianceFrameworks: ["GDPR"],
  },
  {
    entityType: "inactive_users",
    retentionDays: 1095, // 3 years of inactivity
    deletionStrategy: "anonymize",
    legalHoldExempt: false,
    complianceFrameworks: ["GDPR", "CCPA"],
  },
];

// ============================================================
// Retention Executor
// ============================================================

export class RetentionExecutor {
  private policies: RetentionPolicy[];

  constructor(policies: RetentionPolicy[] = DEFAULT_RETENTION_POLICIES) {
    this.policies = policies;
  }

  /**
   * Execute all retention policies
   */
  async executeAll(): Promise<RetentionResult[]> {
    const results: RetentionResult[] = [];

    for (const policy of this.policies) {
      try {
        const result = await this.executePolicy(policy);
        results.push(result);

        logger.info("Retention policy executed", {
          entityType: policy.entityType,
          recordsProcessed: result.recordsProcessed,
          recordsDeleted: result.recordsDeleted,
          recordsAnonymized: result.recordsAnonymized,
        });
      } catch (error) {
        logger.error("Retention policy failed", error, {
          entityType: policy.entityType,
        });

        results.push({
          entityType: policy.entityType,
          recordsProcessed: 0,
          recordsDeleted: 0,
          recordsAnonymized: 0,
          recordsArchived: 0,
          errors: [error instanceof Error ? error.message : "Unknown error"],
        });
      }
    }

    return results;
  }

  /**
   * Execute a single retention policy
   */
  async executePolicy(policy: RetentionPolicy): Promise<RetentionResult> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - policy.retentionDays);

    const result: RetentionResult = {
      entityType: policy.entityType,
      recordsProcessed: 0,
      recordsDeleted: 0,
      recordsAnonymized: 0,
      recordsArchived: 0,
      errors: [],
    };

    switch (policy.entityType) {
      case "audit_logs":
        return this.processAuditLogs(policy, cutoffDate, result);

      case "sessions":
        return this.processSessions(policy, cutoffDate, result);

      case "processing_jobs":
        return this.processProcessingJobs(policy, cutoffDate, result);

      case "deleted_manuscripts":
        // Not implemented - would require soft delete tracking
        return result;

      case "inactive_users":
        return this.processInactiveUsers(policy, cutoffDate, result);

      default:
        result.errors.push(`Unknown entity type: ${policy.entityType}`);
        return result;
    }
  }

  private async processAuditLogs(
    policy: RetentionPolicy,
    cutoffDate: Date,
    result: RetentionResult
  ): Promise<RetentionResult> {
    // Archive before delete if configured
    if (policy.archiveAfterDays) {
      const archiveCutoff = new Date();
      archiveCutoff.setDate(archiveCutoff.getDate() - policy.archiveAfterDays);

      // In a real implementation, this would move to cold storage
      logger.info("Would archive audit logs", {
        beforeDate: archiveCutoff.toISOString(),
      });
    }

    // Hard delete old audit logs
    const deleteResult = await prisma.auditLog.deleteMany({
      where: {
        createdAt: { lt: cutoffDate },
      },
    });

    result.recordsProcessed = deleteResult.count;
    result.recordsDeleted = deleteResult.count;

    return result;
  }

  private async processSessions(
    _policy: RetentionPolicy,
    cutoffDate: Date,
    result: RetentionResult
  ): Promise<RetentionResult> {
    const deleteResult = await prisma.session.deleteMany({
      where: {
        expires: { lt: cutoffDate },
      },
    });

    result.recordsProcessed = deleteResult.count;
    result.recordsDeleted = deleteResult.count;

    return result;
  }

  private async processProcessingJobs(
    _policy: RetentionPolicy,
    cutoffDate: Date,
    result: RetentionResult
  ): Promise<RetentionResult> {
    // Only delete completed or failed jobs
    const deleteResult = await prisma.processingJob.deleteMany({
      where: {
        createdAt: { lt: cutoffDate },
        status: { in: ["COMPLETED", "FAILED", "CANCELLED"] },
      },
    });

    result.recordsProcessed = deleteResult.count;
    result.recordsDeleted = deleteResult.count;

    return result;
  }

  private async processInactiveUsers(
    _policy: RetentionPolicy,
    cutoffDate: Date,
    result: RetentionResult
  ): Promise<RetentionResult> {
    // Find users with no activity
    const inactiveUsers = await prisma.user.findMany({
      where: {
        updatedAt: { lt: cutoffDate },
        // No recent sessions
        sessions: {
          none: {
            expires: { gt: new Date() },
          },
        },
      },
      select: { id: true, email: true },
    });

    result.recordsProcessed = inactiveUsers.length;

    // Anonymize instead of delete
    for (const user of inactiveUsers) {
      try {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            email: `anonymized_${user.id}@deleted.local`,
            name: "Deleted User",
            password: null,
            orcid: null,
            institution: null,
            image: null,
          },
        });
        result.recordsAnonymized++;
      } catch (error) {
        result.errors.push(`Failed to anonymize user ${user.id}: ${error}`);
      }
    }

    return result;
  }
}

// ============================================================
// Cron Job Helper
// ============================================================

/**
 * Run retention policies (call from cron job or scheduled task)
 */
export async function runRetentionPolicies(): Promise<void> {
  logger.info("Starting retention policy execution");

  const executor = new RetentionExecutor();
  const results = await executor.executeAll();

  const summary = {
    totalProcessed: results.reduce((sum, r) => sum + r.recordsProcessed, 0),
    totalDeleted: results.reduce((sum, r) => sum + r.recordsDeleted, 0),
    totalAnonymized: results.reduce((sum, r) => sum + r.recordsAnonymized, 0),
    totalErrors: results.reduce((sum, r) => sum + r.errors.length, 0),
  };

  logger.info("Retention policy execution completed", summary);
}

// ============================================================
// Singleton Export
// ============================================================

export const retentionExecutor = new RetentionExecutor();
