/**
 * Local Filesystem Storage Provider
 * 
 * For development and self-hosted deployments.
 * Files are stored in the ./uploads directory.
 */

import fs from "fs/promises";
import path from "path";

// Storage file metadata
export interface StorageFile {
  path: string;
  size?: number;
  contentType?: string;
  metadata?: Record<string, string>;
}

// Upload options
export interface UploadOptions {
  contentType?: string;
  metadata?: Record<string, string>;
}

// Storage provider interface
export interface StorageProvider {
  upload(path: string, data: Buffer | Uint8Array, options?: UploadOptions): Promise<StorageFile>;
  download(path: string): Promise<Buffer>;
  delete(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(prefix?: string): Promise<StorageFile[]>;
  getPublicUrl(path: string): string;
}

// Base upload directory
const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";

export class LocalStorageProvider implements StorageProvider {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || UPLOAD_DIR;
  }

  private getFullPath(filePath: string): string {
    // Prevent path traversal
    const normalized = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, "");
    return path.join(this.baseDir, normalized);
  }

  async upload(
    filePath: string,
    data: Buffer | Uint8Array,
    options?: UploadOptions
  ): Promise<StorageFile> {
    const fullPath = this.getFullPath(filePath);
    const dir = path.dirname(fullPath);

    // Ensure directory exists
    await fs.mkdir(dir, { recursive: true });

    // Write file
    await fs.writeFile(fullPath, data);

    // Write metadata if provided
    if (options?.metadata || options?.contentType) {
      const metaPath = `${fullPath}.meta.json`;
      await fs.writeFile(
        metaPath,
        JSON.stringify({
          contentType: options.contentType,
          metadata: options.metadata,
          uploadedAt: new Date().toISOString(),
        })
      );
    }

    return {
      path: filePath,
      size: data.length,
      contentType: options?.contentType,
      metadata: options?.metadata,
    };
  }

  async download(filePath: string): Promise<Buffer> {
    const fullPath = this.getFullPath(filePath);

    try {
      return await fs.readFile(fullPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`File not found: ${filePath}`);
      }
      throw error;
    }
  }

  async delete(filePath: string): Promise<void> {
    const fullPath = this.getFullPath(filePath);

    try {
      await fs.unlink(fullPath);
      // Also delete metadata file if exists
      try {
        await fs.unlink(`${fullPath}.meta.json`);
      } catch {
        // Ignore if metadata doesn't exist
      }
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

  async list(prefix?: string): Promise<StorageFile[]> {
    const searchDir = prefix
      ? this.getFullPath(prefix)
      : this.baseDir;

    const results: StorageFile[] = [];

    try {
      const entries = await fs.readdir(searchDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isFile() && !entry.name.endsWith(".meta.json")) {
          const filePath = prefix
            ? path.join(prefix, entry.name)
            : entry.name;

          const fullPath = path.join(searchDir, entry.name);
          const stats = await fs.stat(fullPath);

          let contentType: string | undefined;
          try {
            const metaPath = `${fullPath}.meta.json`;
            const metaContent = await fs.readFile(metaPath, "utf-8");
            const meta = JSON.parse(metaContent);
            contentType = meta.contentType;
          } catch {
            // No metadata file
          }

          results.push({
            path: filePath,
            size: stats.size,
            contentType,
          });
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    return results;
  }

  getPublicUrl(filePath: string): string {
    // Local storage doesn't have public URLs
    // Return a path that would work with a static file server
    return `/uploads/${filePath}`;
  }
}
