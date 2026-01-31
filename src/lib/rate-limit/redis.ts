/**
 * Redis-backed Rate Limiting
 * 
 * Distributed rate limiting using Redis for multi-instance deployments.
 * Falls back to in-memory when Redis is unavailable.
 * 
 * Note: Redis is optional. Install with `npm install redis` if needed.
 */

import { RateLimitConfig } from "@/lib/security";

// Redis types for optional dependency
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RedisModule = any;

// ============================================================
// Types
// ============================================================

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number;
  limit: number;
}

export interface RateLimiter {
  check(identifier: string): Promise<RateLimitResult>;
  reset(identifier: string): Promise<void>;
}

// ============================================================
// Redis Rate Limiter (Sliding Window)
// ============================================================

/**
 * Redis-backed rate limiter using sliding window algorithm
 * 
 * This implementation uses Redis sorted sets to track requests
 * in a sliding time window, providing accurate rate limiting.
 */
export class RedisRateLimiter implements RateLimiter {
  private config: RateLimitConfig;
  private keyPrefix: string;
  private redisClient: RedisClient | null = null;

  constructor(
    config: RateLimitConfig,
    options: {
      keyPrefix?: string;
      redisUrl?: string;
    } = {}
  ) {
    this.config = config;
    this.keyPrefix = options.keyPrefix || "ratelimit";
    
    // Initialize Redis connection
    this.initRedis(options.redisUrl);
  }

  private async initRedis(redisUrl?: string): Promise<void> {
    const url = redisUrl || process.env.REDIS_URL;
    
    if (!url) {
      console.warn("[RateLimiter] No Redis URL configured, using in-memory fallback");
      return;
    }

    try {
      // Dynamic import to avoid errors if redis is not installed
      // Using string variable to prevent TypeScript from analyzing the import
      const moduleName = "redis";
      let redis: RedisModule;
      try {
        redis = await import(/* webpackIgnore: true */ moduleName);
      } catch {
        console.warn("[RateLimiter] Redis package not installed, using in-memory fallback");
        return;
      }
      
      const client = redis.createClient({ url }) as RedisClient;
      
      client.on("error", (err: Error) => {
        console.error("[RateLimiter] Redis error:", err);
        this.redisClient = null; // Fall back to in-memory
      });

      await client.connect();
      this.redisClient = client;
      console.log("[RateLimiter] Connected to Redis");
    } catch {
      console.warn("[RateLimiter] Failed to connect to Redis, using in-memory fallback");
      this.redisClient = null;
    }
  }

  async check(identifier: string): Promise<RateLimitResult> {
    if (!this.redisClient) {
      return this.inMemoryCheck(identifier);
    }

    return this.redisCheck(identifier);
  }

  private async redisCheck(identifier: string): Promise<RateLimitResult> {
    const key = `${this.keyPrefix}:${identifier}`;
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    try {
      // Use Redis transaction for atomic operations
      const multi = this.redisClient!.multi();
      
      // Remove old entries outside the window
      multi.zRemRangeByScore(key, 0, windowStart);
      
      // Count current entries
      multi.zCard(key);
      
      // Add new entry with current timestamp as score
      multi.zAdd(key, { score: now, value: `${now}:${Math.random()}` });
      
      // Set expiry on the key
      multi.expire(key, Math.ceil(this.config.windowMs / 1000));
      
      const results = await multi.exec();
      
      // Get count from zCard result (second command)
      const count = (results?.[1] as number) || 0;
      
      const allowed = count < this.config.maxRequests;
      const remaining = Math.max(0, this.config.maxRequests - count - 1);
      
      return {
        allowed,
        remaining,
        resetIn: this.config.windowMs,
        limit: this.config.maxRequests,
      };
    } catch (error) {
      console.error("[RateLimiter] Redis error, falling back to in-memory:", error);
      return this.inMemoryCheck(identifier);
    }
  }

  // In-memory fallback (same as existing implementation)
  private inMemoryStore = new Map<string, { count: number; resetTime: number }>();

  private inMemoryCheck(identifier: string): RateLimitResult {
    const now = Date.now();
    const entry = this.inMemoryStore.get(identifier);

    if (!entry || now > entry.resetTime) {
      this.inMemoryStore.set(identifier, {
        count: 1,
        resetTime: now + this.config.windowMs,
      });
      return {
        allowed: true,
        remaining: this.config.maxRequests - 1,
        resetIn: this.config.windowMs,
        limit: this.config.maxRequests,
      };
    }

    if (entry.count >= this.config.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetIn: entry.resetTime - now,
        limit: this.config.maxRequests,
      };
    }

    entry.count++;
    return {
      allowed: true,
      remaining: this.config.maxRequests - entry.count,
      resetIn: entry.resetTime - now,
      limit: this.config.maxRequests,
    };
  }

  async reset(identifier: string): Promise<void> {
    const key = `${this.keyPrefix}:${identifier}`;

    if (this.redisClient) {
      try {
        await this.redisClient.del(key);
      } catch (error) {
        console.error("[RateLimiter] Failed to reset rate limit:", error);
      }
    }

    this.inMemoryStore.delete(identifier);
  }

  async disconnect(): Promise<void> {
    if (this.redisClient) {
      await this.redisClient.disconnect();
    }
  }
}

// ============================================================
// Type for Redis Client (minimal interface)
// ============================================================

interface RedisClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  multi(): RedisMulti;
  del(key: string): Promise<number>;
  on(event: string, handler: (err: Error) => void): void;
}

interface RedisMulti {
  zRemRangeByScore(key: string, min: number, max: number): RedisMulti;
  zCard(key: string): RedisMulti;
  zAdd(key: string, member: { score: number; value: string }): RedisMulti;
  expire(key: string, seconds: number): RedisMulti;
  exec(): Promise<unknown[]>;
}

// ============================================================
// Rate Limiter Factory
// ============================================================

const rateLimiters = new Map<string, RedisRateLimiter>();

/**
 * Get or create a rate limiter for a specific tier
 */
export function getRateLimiter(
  name: string,
  config: RateLimitConfig
): RedisRateLimiter {
  if (!rateLimiters.has(name)) {
    rateLimiters.set(name, new RedisRateLimiter(config, { keyPrefix: `ratelimit:${name}` }));
  }
  return rateLimiters.get(name)!;
}

// Pre-configured rate limiters
export const rateLimiters_ = {
  auth: () => getRateLimiter("auth", { windowMs: 15 * 60 * 1000, maxRequests: 5 }),
  api: () => getRateLimiter("api", { windowMs: 60 * 1000, maxRequests: 60 }),
  strict: () => getRateLimiter("strict", { windowMs: 60 * 1000, maxRequests: 10 }),
  upload: () => getRateLimiter("upload", { windowMs: 60 * 1000, maxRequests: 5 }),
};
