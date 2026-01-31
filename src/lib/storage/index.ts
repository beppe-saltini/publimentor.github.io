/**
 * File Storage Abstraction Layer
 * 
 * Supports:
 * - Local filesystem (default)
 * - AWS S3
 * - Cloudflare R2
 * 
 * Storage provider is selected via STORAGE_PROVIDER env var
 */

import { LocalStorageProvider, StorageProvider, StorageFile, UploadOptions } from "./local";

// Re-export types
export type { StorageProvider, StorageFile, UploadOptions };

// Storage provider type
export type StorageProviderType = "local" | "s3" | "r2" | "supabase";

// Get the configured storage provider
function getStorageProvider(): StorageProvider {
  const providerType = (process.env.STORAGE_PROVIDER || "local") as StorageProviderType;

  switch (providerType) {
    case "supabase":
      // Supabase Storage - recommended for serverless
      const { SupabaseStorageProvider } = require("./supabase");
      return new SupabaseStorageProvider();
    case "s3":
      // Lazy import to avoid loading AWS SDK when not needed
      const { S3StorageProvider } = require("./s3");
      return new S3StorageProvider();
    case "r2":
      const { R2StorageProvider } = require("./r2");
      return new R2StorageProvider();
    case "local":
    default:
      return new LocalStorageProvider();
  }
}

// Singleton instance
let storageInstance: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (!storageInstance) {
    storageInstance = getStorageProvider();
  }
  return storageInstance;
}
