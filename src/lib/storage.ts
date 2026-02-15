/**
 * File Storage Module
 *
 * Supports:
 * - Local filesystem (development)
 * - Supabase Storage (production)
 *
 * getStorage() returns the appropriate provider based on STORAGE_PROVIDER env var.
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

export interface StorageProvider {
  upload(buffer: Buffer, options: UploadOptions): Promise<StorageFile>;
  download(filePath: string): Promise<Buffer>;
  delete(filePath: string): Promise<void>;
  exists(filePath: string): Promise<boolean>;
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
// Supabase Storage Provider
// ============================================================

class SupabaseStorageProvider implements StorageProvider {
  private async getClient() {
    // Dynamic import to avoid loading @supabase/supabase-js when not needed
    const { getSupabaseAdmin, MANUSCRIPTS_BUCKET } = await import("@/lib/supabase");
    return { supabase: getSupabaseAdmin(), bucket: MANUSCRIPTS_BUCKET };
  }

  async upload(buffer: Buffer, options: UploadOptions): Promise<StorageFile> {
    const storagePath = generateStoragePath(options);
    const { supabase, bucket } = await this.getClient();

    const { error } = await supabase.storage
      .from(bucket)
      .upload(storagePath, buffer, {
        contentType: options.mimeType,
        upsert: false,
      });

    if (error) {
      console.error("[SupabaseStorage] Upload failed:", error);
      throw new Error(`Storage upload failed: ${error.message}`);
    }

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
    const { supabase, bucket } = await this.getClient();

    const { data, error } = await supabase.storage
      .from(bucket)
      .download(filePath);

    if (error || !data) {
      console.error("[SupabaseStorage] Download failed:", error);
      throw new Error(`Storage download failed: ${error?.message || "no data"}`);
    }

    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async delete(filePath: string): Promise<void> {
    const { supabase, bucket } = await this.getClient();

    const { error } = await supabase.storage
      .from(bucket)
      .remove([filePath]);

    if (error) {
      console.error("[SupabaseStorage] Delete failed:", error);
      // Non-critical — don't throw
    }
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      const { supabase, bucket } = await this.getClient();
      // Try to get metadata — if it fails the file doesn't exist
      const { data, error } = await supabase.storage
        .from(bucket)
        .list(filePath.split("/").slice(0, -1).join("/"), {
          search: filePath.split("/").pop(),
        });
      return !error && (data?.length ?? 0) > 0;
    } catch {
      return false;
    }
  }
}

// ============================================================
// Local Storage Provider
// ============================================================

class LocalStorageProvider implements StorageProvider {
  private basePath: string;

  constructor() {
    // On Vercel the project directory is read-only; use /tmp for ephemeral storage.
    this.basePath = process.env.LOCAL_STORAGE_PATH
      || (process.env.VERCEL ? "/tmp/uploads" : path.join(process.cwd(), "uploads"));
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
}

// ============================================================
// Singleton Export
// ============================================================

let storageInstance: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (!storageInstance) {
    const provider = process.env.STORAGE_PROVIDER || "local";
    if (provider === "supabase") {
      storageInstance = new SupabaseStorageProvider();
    } else {
      storageInstance = new LocalStorageProvider();
    }
    console.log(`[Storage] Using ${provider} provider`);
  }
  return storageInstance;
}

/**
 * Get the storage provider name currently in use.
 */
export function getStorageProviderName(): "supabase" | "local" {
  return (process.env.STORAGE_PROVIDER === "supabase") ? "supabase" : "local";
}

// ============================================================
// Legacy Helper (for backward compatibility)
// ============================================================

export async function uploadFile(file: File, folder: string): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const timestamp = Date.now();
  const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
  const filePath = `${folder}/${timestamp}_${sanitizedName}`;

  const basePath = process.env.LOCAL_STORAGE_PATH
    || (process.env.VERCEL ? "/tmp/uploads" : path.join(process.cwd(), "uploads"));
  const fullPath = path.join(basePath, filePath);

  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, buffer);

  return `/uploads/${filePath}`;
}
