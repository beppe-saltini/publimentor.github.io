/**
 * Audit Logging Service
 * 
 * Provides immutable audit trail for compliance and debugging.
 * All security-relevant and data-changing operations should be logged.
 */

import { prisma } from "@/lib/prisma";
import { AuditAction, AuditCategory, Prisma } from "@prisma/client";

// ============================================================
// Types
// ============================================================

export interface AuditContext {
  requestId?: string;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
  publisherId?: string;
}

export interface AuditLogInput {
  action: AuditAction;
  category: AuditCategory;
  actorType: "user" | "system" | "api" | "anonymous";
  actorId?: string;
  actorEmail?: string;
  entityType: string;
  entityId: string;
  description?: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  context?: AuditContext;
}

// ============================================================
// Action to Category Mapping
// ============================================================

const ACTION_CATEGORIES: Record<AuditAction, AuditCategory> = {
  // Authentication
  AUTH_LOGIN: "AUTHENTICATION",
  AUTH_LOGOUT: "AUTHENTICATION",
  AUTH_FAILED: "AUTHENTICATION",
  AUTH_PASSWORD_CHANGE: "AUTHENTICATION",
  AUTH_PASSWORD_RESET: "AUTHENTICATION",
  
  // User management
  USER_CREATED: "USER_MANAGEMENT",
  USER_UPDATED: "USER_MANAGEMENT",
  USER_DELETED: "USER_MANAGEMENT",
  USER_ROLE_CHANGED: "USER_MANAGEMENT",
  
  // Manuscript
  MANUSCRIPT_UPLOADED: "MANUSCRIPT",
  MANUSCRIPT_VIEWED: "MANUSCRIPT",
  MANUSCRIPT_DOWNLOADED: "MANUSCRIPT",
  MANUSCRIPT_UPDATED: "MANUSCRIPT",
  MANUSCRIPT_DELETED: "MANUSCRIPT",
  MANUSCRIPT_SHARED: "MANUSCRIPT",
  MANUSCRIPT_PERMISSION_GRANTED: "MANUSCRIPT",
  MANUSCRIPT_PERMISSION_REVOKED: "MANUSCRIPT",
  
  // Review
  REVIEWER_DISCOVERED: "REVIEW",
  REVIEWER_ASSIGNED: "REVIEW",
  REVIEW_SUBMITTED: "REVIEW",
  REVIEW_DECISION_MADE: "REVIEW",
  
  // Compliance
  COI_CHECK_PERFORMED: "COMPLIANCE",
  INTEGRITY_CHECK_PERFORMED: "COMPLIANCE",
  
  // Publisher
  PUBLISHER_CREATED: "PUBLISHER",
  PUBLISHER_UPDATED: "PUBLISHER",
  JOURNAL_CREATED: "PUBLISHER",
  JOURNAL_UPDATED: "PUBLISHER",
  MEMBER_ADDED: "PUBLISHER",
  MEMBER_REMOVED: "PUBLISHER",
  
  // Security
  SECURITY_RATE_LIMIT_EXCEEDED: "SECURITY",
  SECURITY_UNAUTHORIZED_ACCESS: "SECURITY",
  SECURITY_SUSPICIOUS_ACTIVITY: "SECURITY",
  SECURITY_FILE_VALIDATION_FAILED: "SECURITY",
};

// ============================================================
// Audit Logger Class
// ============================================================

class AuditLogger {
  private context: AuditContext = {};

  /**
   * Set context for subsequent log calls
   */
  setContext(context: AuditContext): void {
    this.context = { ...this.context, ...context };
  }

  /**
   * Clear context
   */
  clearContext(): void {
    this.context = {};
  }

  /**
   * Log an audit event
   */
  async log(input: AuditLogInput): Promise<void> {
    try {
      const category = input.category || ACTION_CATEGORIES[input.action];
      const context = { ...this.context, ...input.context };

      await prisma.auditLog.create({
        data: {
          action: input.action,
          category,
          actorType: input.actorType,
          actorId: input.actorId,
          actorEmail: input.actorEmail,
          entityType: input.entityType,
          entityId: input.entityId,
          description: input.description,
          oldValues: input.oldValues as Prisma.InputJsonValue,
          newValues: input.newValues as Prisma.InputJsonValue,
          metadata: (input.metadata || {}) as Prisma.InputJsonValue,
          requestId: context.requestId,
          sessionId: context.sessionId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          publisherId: context.publisherId,
        },
      });
    } catch (error) {
      // Audit logging should never break the application
      // Log to console as fallback
      console.error("[AUDIT_LOG_FAILED]", {
        input,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  // ============================================================
  // Convenience Methods
  // ============================================================

  async logAuth(
    action: "AUTH_LOGIN" | "AUTH_LOGOUT" | "AUTH_FAILED" | "AUTH_PASSWORD_CHANGE" | "AUTH_PASSWORD_RESET",
    userId: string | undefined,
    email: string | undefined,
    success: boolean,
    context?: AuditContext
  ): Promise<void> {
    await this.log({
      action,
      category: "AUTHENTICATION",
      actorType: userId ? "user" : "anonymous",
      actorId: userId,
      actorEmail: email,
      entityType: "user",
      entityId: userId || "unknown",
      description: `${action} ${success ? "succeeded" : "failed"} for ${email}`,
      metadata: { success },
      context,
    });
  }

  async logManuscriptAccess(
    action: "MANUSCRIPT_VIEWED" | "MANUSCRIPT_DOWNLOADED",
    userId: string,
    manuscriptId: string,
    context?: AuditContext
  ): Promise<void> {
    await this.log({
      action,
      category: "MANUSCRIPT",
      actorType: "user",
      actorId: userId,
      entityType: "manuscript",
      entityId: manuscriptId,
      context,
    });
  }

  async logDataChange(
    action: AuditAction,
    userId: string,
    entityType: string,
    entityId: string,
    oldValues: Record<string, unknown> | null,
    newValues: Record<string, unknown> | null,
    context?: AuditContext
  ): Promise<void> {
    await this.log({
      action,
      category: ACTION_CATEGORIES[action],
      actorType: "user",
      actorId: userId,
      entityType,
      entityId,
      oldValues: oldValues || undefined,
      newValues: newValues || undefined,
      context,
    });
  }

  async logSecurityEvent(
    action: "SECURITY_RATE_LIMIT_EXCEEDED" | "SECURITY_UNAUTHORIZED_ACCESS" | "SECURITY_SUSPICIOUS_ACTIVITY" | "SECURITY_FILE_VALIDATION_FAILED",
    description: string,
    metadata: Record<string, unknown>,
    context?: AuditContext
  ): Promise<void> {
    await this.log({
      action,
      category: "SECURITY",
      actorType: "anonymous",
      entityType: "security",
      entityId: "system",
      description,
      metadata,
      context,
    });
  }
}

// ============================================================
// Singleton Export
// ============================================================

export const auditLogger = new AuditLogger();

// Re-export types
export { AuditAction, AuditCategory };
