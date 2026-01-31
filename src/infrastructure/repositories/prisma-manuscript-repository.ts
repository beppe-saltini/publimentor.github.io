/**
 * Prisma Manuscript Repository
 * 
 * Implementation of IManuscriptRepository using Prisma ORM.
 * This lives in the Infrastructure layer.
 */

import { PrismaClient, ManuscriptStatus as PrismaStatus, Prisma } from "@prisma/client";
import {
  IManuscriptRepository,
  ManuscriptFilters,
  PaginationOptions,
  SortOptions,
  ManuscriptListResult,
} from "@/domain/repositories/manuscript-repository";
import { Manuscript, ManuscriptStatus, ManuscriptProps } from "@/domain/entities/manuscript";
import { ManuscriptId } from "@/domain/value-objects";

// ============================================================
// Type Mappings
// ============================================================

function toDomainStatus(prismaStatus: PrismaStatus): ManuscriptStatus {
  return ManuscriptStatus[prismaStatus as keyof typeof ManuscriptStatus];
}

function toPrismaStatus(domainStatus: ManuscriptStatus): PrismaStatus {
  return domainStatus as PrismaStatus;
}

// ============================================================
// Repository Implementation
// ============================================================

export class PrismaManuscriptRepository implements IManuscriptRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(id: ManuscriptId): Promise<Manuscript | null> {
    const record = await this.prisma.manuscript.findUnique({
      where: { id: id.value },
      include: { authors: true },
    });

    if (!record) return null;

