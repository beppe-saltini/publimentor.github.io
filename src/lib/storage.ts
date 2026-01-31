/**
 * File Storage Module
 * 
 * Supports local filesystem storage with future migration path to S3/R2
 */

import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

// ============================================================
// Types
// ============================================================

export interface StorageFile {
  path: string;
  size: number;
  mimeType: string;
  hash?: string;
  url?: string;
  createdAt: Date;
}

export interface UploadOptions {
  publisherId: string;
  journalId?: string;
  manuscriptId: string;
  fileName: string;
  mimeType: string;
}

// ============================================================
// Helper Functions
// ============================================================

export function generateStoragePath(options: UploadOptions): string {
  const { publisherId, journalId, manuscriptId, fileName } = options;
  const timestamp = Date.now();
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
  const parts = ["publishers", publisherId];
  if (journalId) {
    parts.push("journals", journalId);
  }
  parts.push("manuscripts", manuscriptId, `${timestamp}_${sanitizedFileName}`);
  return parts.join("/");
}

export function calculateHash(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

// ============================================================
// Local Storage Provider
// ============================================================

class LocalStorageProvider {
  private basePath: string;

  constructor() {
    this.basePath = process.env.LOCAL_STORAGE_PATH || path.join(process.cwd(), "uploads");
  }

  private getFullPath(filePath: string): string {
    return path.join(this.basePath, filePath);
  }

  async upload(buffer: Buffer, options: UploadOptions): Promise<StorageFile> {
    const storagePath = generateStoragePath(options);
    const fullPath = this.getFullPath(storagePath);
    
    // Ensure directory exists
    const dir = path.dirname(fullPath);
    await fs.mkdir(dir, { recursive: true });
    
    // Write file
    await fs.writeFile(fullPath, buffer);
    
    // Calculate hash
    const hash = calculateHash(buffer);
    
    return {
      path: storagePath,
      size: buffer.length,
      mimeType: options.mimeType,
      hash,
      createdAt: new Date(),
    };
  }

  async download(filePath: string): Promise<Buffer> {
    const fullPath = this.getFullPath(filePath);
    return fs.readFile(fullPath);
  }

  async delete(filePath: string): Promise<void> {
    const fullPath = this.getFullPath(filePath);
    try {
      await fs.unlink(fullPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  async exists(filePath: string): Promise<boolean> {
    const fullPath = this.getFullPath(filePath);
    try {
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  async getMetadata(filePath: string): Promise<StorageFile | null> {
    const fullPath = this.getFullPath(filePath);
    try {
      const stats = await fs.stat(fullPath);
      return {
        path: filePath,
        size: stats.size,
        mimeType: "application/octet-stream",
        createdAt: stats.birthtime,
      };
    } catch {
      return null;
    }
  }

  async list(prefix: string): Promise<StorageFile[]> {
    const fullPath = this.getFullPath(prefix);
    const files: StorageFile[] = [];
    
    try {
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isFile()) {
          const filePath = path.join(prefix, entry.name);
          const metadata = await this.getMetadata(filePath);
          if (metadata) {
            files.push(metadata);
          }
        }
      }
    } catch {
      // Return empty array if directory doesn't exist
    }
    
    return files;
  }
}

// ============================================================
// Singleton Export
// ============================================================

let storageInstance: LocalStorageProvider | null = null;

export function getStorage(): LocalStorageProvider {
  if (!storageInstance) {
    storageInstance = new LocalStorageProvider();
  }
  return storageInstance;
}

// ============================================================
// Legacy Helper (for backward compatibility)
// ============================================================

/**
 * Simple file upload helper for legacy submissions
 */
export async function uploadFile(file: File, folder: string): Promise<string> {
  const storage = getStorage();
  const buffer = Buffer.from(await file.arrayBuffer());
  const timestamp = Date.now();
  const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
  const filePath = `${folder}/${timestamp}_${sanitizedName}`;
  
  const basePath = process.env.LOCAL_STORAGE_PATH || path.join(process.cwd(), "uploads");
  const fullPath = path.join(basePath, filePath);
  
  // Ensure directory exists
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  
  // Write file
  await fs.writeFile(fullPath, buffer);
  
  // Return a relative URL
  return `/uploads/${filePath}`;
}
