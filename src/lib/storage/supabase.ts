/**
 * Supabase Storage Provider
 * 
 * Uses Supabase Storage for file persistence.
 * Ideal for serverless deployments.
 */

import { StorageProvider, StorageFile, UploadOptions } from "./local";

const BUCKET_NAME = "manuscripts";

export class SupabaseStorageProvider implements StorageProvider {
  private supabaseUrl: string;
  private serviceKey: string;

  constructor() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;

    if (!url || !key) {
      throw new Error(
        "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set for Supabase storage"
      );
    }

    this.supabaseUrl = url;
    this.serviceKey = key;
  }

  private get storageUrl(): string {
    return `${this.supabaseUrl}/storage/v1`;
  }

  private get headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.serviceKey}`,
      "Content-Type": "application/json",
    };
  }

  async upload(
    path: string,
    data: Buffer | Uint8Array,
    options?: UploadOptions
  ): Promise<StorageFile> {
    const url = `${this.storageUrl}/object/${BUCKET_NAME}/${path}`;
    
    // Convert to ArrayBuffer for fetch compatibility
    const contentType = options?.contentType || "application/octet-stream";
    const arrayBuffer = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength
    ) as ArrayBuffer;
    
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.serviceKey}`,
        "Content-Type": contentType,
        "x-upsert": "true", // Overwrite if exists
      },
      body: arrayBuffer,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to upload to Supabase Storage: ${error}`);
    }

    return {
      path,
      size: data.length,
      contentType: options?.contentType,
      metadata: options?.metadata,
    };
  }

  async download(path: string): Promise<Buffer> {
    const url = `${this.storageUrl}/object/${BUCKET_NAME}/${path}`;
    
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.serviceKey}`,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`File not found: ${path}`);
      }
      const error = await response.text();
      throw new Error(`Failed to download from Supabase Storage: ${error}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async delete(path: string): Promise<void> {
    const url = `${this.storageUrl}/object/${BUCKET_NAME}`;
    
    const response = await fetch(url, {
      method: "DELETE",
      headers: this.headers,
      body: JSON.stringify({ prefixes: [path] }),
    });

    if (!response.ok && response.status !== 404) {
      const error = await response.text();
      throw new Error(`Failed to delete from Supabase Storage: ${error}`);
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      const url = `${this.storageUrl}/object/info/${BUCKET_NAME}/${path}`;
      
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.serviceKey}`,
        },
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  async list(prefix?: string): Promise<StorageFile[]> {
    const url = `${this.storageUrl}/object/list/${BUCKET_NAME}`;
    
    const response = await fetch(url, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        prefix: prefix || "",
        limit: 1000,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to list Supabase Storage: ${error}`);
    }

    const items = await response.json();
    
    return items
      .filter((item: { name: string }) => item.name && !item.name.endsWith("/"))
      .map((item: { name: string; metadata?: { size?: number; mimetype?: string } }) => ({
        path: prefix ? `${prefix}/${item.name}` : item.name,
        size: item.metadata?.size,
        contentType: item.metadata?.mimetype,
      }));
  }

  getPublicUrl(path: string): string {
    // For private buckets, we need to generate a signed URL
    // For now, return a placeholder - files should be accessed via API
    return `${this.supabaseUrl}/storage/v1/object/public/${BUCKET_NAME}/${path}`;
  }

  async getSignedUrl(path: string, expiresIn: number = 3600): Promise<string> {
    const url = `${this.storageUrl}/object/sign/${BUCKET_NAME}/${path}`;
    
    const response = await fetch(url, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ expiresIn }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create signed URL: ${error}`);
    }

    const result = await response.json();
    return `${this.supabaseUrl}/storage/v1${result.signedURL}`;
  }
}
