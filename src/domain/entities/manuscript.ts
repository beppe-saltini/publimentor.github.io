/**
 * Manuscript Entity (Aggregate Root)
 * 
 * Represents a scientific manuscript with its metadata and processing state.
 * This is an Aggregate Root - all access to related entities goes through here.
 */

import { ManuscriptId, Email, ORCID, DomainError } from "../value-objects";

// ============================================================
// Types
// ============================================================

export enum ManuscriptStatus {
  UPLOADED = "UPLOADED",
  EXTRACTING = "EXTRACTING",
  EXTRACTED = "EXTRACTED",
  PROCESSING = "PROCESSING",
  EMBEDDING = "EMBEDDING",
  READY = "READY",
  ERROR = "ERROR",
}

export interface ManuscriptProps {
  id: ManuscriptId;
  publisherId: string;
  journalId?: string;
  uploaderId: string;
  fileName: string;
  fileType: string;
  fileMimeType: string;
  fileSize: number;
  filePath: string;
  fileHash?: string;
  status: ManuscriptStatus;
  statusMessage?: string;
  title?: string;
  abstract?: string;
  keywords: string[];
  extractedText?: string;
  wordCount?: number;
  pageCount?: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateManuscriptProps {
  publisherId: string;
  uploaderId: string;
  fileName: string;
  fileType: string;
  fileMimeType: string;
  fileSize: number;
  filePath: string;
  fileHash?: string;
  journalId?: string;
}

export interface ManuscriptAuthorProps {
  fullName: string;
  firstName?: string;
  lastName?: string;
  email?: Email;
  orcid?: ORCID;
  authorOrder: number;
  isCorresponding: boolean;
  affiliationNumbers: number[];
}

// ============================================================
// Manuscript Entity
// ============================================================

export class Manuscript {
  private readonly props: ManuscriptProps;
  private _authors: ManuscriptAuthorProps[] = [];
  private _domainEvents: DomainEvent[] = [];

  private constructor(props: ManuscriptProps) {
    this.props = props;
  }

  // ============================================================
  // Factory Methods
  // ============================================================

