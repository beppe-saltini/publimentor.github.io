/**
 * API Response Envelope
 * 
 * Standardized API response format for consistency across all endpoints.
 */

import { NextResponse } from "next/server";
import { ZodError } from "zod";

// ============================================================
// Types
// ============================================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  requestId: string;
  timestamp: string;
  data?: T;
  meta?: PaginationMeta;
  error?: ApiError;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  hasMore: boolean;
}

export interface ApiError {
  code: string;
  message: string;
  target?: string;
  details?: ErrorDetail[];
  helpUrl?: string;
}

export interface ErrorDetail {
  code: string;
  message: string;
  target?: string;
}

// ============================================================
// Response Builders
// ============================================================

/**
 * Build a successful response
 */
export function success<T>(
  data: T,
  options: {
    requestId?: string;
    meta?: PaginationMeta;
    status?: number;
    headers?: Record<string, string>;
  } = {}
): NextResponse<ApiResponse<T>> {
  const response: ApiResponse<T> = {
    success: true,
    requestId: options.requestId || generateRequestId(),
    timestamp: new Date().toISOString(),
    data,
  };

  if (options.meta) {
    response.meta = options.meta;
  }

  return NextResponse.json(response, {
    status: options.status || 200,
    headers: options.headers,
  });
}

/**
 * Build a paginated response
 */
export function paginated<T>(
  data: T[],
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
  },
  options: {
    requestId?: string;
    headers?: Record<string, string>;
  } = {}
): NextResponse<ApiResponse<T[]>> {
  const totalPages = Math.ceil(pagination.totalCount / pagination.pageSize);

  return success(data, {
    ...options,
    meta: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      totalCount: pagination.totalCount,
      totalPages,
      hasMore: pagination.page < totalPages,
    },
  });
}

/**
 * Build an error response
 */
export function error(
  code: string,
  message: string,
  options: {
    requestId?: string;
    status?: number;
    target?: string;
    details?: ErrorDetail[];
    helpUrl?: string;
    headers?: Record<string, string>;
  } = {}
): NextResponse<ApiResponse<never>> {
  const response: ApiResponse<never> = {
    success: false,
    requestId: options.requestId || generateRequestId(),
    timestamp: new Date().toISOString(),
    error: {
      code,
      message,
      target: options.target,
      details: options.details,
      helpUrl: options.helpUrl,
    },
  };

  return NextResponse.json(response, {
    status: options.status || 400,
    headers: options.headers,
  });
}

// ============================================================
// Standard Error Responses
// ============================================================

export const ApiErrors = {
  badRequest: (message: string, requestId?: string) =>
    error("BAD_REQUEST", message, { status: 400, requestId }),

  unauthorized: (requestId?: string) =>
    error("UNAUTHORIZED", "Authentication required", { status: 401, requestId }),

  forbidden: (message = "You do not have permission to perform this action", requestId?: string) =>
    error("FORBIDDEN", message, { status: 403, requestId }),

  notFound: (resource = "Resource", requestId?: string) =>
    error("NOT_FOUND", `${resource} not found`, { status: 404, requestId }),

  conflict: (message: string, requestId?: string) =>
    error("CONFLICT", message, { status: 409, requestId }),

  validationError: (zodError: ZodError, requestId?: string) => {
    const details: ErrorDetail[] = zodError.issues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      target: issue.path.join("."),
    }));

    return error("VALIDATION_ERROR", "Request validation failed", {
      status: 400,
      details,
      requestId,
    });
  },

  rateLimitExceeded: (retryAfter: number, requestId?: string) =>
    error("RATE_LIMIT_EXCEEDED", "Too many requests. Please try again later.", {
      status: 429,
      requestId,
      headers: {
        "Retry-After": Math.ceil(retryAfter / 1000).toString(),
      },
    }),

  internalError: (requestId?: string) =>
    error("INTERNAL_ERROR", "An unexpected error occurred", { status: 500, requestId }),

  serviceUnavailable: (message = "Service temporarily unavailable", requestId?: string) =>
    error("SERVICE_UNAVAILABLE", message, { status: 503, requestId }),
};

// ============================================================
// Utilities
// ============================================================

/**
 * Generate a unique request ID
 */
export function generateRequestId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 10);
  return `req_${timestamp}_${randomPart}`;
}

/**
 * Extract request ID from headers or generate new one
 */
export function getRequestId(request: Request): string {
  return (
    request.headers.get("x-request-id") ||
    request.headers.get("x-correlation-id") ||
    generateRequestId()
  );
}

/**
 * Handle errors uniformly
 */
export function handleError(err: unknown, requestId?: string): NextResponse<ApiResponse<never>> {
  console.error("[API_ERROR]", { requestId, error: err });

  if (err instanceof ZodError) {
    const details: ErrorDetail[] = err.issues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      target: issue.path.join("."),
    }));

    return error("VALIDATION_ERROR", "Request validation failed", {
      status: 400,
      details,
      requestId,
    });
  }

  if (err instanceof Error) {
    // Check for known error types
    if (err.name === "PermissionError") {
      return ApiErrors.forbidden(err.message, requestId);
    }

    if (err.message.includes("not found")) {
      return ApiErrors.notFound(undefined, requestId);
    }
  }

  return ApiErrors.internalError(requestId);
}
