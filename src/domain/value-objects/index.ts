/**
 * Value Objects
 * 
 * Immutable objects that represent concepts without identity.
 * They are equal if their values are equal.
 */

// ============================================================
// Email Value Object
// ============================================================

export class Email {
  private readonly _value: string;

  private constructor(value: string) {
    this._value = value;
  }

  static create(value: string): Email {
    const normalized = value.toLowerCase().trim();

    if (!Email.isValid(normalized)) {
      throw new DomainError("INVALID_EMAIL", `Invalid email format: ${value}`);
    }

    return new Email(normalized);
  }

  static isValid(email: string): boolean {
    const emailRegex = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
    return emailRegex.test(email) && email.length <= 254;
  }

  equals(other: Email): boolean {
    return this._value === other._value;
  }

  get value(): string {
    return this._value;
  }

  get domain(): string {
    return this._value.split("@")[1];
  }

  get localPart(): string {
    return this._value.split("@")[0];
  }

  toString(): string {
    return this._value;
  }
}

// ============================================================
// ORCID Value Object
// ============================================================

export class ORCID {
  private readonly _value: string;

  private constructor(value: string) {
    this._value = value;
  }

  static create(value: string): ORCID {
    const normalized = ORCID.normalize(value);

    if (!ORCID.isValid(normalized)) {
      throw new DomainError("INVALID_ORCID", `Invalid ORCID format: ${value}`);
    }

    return new ORCID(normalized);
  }

  static normalize(orcid: string): string {
    // Remove URL prefix if present
    let normalized = orcid
      .replace("https://orcid.org/", "")
      .replace("http://orcid.org/", "")
      .trim()
      .toUpperCase();

    // Ensure dashes are in correct positions
    if (normalized.length === 16 && !normalized.includes("-")) {
      normalized = `${normalized.slice(0, 4)}-${normalized.slice(4, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}`;
    }

    return normalized;
  }

  static isValid(orcid: string): boolean {
    // ORCID format: XXXX-XXXX-XXXX-XXXX (where X is 0-9 or X for checksum)
    const orcidRegex = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;
    if (!orcidRegex.test(orcid)) return false;

    // Validate checksum
    return ORCID.validateChecksum(orcid);
  }

  private static validateChecksum(orcid: string): boolean {
    const digits = orcid.replace(/-/g, "");
    let total = 0;

    for (let i = 0; i < 15; i++) {
      total = (total + parseInt(digits[i], 10)) * 2;
    }

    const remainder = total % 11;
    const checkDigit = (12 - remainder) % 11;
    const expectedCheck = checkDigit === 10 ? "X" : checkDigit.toString();

    return digits[15] === expectedCheck;
  }

  equals(other: ORCID): boolean {
    return this._value === other._value;
  }

  get value(): string {
    return this._value;
  }

  get url(): string {
    return `https://orcid.org/${this._value}`;
  }

  toString(): string {
    return this._value;
  }
}

// ============================================================
// FileHash Value Object
// ============================================================

export class FileHash {
  private readonly _value: string;
  private readonly _algorithm: string;

  private constructor(value: string, algorithm: string) {
    this._value = value;
    this._algorithm = algorithm;
  }

  static create(value: string, algorithm = "sha256"): FileHash {
    if (!FileHash.isValid(value, algorithm)) {
      throw new DomainError("INVALID_HASH", `Invalid hash format for ${algorithm}`);
    }

    return new FileHash(value.toLowerCase(), algorithm);
  }

  static isValid(hash: string, algorithm: string): boolean {
    const lengths: Record<string, number> = {
      md5: 32,
      sha1: 40,
      sha256: 64,
      sha512: 128,
    };

    const expectedLength = lengths[algorithm.toLowerCase()];
    if (!expectedLength) return false;

    return hash.length === expectedLength && /^[a-f0-9]+$/i.test(hash);
  }

  equals(other: FileHash): boolean {
    return this._value === other._value && this._algorithm === other._algorithm;
  }

  get value(): string {
    return this._value;
  }

  get algorithm(): string {
    return this._algorithm;
  }

  toString(): string {
    return `${this._algorithm}:${this._value}`;
  }
}

// ============================================================
// DOI Value Object
// ============================================================

export class DOI {
  private readonly _value: string;

  private constructor(value: string) {
    this._value = value;
  }

  static create(value: string): DOI {
    const normalized = DOI.normalize(value);

    if (!DOI.isValid(normalized)) {
      throw new DomainError("INVALID_DOI", `Invalid DOI format: ${value}`);
    }

    return new DOI(normalized);
  }

  static normalize(doi: string): string {
    return doi
      .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
      .replace(/^doi:/i, "")
      .trim();
  }

  static isValid(doi: string): boolean {
    // DOI format: 10.prefix/suffix
    const doiRegex = /^10\.\d{4,}(?:\.\d+)*\/\S+$/;
    return doiRegex.test(doi);
  }

  equals(other: DOI): boolean {
    return this._value.toLowerCase() === other._value.toLowerCase();
  }

  get value(): string {
    return this._value;
  }

  get url(): string {
    return `https://doi.org/${this._value}`;
  }

  toString(): string {
    return this._value;
  }
}

// ============================================================
// PMID Value Object
// ============================================================

export class PMID {
  private readonly _value: string;

  private constructor(value: string) {
    this._value = value;
  }

  static create(value: string | number): PMID {
    const normalized = String(value).trim();

    if (!PMID.isValid(normalized)) {
      throw new DomainError("INVALID_PMID", `Invalid PMID: ${value}`);
    }

    return new PMID(normalized);
  }

  static isValid(pmid: string): boolean {
    // PMID is a positive integer
    const pmidRegex = /^[1-9]\d{0,8}$/;
    return pmidRegex.test(pmid);
  }

  equals(other: PMID): boolean {
    return this._value === other._value;
  }

  get value(): string {
    return this._value;
  }

  get numericValue(): number {
    return parseInt(this._value, 10);
  }

  get pubmedUrl(): string {
    return `https://pubmed.ncbi.nlm.nih.gov/${this._value}`;
  }

  toString(): string {
    return this._value;
  }
}

// ============================================================
// ManuscriptId Value Object
// ============================================================

export class ManuscriptId {
  private readonly _value: string;

  private constructor(value: string) {
    this._value = value;
  }

  static create(value: string): ManuscriptId {
    if (!value || value.trim().length === 0) {
      throw new DomainError("INVALID_ID", "ManuscriptId cannot be empty");
    }

    return new ManuscriptId(value.trim());
  }

  static generate(): ManuscriptId {
    // Generate CUID-like ID
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 10);
    return new ManuscriptId(`manu_${timestamp}${random}`);
  }

  equals(other: ManuscriptId): boolean {
    return this._value === other._value;
  }

  get value(): string {
    return this._value;
  }

  toString(): string {
    return this._value;
  }
}

// ============================================================
// Domain Error
// ============================================================

export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "DomainError";
  }
}
