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
import { SupabaseStorageProvider } from "./supabase";

// Re-export types
export type { StorageProvider, StorageFile, UploadOptions };

// Storage provider type
export type StorageProviderType = "local" | "s3" | "r2" | "supabase";

// Get the configured storage provider
function getStorageProvider(): StorageProvider {
  const providerType = (process.env.STORAGE_PROVIDER || "local") as StorageProviderType;

  switch (providerType) {
    case "supabase":
      return new SupabaseStorageProvider();
    case "s3":
      throw new Error("S3 storage provider is not configured in this build");
    case "r2":
      throw new Error("R2 storage provider is not configured in this build");
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
