/**
 * Data Classification Framework
 * 
 * Defines classification levels for data fields to drive:
 * - Encryption requirements
 * - Access controls
 * - Retention policies
 * - Audit requirements
 * - Logging redaction
 */

// ============================================================
// Classification Levels
// ============================================================

export enum DataClassification {
  /**
   * PUBLIC - Can be freely disclosed
   * Examples: Product names, public pricing, marketing content
   * Controls: None required
   */
  PUBLIC = "PUBLIC",

  /**
   * INTERNAL - For internal use only
   * Examples: Internal policies, org charts, project plans
   * Controls: Authentication required
   */
  INTERNAL = "INTERNAL",

  /**
   * CONFIDENTIAL - Sensitive business data
   * Examples: Customer lists, financial reports, contracts
   * Controls: Role-based access, audit logging
   */
  CONFIDENTIAL = "CONFIDENTIAL",

  /**
   * RESTRICTED - Highly sensitive, regulated data
   * Examples: PII, PHI, payment data, credentials
   * Controls: Encryption, strict access, full audit, retention limits
   */
  RESTRICTED = "RESTRICTED",
}

// ============================================================
// Field Classifications
// ============================================================

export interface FieldClassification {
  classification: DataClassification;
  description: string;
  isPII: boolean;
  requiresEncryption: boolean;
  requiresAudit: boolean;
  retentionDays?: number;
  complianceFrameworks?: string[];
}

/**
 * Classification map for all data fields
 */
export const DATA_CLASSIFICATIONS: Record<string, FieldClassification> = {
  // ============================================================
  // User Model
  // ============================================================
  "user.id": {
    classification: DataClassification.INTERNAL,
    description: "Internal user identifier",
    isPII: false,
    requiresEncryption: false,
    requiresAudit: false,
  },
  "user.email": {
    classification: DataClassification.RESTRICTED,
    description: "User email address - PII",
    isPII: true,
    requiresEncryption: false, // Needed for auth, but logged redacted
    requiresAudit: true,
    complianceFrameworks: ["GDPR", "CCPA"],
  },
  "user.name": {
    classification: DataClassification.RESTRICTED,
    description: "User display name - PII",
    isPII: true,
    requiresEncryption: false,
    requiresAudit: false,
    complianceFrameworks: ["GDPR", "CCPA"],
  },
  "user.password": {
    classification: DataClassification.RESTRICTED,
    description: "Password hash - Credential",
    isPII: false,
    requiresEncryption: true, // Hashed with bcrypt
    requiresAudit: true,
    complianceFrameworks: ["SOC2"],
  },
  "user.orcid": {
    classification: DataClassification.RESTRICTED,
    description: "ORCID identifier - Research identity",
    isPII: true,
    requiresEncryption: false,
    requiresAudit: false,
    complianceFrameworks: ["GDPR"],
  },
  "user.institution": {
    classification: DataClassification.CONFIDENTIAL,
    description: "User institutional affiliation",
    isPII: false,
    requiresEncryption: false,
    requiresAudit: false,
  },

  // ============================================================
  // Manuscript Model
  // ============================================================
  "manuscript.id": {
    classification: DataClassification.INTERNAL,
    description: "Internal manuscript identifier",
    isPII: false,
    requiresEncryption: false,
    requiresAudit: false,
  },
  "manuscript.title": {
    classification: DataClassification.CONFIDENTIAL,
    description: "Manuscript title - Unpublished research",
    isPII: false,
    requiresEncryption: false,
    requiresAudit: true,
  },
  "manuscript.abstract": {
    classification: DataClassification.CONFIDENTIAL,
    description: "Manuscript abstract - Unpublished research",
    isPII: false,
    requiresEncryption: false,
    requiresAudit: false,
  },
  "manuscript.extractedText": {
    classification: DataClassification.CONFIDENTIAL,
    description: "Full manuscript text - Sensitive IP",
    isPII: false,
    requiresEncryption: false,
    requiresAudit: true,
  },
  "manuscript.filePath": {
    classification: DataClassification.INTERNAL,
    description: "Internal storage path",
    isPII: false,
    requiresEncryption: false,
    requiresAudit: false,
  },
  "manuscript.fileHash": {
    classification: DataClassification.INTERNAL,
    description: "File integrity hash",
    isPII: false,
    requiresEncryption: false,
    requiresAudit: false,
  },

  // ============================================================
  // Author Model
  // ============================================================
  "author.fullName": {
    classification: DataClassification.RESTRICTED,
    description: "Author full name - PII",
    isPII: true,
    requiresEncryption: false,
    requiresAudit: false,
    complianceFrameworks: ["GDPR", "CCPA"],
  },
  "author.email": {
    classification: DataClassification.RESTRICTED,
    description: "Author email - PII",
    isPII: true,
    requiresEncryption: false,
    requiresAudit: false,
    complianceFrameworks: ["GDPR", "CCPA"],
  },
  "author.orcid": {
    classification: DataClassification.RESTRICTED,
    description: "Author ORCID - Research identity PII",
    isPII: true,
    requiresEncryption: false,
    requiresAudit: false,
    complianceFrameworks: ["GDPR"],
  },

  // ============================================================
  // Publisher / Journal
  // ============================================================
  "publisher.name": {
    classification: DataClassification.PUBLIC,
    description: "Publisher name - Public",
    isPII: false,
    requiresEncryption: false,
    requiresAudit: false,
  },
  "journal.name": {
    classification: DataClassification.PUBLIC,
    description: "Journal name - Public",
    isPII: false,
    requiresEncryption: false,
    requiresAudit: false,
  },

  // ============================================================
  // Audit Logs
  // ============================================================
  "auditLog.ipAddress": {
    classification: DataClassification.RESTRICTED,
    description: "Client IP address - Can be PII",
    isPII: true,
    requiresEncryption: false,
    requiresAudit: false,
    retentionDays: 2555, // 7 years for compliance
    complianceFrameworks: ["SOX", "GDPR"],
  },
  "auditLog.userAgent": {
    classification: DataClassification.INTERNAL,
    description: "Browser/client identifier",
    isPII: false,
    requiresEncryption: false,
    requiresAudit: false,
  },

  // ============================================================
  // Session / Auth
  // ============================================================
  "session.token": {
    classification: DataClassification.RESTRICTED,
    description: "Session token - Credential",
    isPII: false,
    requiresEncryption: true,
    requiresAudit: true,
    complianceFrameworks: ["SOC2"],
  },
  "account.accessToken": {
    classification: DataClassification.RESTRICTED,
    description: "OAuth access token - Credential",
    isPII: false,
    requiresEncryption: true,
    requiresAudit: true,
    complianceFrameworks: ["SOC2"],
  },
  "account.refreshToken": {
    classification: DataClassification.RESTRICTED,
    description: "OAuth refresh token - Credential",
    isPII: false,
    requiresEncryption: true,
    requiresAudit: true,
    complianceFrameworks: ["SOC2"],
  },
};

