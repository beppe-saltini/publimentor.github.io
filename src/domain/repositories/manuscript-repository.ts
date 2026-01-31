/**
 * Manuscript Repository Interface
 * 
 * Defines the contract for manuscript persistence.
 * This interface lives in the Domain layer and has NO dependencies
 * on infrastructure (Prisma, databases, etc.)
 */

import { Manuscript, ManuscriptStatus } from "../entities/manuscript";
import { ManuscriptId } from "../value-objects";

// ============================================================
// Query Types
// ============================================================

export interface ManuscriptFilters {
  publisherId?: string;
  journalId?: string;
  uploaderId?: string;
  status?: ManuscriptStatus | ManuscriptStatus[];
  fileHash?: string;
  searchTerm?: string;
  createdAfter?: Date;
  createdBefore?: Date;
}

export interface PaginationOptions {
  page: number;
  pageSize: number;
}

export interface SortOptions {
  field: "createdAt" | "updatedAt" | "title" | "fileName";
  direction: "asc" | "desc";
}

export interface ManuscriptListResult {
  manuscripts: Manuscript[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ============================================================
// Repository Interface
// ============================================================

export interface IManuscriptRepository {
  /**
   * Find a manuscript by ID
   */
  findById(id: ManuscriptId): Promise<Manuscript | null>;

  /**
   * Find a manuscript by ID within a specific publisher (tenant isolation)
   */
  findByIdInPublisher(id: ManuscriptId, publisherId: string): Promise<Manuscript | null>;

  /**
   * Find manuscripts by file hash (for deduplication)
   */
  findByFileHash(hash: string, publisherId: string): Promise<Manuscript | null>;

  /**
   * List manuscripts with filters and pagination
   */
  list(
    filters: ManuscriptFilters,
    pagination: PaginationOptions,
    sort?: SortOptions
  ): Promise<ManuscriptListResult>;

  /**
   * Count manuscripts matching filters
   */
  count(filters: ManuscriptFilters): Promise<number>;

  /**
   * Save a manuscript (insert or update)
   */
  save(manuscript: Manuscript): Promise<void>;

  /**
   * Delete a manuscript
   */
  delete(id: ManuscriptId): Promise<void>;

  /**
   * Soft delete a manuscript (mark as deleted but retain data)
   */
  softDelete(id: ManuscriptId): Promise<void>;

  /**
   * Check if a manuscript exists
   */
  exists(id: ManuscriptId): Promise<boolean>;

  /**
   * Find manuscripts pending processing
   */
  findPendingProcessing(limit: number): Promise<Manuscript[]>;

  /**
   * Find manuscripts with errors for retry
   */
  findWithErrors(publisherId: string): Promise<Manuscript[]>;

  /**
   * Batch update status for multiple manuscripts
   */
  batchUpdateStatus(
    ids: ManuscriptId[],
    status: ManuscriptStatus,
    message?: string
  ): Promise<void>;
}

// ============================================================
// Unit of Work Interface
// ============================================================

export interface IUnitOfWork {
  /**
   * Execute operations within a transaction
   */
  execute<T>(work: () => Promise<T>): Promise<T>;

  /**
   * Get the manuscript repository for this unit of work
   */
  manuscripts: IManuscriptRepository;
}
