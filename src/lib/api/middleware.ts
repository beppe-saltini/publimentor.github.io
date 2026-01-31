/**
 * API Middleware Utilities
 * 
 * Provides request context, correlation IDs, and middleware composition.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRequestId, ApiErrors } from "./response";
import { PermissionChecker, createPermissionChecker, Resource, Action, ScopeContext } from "@/lib/permissions";
import { auditLogger, AuditContext } from "@/lib/audit";
import { checkRateLimit, getRateLimitResponse, RateLimitConfig } from "@/lib/security";

// ============================================================
// Request Context
// ============================================================

export interface RequestContext {
  requestId: string;
  ipAddress: string;
  userAgent: string;
  timestamp: Date;
}

export interface AuthenticatedContext extends RequestContext {
  userId: string;
  userEmail: string;
  permissions: PermissionChecker;
  publisherId?: string;
  journalId?: string;
}

/**
 * Extract request context from a request
 */
export function getRequestContext(request: NextRequest): RequestContext {
  return {
    requestId: getRequestId(request),
    ipAddress: getClientIp(request),
    userAgent: request.headers.get("user-agent") || "unknown",
    timestamp: new Date(),
  };
}

/**
 * Get client IP address from request
 */
export function getClientIp(request: NextRequest): string {
  // Check various headers in order of preference
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp;
  }

  const cfConnectingIp = request.headers.get("cf-connecting-ip");
  if (cfConnectingIp) {
    return cfConnectingIp;
  }

  return "unknown";
}

/**
 * Set audit context for the request
 */
export function setAuditContext(context: RequestContext, publisherId?: string): void {
  const auditContext: AuditContext = {
    requestId: context.requestId,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    publisherId,
  };
  auditLogger.setContext(auditContext);
}

// ============================================================
// Middleware Types
// ============================================================

export type ApiHandler<T = unknown> = (
  request: NextRequest,
  context: AuthenticatedContext
) => Promise<NextResponse<T>>;

export type PublicApiHandler<T = unknown> = (
  request: NextRequest,
  context: RequestContext
) => Promise<NextResponse<T>>;

// ============================================================
// Middleware Composers
// ============================================================

/**
 * Wrap a handler with authentication
 */
export function withAuth<T>(
  handler: ApiHandler<T>,
  options: {
    roles?: string[];
  } = {}
): (request: NextRequest) => Promise<NextResponse<T>> {
  return async (request: NextRequest) => {
    const requestContext = getRequestContext(request);

    try {
      const session = await auth();

      if (!session?.user?.id) {
        return ApiErrors.unauthorized(requestContext.requestId) as NextResponse<T>;
      }

      // TODO: Fetch user roles from database
      const userRoles = options.roles || ["USER"];
      const permissions = createPermissionChecker(
        session.user.id,
        userRoles
        // Add publisherId and journalId from user's memberships
      );

      const authContext: AuthenticatedContext = {
        ...requestContext,
        userId: session.user.id,
        userEmail: session.user.email || "",
        permissions,
      };

      setAuditContext(requestContext);

      return handler(request, authContext);
    } catch (error) {
      console.error("[AUTH_ERROR]", { requestId: requestContext.requestId, error });
      return ApiErrors.internalError(requestContext.requestId) as NextResponse<T>;
    }
  };
}

/**
 * Wrap a handler with rate limiting
 */
export function withRateLimit<T>(
  handler: (request: NextRequest, context: RequestContext) => Promise<NextResponse<T>>,
  config?: RateLimitConfig
): (request: NextRequest) => Promise<NextResponse<T>> {
  return async (request: NextRequest) => {
    const context = getRequestContext(request);
    const identifier = `${context.ipAddress}:${request.nextUrl.pathname}`;

    const rateLimitResult = checkRateLimit(identifier, config);

    if (!rateLimitResult.allowed) {
      await auditLogger.logSecurityEvent(
        "SECURITY_RATE_LIMIT_EXCEEDED",
        `Rate limit exceeded for ${identifier}`,
        { path: request.nextUrl.pathname },
        { requestId: context.requestId, ipAddress: context.ipAddress }
      );

      return getRateLimitResponse(rateLimitResult.resetIn) as NextResponse<T>;
    }

    return handler(request, context);
  };
}

/**
 * Wrap a handler with permission check
 */
export function withPermission<T>(
  handler: ApiHandler<T>,
  resource: Resource,
  action: Action,
  getScope?: (request: NextRequest, context: AuthenticatedContext) => ScopeContext | undefined
): ApiHandler<T> {
  return async (request: NextRequest, context: AuthenticatedContext) => {
    const scope = getScope ? getScope(request, context) : undefined;

    try {
      context.permissions.authorize(resource, action, scope);
    } catch {
      return ApiErrors.forbidden(undefined, context.requestId) as NextResponse<T>;
    }

    return handler(request, context);
  };
}

/**
 * Add correlation ID header to response
 */
export function withCorrelationId<T>(
  handler: (request: NextRequest) => Promise<NextResponse<T>>
): (request: NextRequest) => Promise<NextResponse<T>> {
  return async (request: NextRequest) => {
    const requestId = getRequestId(request);
    const response = await handler(request);

    response.headers.set("x-request-id", requestId);
    response.headers.set("x-correlation-id", requestId);

    return response;
  };
}

// ============================================================
// Composed Middleware
// ============================================================

/**
 * Full middleware stack for authenticated endpoints
 */
export function createProtectedHandler<T>(
  handler: ApiHandler<T>,
  options: {
    rateLimit?: RateLimitConfig;
    permission?: { resource: Resource; action: Action };
  } = {}
): (request: NextRequest) => Promise<NextResponse<T>> {
  let wrappedHandler = handler;

  // Apply permission check if specified
  if (options.permission) {
    wrappedHandler = withPermission(
      wrappedHandler,
      options.permission.resource,
      options.permission.action
    );
  }

  // Wrap with authentication
  let finalHandler = withAuth(wrappedHandler);

  // Wrap with rate limiting
  if (options.rateLimit) {
    finalHandler = withRateLimit(
      async (request, context) => {
        // Re-fetch auth after rate limit check passes
        return withAuth(wrappedHandler)(request);
      },
      options.rateLimit
    ) as (request: NextRequest) => Promise<NextResponse<T>>;
  }

  // Add correlation ID
  return withCorrelationId(finalHandler);
}

/**
 * Middleware stack for public endpoints
 */
export function createPublicHandler<T>(
  handler: PublicApiHandler<T>,
  options: {
    rateLimit?: RateLimitConfig;
  } = {}
): (request: NextRequest) => Promise<NextResponse<T>> {
  let wrappedHandler: (request: NextRequest) => Promise<NextResponse<T>> = async (request) => {
    const context = getRequestContext(request);
    return handler(request, context);
  };

  if (options.rateLimit) {
    wrappedHandler = withRateLimit(
      async (request, context) => handler(request, context),
      options.rateLimit
    );
  }

  return withCorrelationId(wrappedHandler);
}
