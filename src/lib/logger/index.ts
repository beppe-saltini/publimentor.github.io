/**
 * Structured Logging System
 * 
 * Provides JSON-formatted logs with:
 * - Request correlation IDs
 * - Automatic PII redaction
 * - Log levels (debug, info, warn, error)
 * - Context propagation
 */

// ============================================================
// Types
// ============================================================

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  requestId?: string;
  userId?: string;
  publisherId?: string;
  journalId?: string;
  traceId?: string;
  spanId?: string;
  [key: string]: unknown;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  service: string;
  version: string;
  environment: string;
  context?: LogContext;
  data?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

// ============================================================
// Configuration
// ============================================================

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const CURRENT_LEVEL = (process.env.LOG_LEVEL as LogLevel) || 
  (process.env.NODE_ENV === "development" ? "debug" : "info");

const SERVICE_NAME = process.env.SERVICE_NAME || "publimentor";
const APP_VERSION = process.env.APP_VERSION || "1.0.0";
const NODE_ENV = process.env.NODE_ENV || "development";

// Fields to redact from logs
const REDACT_FIELDS = new Set([
  "password",
  "token",
  "accessToken",
  "refreshToken",
  "authorization",
  "cookie",
  "creditCard",
  "ssn",
  "secret",
  "apiKey",
  "api_key",
  "privateKey",
  "private_key",
]);

// Patterns to redact
const REDACT_PATTERNS = [
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, // Email
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, // Credit card
  /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/g, // SSN
];

// ============================================================
// Redaction
// ============================================================

function shouldRedact(key: string): boolean {
  const lowerKey = key.toLowerCase();
  return REDACT_FIELDS.has(lowerKey) || 
    lowerKey.includes("password") || 
    lowerKey.includes("secret") ||
    lowerKey.includes("token") ||
    lowerKey.includes("key");
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    let redacted = value;
    for (const pattern of REDACT_PATTERNS) {
      redacted = redacted.replace(pattern, "[REDACTED]");
    }
    return redacted;
  }
  return value;
}

function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(obj)) {
    if (shouldRedact(key)) {
      result[key] = "[REDACTED]";
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = redactObject(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) => 
        typeof item === "object" && item !== null 
          ? redactObject(item as Record<string, unknown>) 
          : redactValue(item)
      );
    } else {
      result[key] = redactValue(value);
    }
  }
  
  return result;
}

// ============================================================
// Logger Class
// ============================================================

class Logger {
  private context: LogContext = {};

  /**
   * Set context for subsequent log calls
   */
  setContext(context: LogContext): void {
    this.context = { ...this.context, ...context };
  }

  /**
   * Clear context
   */
  clearContext(): void {
    this.context = {};
  }

  /**
   * Create a child logger with additional context
   */
  child(context: LogContext): Logger {
    const childLogger = new Logger();
    childLogger.context = { ...this.context, ...context };
    return childLogger;
  }

  /**
   * Log at debug level
   */
  debug(message: string, data?: Record<string, unknown>): void {
    this.log("debug", message, data);
  }

  /**
   * Log at info level
   */
  info(message: string, data?: Record<string, unknown>): void {
    this.log("info", message, data);
  }

  /**
   * Log at warn level
   */
  warn(message: string, data?: Record<string, unknown>): void {
    this.log("warn", message, data);
  }

  /**
   * Log at error level
   */
  error(message: string, error?: Error | unknown, data?: Record<string, unknown>): void {
    let errorData: { name: string; message: string; stack?: string } | undefined;
    
    if (error instanceof Error) {
      errorData = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    } else if (error) {
      errorData = {
        name: "UnknownError",
        message: String(error),
      };
    }

    this.log("error", message, data, errorData);
  }

  /**
   * Log HTTP request
   */
  request(data: {
    method: string;
    url: string;
    status: number;
    duration: number;
    userAgent?: string;
    ip?: string;
  }): void {
    this.info("HTTP Request", {
      event: "http_request",
      ...data,
    });
  }

  /**
   * Log database query
   */
  database(data: {
    operation: string;
    table: string;
    duration: number;
    rowCount?: number;
  }): void {
    this.debug("Database Query", {
      event: "database_query",
      ...data,
    });
  }

  /**
   * Log external API call
   */
  external(data: {
    service: string;
    operation: string;
    duration: number;
    success: boolean;
    statusCode?: number;
  }): void {
    this.info("External API Call", {
      event: "external_call",
      ...data,
    });
  }

  /**
   * Log security event
   */
  security(data: {
    event: string;
    severity: "low" | "medium" | "high" | "critical";
    description: string;
    [key: string]: unknown;
  }): void {
    this.warn("Security Event", {
      category: "security",
      ...data,
    });
  }

  /**
   * Log audit event
   */
  audit(data: {
    action: string;
    entityType: string;
    entityId: string;
    actorId?: string;
    [key: string]: unknown;
  }): void {
    this.info("Audit Event", {
      category: "audit",
      ...data,
    });
  }

  /**
   * Core logging function
   */
  private log(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>,
    error?: { name: string; message: string; stack?: string }
  ): void {
    // Check if level is enabled
    if (LOG_LEVELS[level] < LOG_LEVELS[CURRENT_LEVEL]) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      service: SERVICE_NAME,
      version: APP_VERSION,
      environment: NODE_ENV,
    };

    // Add context if present
    if (Object.keys(this.context).length > 0) {
      entry.context = this.context;
    }

    // Add and redact data if present
    if (data) {
      entry.data = redactObject(data);
    }

    // Add error if present
    if (error) {
      entry.error = error;
    }

    // Output based on environment
    if (NODE_ENV === "development") {
      this.prettyPrint(entry);
    } else {
      console.log(JSON.stringify(entry));
    }
  }

  /**
   * Pretty print for development
   */
  private prettyPrint(entry: LogEntry): void {
    const colors: Record<LogLevel, string> = {
      debug: "\x1b[36m", // Cyan
      info: "\x1b[32m",  // Green
      warn: "\x1b[33m",  // Yellow
      error: "\x1b[31m", // Red
    };
    const reset = "\x1b[0m";
    const color = colors[entry.level];

    const time = entry.timestamp.split("T")[1].split(".")[0];
    const prefix = `${color}[${entry.level.toUpperCase()}]${reset}`;
    
    let output = `${time} ${prefix} ${entry.message}`;
    
    if (entry.context?.requestId) {
      output += ` ${"\x1b[90m"}[${entry.context.requestId}]${reset}`;
    }
    
    console.log(output);
    
    if (entry.data) {
      console.log("  Data:", JSON.stringify(entry.data, null, 2));
    }
    
    if (entry.error) {
      console.log(`  ${color}Error:${reset}`, entry.error.message);
      if (entry.error.stack) {
        console.log("  Stack:", entry.error.stack.split("\n").slice(0, 5).join("\n"));
      }
    }
  }
}

// ============================================================
// Singleton Export
// ============================================================

export const logger = new Logger();

// Re-export for convenience
export { Logger };