// ============================================================
// Helper Functions
// ============================================================

/**
 * Get classification for a field path
 */
export function getFieldClassification(fieldPath: string): FieldClassification | undefined {
  return DATA_CLASSIFICATIONS[fieldPath];
}

/**
 * Check if a field is PII
 */
export function isPII(fieldPath: string): boolean {
  return DATA_CLASSIFICATIONS[fieldPath]?.isPII ?? false;
}

/**
 * Check if a field requires encryption
 */
export function requiresEncryption(fieldPath: string): boolean {
  return DATA_CLASSIFICATIONS[fieldPath]?.requiresEncryption ?? false;
}

/**
 * Check if a field requires audit logging
 */
export function requiresAudit(fieldPath: string): boolean {
  return DATA_CLASSIFICATIONS[fieldPath]?.requiresAudit ?? false;
}

/**
 * Get all PII fields
 */
export function getAllPIIFields(): string[] {
  return Object.entries(DATA_CLASSIFICATIONS)
    .filter(([, config]) => config.isPII)
    .map(([field]) => field);
}

/**
 * Get all restricted fields
 */
export function getAllRestrictedFields(): string[] {
  return Object.entries(DATA_CLASSIFICATIONS)
    .filter(([, config]) => config.classification === DataClassification.RESTRICTED)
    .map(([field]) => field);
}

/**
 * Get fields by compliance framework
 */
export function getFieldsByCompliance(framework: string): string[] {
  return Object.entries(DATA_CLASSIFICATIONS)
    .filter(([, config]) => config.complianceFrameworks?.includes(framework))
    .map(([field]) => field);
}