  static create(props: CreateManuscriptProps): Manuscript {
    // Validate required fields
    if (!props.publisherId) {
      throw new DomainError("MISSING_PUBLISHER", "Publisher ID is required");
    }
    if (!props.uploaderId) {
      throw new DomainError("MISSING_UPLOADER", "Uploader ID is required");
    }
    if (!props.fileName) {
      throw new DomainError("MISSING_FILENAME", "File name is required");
    }
    if (props.fileSize <= 0) {
      throw new DomainError("INVALID_FILE_SIZE", "File size must be positive");
    }

    // Validate file type
    const allowedTypes = ["pdf", "docx", "tex"];
    if (!allowedTypes.includes(props.fileType.toLowerCase())) {
      throw new DomainError(
        "INVALID_FILE_TYPE",
        `File type must be one of: ${allowedTypes.join(", ")}`
      );
    }

    const now = new Date();
    const manuscript = new Manuscript({
      id: ManuscriptId.generate(),
      publisherId: props.publisherId,
      journalId: props.journalId,
      uploaderId: props.uploaderId,
      fileName: props.fileName,
      fileType: props.fileType.toLowerCase(),
      fileMimeType: props.fileMimeType,
      fileSize: props.fileSize,
      filePath: props.filePath,
      fileHash: props.fileHash,
      status: ManuscriptStatus.UPLOADED,
      keywords: [],
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    manuscript.addDomainEvent({
      type: "ManuscriptUploaded",
      aggregateId: manuscript.id.value,
      data: {
        publisherId: props.publisherId,
        uploaderId: props.uploaderId,
        fileName: props.fileName,
        fileSize: props.fileSize,
      },
      timestamp: now,
    });

    return manuscript;
  }

  static reconstitute(props: ManuscriptProps): Manuscript {
    return new Manuscript(props);
  }

  // ============================================================
  // Domain Operations
  // ============================================================

  startTextExtraction(): void {
    this.ensureNotProcessed();
    
    if (this.props.status !== ManuscriptStatus.UPLOADED) {
      throw new DomainError(
        "INVALID_STATUS",
        `Cannot start extraction from status: ${this.props.status}`
      );
    }

    this.props.status = ManuscriptStatus.EXTRACTING;
    this.props.updatedAt = new Date();
  }

  completeTextExtraction(extractedText: string, wordCount: number, pageCount?: number): void {
    if (this.props.status !== ManuscriptStatus.EXTRACTING) {
      throw new DomainError(
        "INVALID_STATUS",
        `Cannot complete extraction from status: ${this.props.status}`
      );
    }

    this.props.extractedText = extractedText;
    this.props.wordCount = wordCount;
    this.props.pageCount = pageCount;
    this.props.status = ManuscriptStatus.EXTRACTED;
    this.props.updatedAt = new Date();

    this.addDomainEvent({
      type: "TextExtractionCompleted",
      aggregateId: this.id.value,
      data: { wordCount, pageCount },
      timestamp: new Date(),
    });
  }

  startMetadataProcessing(): void {
    if (this.props.status !== ManuscriptStatus.EXTRACTED) {
      throw new DomainError(
        "INVALID_STATUS",
        `Cannot start metadata processing from status: ${this.props.status}`
      );
    }

    this.props.status = ManuscriptStatus.PROCESSING;
    this.props.updatedAt = new Date();
  }

  completeMetadataProcessing(metadata: {
    title?: string;
    abstract?: string;
    keywords?: string[];
    authors?: ManuscriptAuthorProps[];
  }): void {
    if (this.props.status !== ManuscriptStatus.PROCESSING) {
      throw new DomainError(
        "INVALID_STATUS",
        `Cannot complete metadata processing from status: ${this.props.status}`
      );
    }

    if (metadata.title) this.props.title = metadata.title;
    if (metadata.abstract) this.props.abstract = metadata.abstract;
    if (metadata.keywords) this.props.keywords = metadata.keywords;
    if (metadata.authors) this._authors = metadata.authors;

    this.props.status = ManuscriptStatus.EMBEDDING;
    this.props.updatedAt = new Date();

    this.addDomainEvent({
      type: "MetadataExtractionCompleted",
      aggregateId: this.id.value,
      data: { title: metadata.title, authorCount: metadata.authors?.length },
      timestamp: new Date(),
    });
  }

  completeEmbedding(): void {
    if (this.props.status !== ManuscriptStatus.EMBEDDING) {
      throw new DomainError(
        "INVALID_STATUS",
        `Cannot complete embedding from status: ${this.props.status}`
      );
    }

    this.props.status = ManuscriptStatus.READY;
    this.props.updatedAt = new Date();

    this.addDomainEvent({
      type: "ManuscriptReady",
      aggregateId: this.id.value,
      data: {},
      timestamp: new Date(),
    });
  }

  markError(message: string): void {
    this.props.status = ManuscriptStatus.ERROR;
    this.props.statusMessage = message;
    this.props.updatedAt = new Date();

    this.addDomainEvent({
      type: "ProcessingFailed",
      aggregateId: this.id.value,
      data: { error: message },
      timestamp: new Date(),
    });
  }

  assignToJournal(journalId: string): void {
    if (this.props.journalId === journalId) {
      return; // Already assigned
    }

    const oldJournalId = this.props.journalId;
    this.props.journalId = journalId;
    this.props.updatedAt = new Date();

    this.addDomainEvent({
      type: "ManuscriptAssignedToJournal",
      aggregateId: this.id.value,
      data: { journalId, previousJournalId: oldJournalId },
      timestamp: new Date(),
    });
  }

  updateMetadata(updates: { title?: string; abstract?: string; keywords?: string[] }): void {
    if (updates.title !== undefined) {
      if (!updates.title.trim()) {
        throw new DomainError("INVALID_TITLE", "Title cannot be empty");
      }
      this.props.title = updates.title.trim();
    }

    if (updates.abstract !== undefined) {
      this.props.abstract = updates.abstract.trim();
    }

    if (updates.keywords !== undefined) {
      this.props.keywords = updates.keywords.map((k) => k.trim()).filter(Boolean);
    }

    this.props.updatedAt = new Date();
  }

  // ============================================================
  // Validation Helpers
  // ============================================================

  private ensureNotProcessed(): void {
    if (this.props.status === ManuscriptStatus.READY) {
      throw new DomainError(
        "ALREADY_PROCESSED",
        "Cannot modify a fully processed manuscript"
      );
    }
  }

  canStartProcessing(): boolean {
    return this.props.status === ManuscriptStatus.UPLOADED;
  }

  isReady(): boolean {
    return this.props.status === ManuscriptStatus.READY;
  }

  hasError(): boolean {
    return this.props.status === ManuscriptStatus.ERROR;
  }

  // ============================================================
  // Domain Events
  // ============================================================

  private addDomainEvent(event: DomainEvent): void {
    this._domainEvents.push(event);
  }

  pullDomainEvents(): DomainEvent[] {
    const events = [...this._domainEvents];
    this._domainEvents = [];
    return events;
  }

  // ============================================================
  // Getters
  // ============================================================

  get id(): ManuscriptId {
    return this.props.id;
  }

  get publisherId(): string {
    return this.props.publisherId;
  }

  get journalId(): string | undefined {
    return this.props.journalId;
  }

  get uploaderId(): string {
    return this.props.uploaderId;
  }

  get fileName(): string {
    return this.props.fileName;
  }

  get fileType(): string {
    return this.props.fileType;
  }

  get fileMimeType(): string {
    return this.props.fileMimeType;
  }

  get fileSize(): number {
    return this.props.fileSize;
  }

  get filePath(): string {
    return this.props.filePath;
  }

  get fileHash(): string | undefined {
    return this.props.fileHash;
  }

  get status(): ManuscriptStatus {
    return this.props.status;
  }

  get statusMessage(): string | undefined {
    return this.props.statusMessage;
  }

  get title(): string | undefined {
    return this.props.title;
  }

  get abstract(): string | undefined {
    return this.props.abstract;
  }

  get keywords(): readonly string[] {
    return this.props.keywords;
  }

  get extractedText(): string | undefined {
    return this.props.extractedText;
  }

  get wordCount(): number | undefined {
    return this.props.wordCount;
  }

  get pageCount(): number | undefined {
    return this.props.pageCount;
  }

  get version(): number {
    return this.props.version;
  }

  get authors(): readonly ManuscriptAuthorProps[] {
    return this._authors;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  // ============================================================
  // Serialization
  // ============================================================

  toObject(): ManuscriptProps & { authors: ManuscriptAuthorProps[] } {
    return {
      ...this.props,
      authors: [...this._authors],
    };
  }
}

// ============================================================
// Domain Event Interface
// ============================================================

interface DomainEvent {
  type: string;
  aggregateId: string;
  data: Record<string, unknown>;
  timestamp: Date;
}