    return this.toDomain(record);
  }

  async findByIdInPublisher(
    id: ManuscriptId,
    publisherId: string
  ): Promise<Manuscript | null> {
    const record = await this.prisma.manuscript.findFirst({
      where: {
        id: id.value,
        publisherId, // Tenant isolation
      },
      include: { authors: true },
    });

    if (!record) return null;

    return this.toDomain(record);
  }

  async findByFileHash(hash: string, publisherId: string): Promise<Manuscript | null> {
    const record = await this.prisma.manuscript.findFirst({
      where: {
        fileHash: hash,
        publisherId, // Tenant isolation
      },
      include: { authors: true },
    });

    if (!record) return null;

    return this.toDomain(record);
  }

  async list(
    filters: ManuscriptFilters,
    pagination: PaginationOptions,
    sort?: SortOptions
  ): Promise<ManuscriptListResult> {
    const where = this.buildWhereClause(filters);

    const [manuscripts, total] = await Promise.all([
      this.prisma.manuscript.findMany({
        where,
        include: { authors: true },
        skip: (pagination.page - 1) * pagination.pageSize,
        take: pagination.pageSize,
        orderBy: sort
          ? { [sort.field]: sort.direction }
          : { createdAt: "desc" },
      }),
      this.prisma.manuscript.count({ where }),
    ]);

    return {
      manuscripts: manuscripts.map((m) => this.toDomain(m)),
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
      totalPages: Math.ceil(total / pagination.pageSize),
    };
  }

  async count(filters: ManuscriptFilters): Promise<number> {
    const where = this.buildWhereClause(filters);
    return this.prisma.manuscript.count({ where });
  }

  async save(manuscript: Manuscript): Promise<void> {
    const id = manuscript.id.value;

    // Check if exists
    const exists = await this.prisma.manuscript.findUnique({
      where: { id },
      select: { id: true },
    });

    const updateData = {
      fileName: manuscript.fileName,
      fileType: manuscript.fileType,
      fileMimeType: manuscript.fileMimeType,
      fileSize: manuscript.fileSize,
      filePath: manuscript.filePath,
      fileHash: manuscript.fileHash,
      status: toPrismaStatus(manuscript.status),
      statusMessage: manuscript.statusMessage,
      title: manuscript.title,
      abstract: manuscript.abstract,
      keywords: [...manuscript.keywords],
      extractedText: manuscript.extractedText,
      wordCount: manuscript.wordCount,
      pageCount: manuscript.pageCount,
      version: manuscript.version,
    };

    if (exists) {
      await this.prisma.manuscript.update({
        where: { id },
        data: updateData,
      });
    } else {
      await this.prisma.manuscript.create({
        data: {
          id,
          ...updateData,
          publisher: { connect: { id: manuscript.publisherId } },
          uploader: { connect: { id: manuscript.uploaderId } },
          ...(manuscript.journalId ? { journal: { connect: { id: manuscript.journalId } } } : {}),
        },
      });
    }

    // Save authors
    const authors = manuscript.authors;
    if (authors.length > 0) {
      // Delete existing authors
      await this.prisma.manuscriptAuthor.deleteMany({
        where: { manuscriptId: id },
      });

      // Insert new authors
      await this.prisma.manuscriptAuthor.createMany({
        data: authors.map((author) => ({
          manuscriptId: id,
          publisherId: manuscript.publisherId,
          fullName: author.fullName,
          firstName: author.firstName,
          lastName: author.lastName,
          email: author.email?.value,
          orcid: author.orcid?.value,
          authorOrder: author.authorOrder,
          isCorresponding: author.isCorresponding,
          affiliationNums: author.affiliationNumbers,
        })),
      });
    }
  }

  async delete(id: ManuscriptId): Promise<void> {
    await this.prisma.manuscript.delete({
      where: { id: id.value },
    });
  }

  async softDelete(id: ManuscriptId): Promise<void> {
    // Since we don't have deletedAt in the current schema,
    // we'll mark it as ERROR with a deletion message
    // In a full implementation, add deletedAt to schema
    await this.prisma.manuscript.update({
      where: { id: id.value },
      data: {
        status: "ERROR",
        statusMessage: "Manuscript deleted",
      },
    });
  }

  async exists(id: ManuscriptId): Promise<boolean> {
    const count = await this.prisma.manuscript.count({
      where: { id: id.value },
    });
    return count > 0;
  }

  async findPendingProcessing(limit: number): Promise<Manuscript[]> {
    const records = await this.prisma.manuscript.findMany({
      where: {
        status: "UPLOADED",
      },
      include: { authors: true },
      take: limit,
      orderBy: { createdAt: "asc" },
    });

    return records.map((m) => this.toDomain(m));
  }

  async findWithErrors(publisherId: string): Promise<Manuscript[]> {
    const records = await this.prisma.manuscript.findMany({
      where: {
        publisherId,
        status: "ERROR",
      },
      include: { authors: true },
      orderBy: { updatedAt: "desc" },
    });

    return records.map((m) => this.toDomain(m));
  }

  async batchUpdateStatus(
    ids: ManuscriptId[],
    status: ManuscriptStatus,
    message?: string
  ): Promise<void> {
    await this.prisma.manuscript.updateMany({
      where: {
        id: { in: ids.map((id) => id.value) },
      },
      data: {
        status: toPrismaStatus(status),
        statusMessage: message,
      },
    });
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  private buildWhereClause(filters: ManuscriptFilters): Prisma.ManuscriptWhereInput {
    const where: Prisma.ManuscriptWhereInput = {};

    if (filters.publisherId) {
      where.publisherId = filters.publisherId;
    }

    if (filters.journalId) {
      where.journalId = filters.journalId;
    }

    if (filters.uploaderId) {
      where.uploaderId = filters.uploaderId;
    }

    if (filters.status) {
      if (Array.isArray(filters.status)) {
        where.status = { in: filters.status.map(toPrismaStatus) };
      } else {
        where.status = toPrismaStatus(filters.status);
      }
    }

    if (filters.fileHash) {
      where.fileHash = filters.fileHash;
    }

    if (filters.searchTerm) {
      where.OR = [
        { title: { contains: filters.searchTerm, mode: "insensitive" } },
        { fileName: { contains: filters.searchTerm, mode: "insensitive" } },
        { abstract: { contains: filters.searchTerm, mode: "insensitive" } },
      ];
    }

    if (filters.createdAfter) {
      where.createdAt = { ...where.createdAt as object, gte: filters.createdAfter };
    }

    if (filters.createdBefore) {
      where.createdAt = { ...where.createdAt as object, lte: filters.createdBefore };
    }

    return where;
  }

  private toDomain(record: ManuscriptRecord): Manuscript {
    const props: ManuscriptProps = {
      id: ManuscriptId.create(record.id),
      publisherId: record.publisherId,
      journalId: record.journalId || undefined,
      uploaderId: record.uploaderId,
      fileName: record.fileName,
      fileType: record.fileType,
      fileMimeType: record.fileMimeType,
      fileSize: record.fileSize,
      filePath: record.filePath,
      fileHash: record.fileHash || undefined,
      status: toDomainStatus(record.status),
      statusMessage: record.statusMessage || undefined,
      title: record.title || undefined,
      abstract: record.abstract || undefined,
      keywords: record.keywords || [],
      extractedText: record.extractedText || undefined,
      wordCount: record.wordCount || undefined,
      pageCount: record.pageCount || undefined,
      version: record.version,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };

    const manuscript = Manuscript.reconstitute(props);

    // Authors would be set via a method if needed
    // This is a simplified version

    return manuscript;
  }

  // toPrisma method removed - using inline conversion in save()
}

// Type for Prisma manuscript record with authors
type ManuscriptRecord = Prisma.ManuscriptGetPayload<{
  include: { authors: true };
}>;
