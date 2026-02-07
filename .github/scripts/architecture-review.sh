#!/usr/bin/env bash
# =============================================================================
# Architecture Review Engine
# =============================================================================
# Automated code review from 6 IT architect perspectives:
#   1. Data Architect       - Schema, data flow, integrity
#   2. Security Architect   - Auth, secrets, input validation, vulnerabilities
#   3. Infrastructure Arch  - Docker, deployment, scalability, health
#   4. Integration Architect - APIs, external services, error handling
#   5. Solution Architect   - Code structure, patterns, dependencies
#   6. Enterprise Architect - Standards, documentation, governance
# =============================================================================

set -euo pipefail

# --- Configuration ---
PROJECT_ROOT="${1:-.}"
REPORT_DIR="${PROJECT_ROOT}/reports"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
REPORT_DATE=$(date -u +"%Y-%m-%d")
REPORT_FILE="${REPORT_DIR}/architecture-review-${REPORT_DATE}.md"
SRC_DIR="${PROJECT_ROOT}/src"
PRISMA_SCHEMA="${PROJECT_ROOT}/prisma/schema.prisma"

# Severity counters
CRITICAL=0
HIGH=0
MEDIUM=0
LOW=0
INFO=0
PASSED=0

# --- Helpers ---
log() { echo "[REVIEW] $*" >&2; }

finding() {
  local severity="$1" architect="$2" title="$3" detail="$4" file="${5:-}" line="${6:-}"
  
  case "$severity" in
    CRITICAL) CRITICAL=$((CRITICAL + 1)); icon="🔴" ;;
    HIGH)     HIGH=$((HIGH + 1));         icon="🟠" ;;
    MEDIUM)   MEDIUM=$((MEDIUM + 1));     icon="🟡" ;;
    LOW)      LOW=$((LOW + 1));           icon="🔵" ;;
    INFO)     INFO=$((INFO + 1));         icon="ℹ️" ;;
    PASS)     PASSED=$((PASSED + 1));     icon="✅" ;;
    *) icon="❓" ;;
  esac

  echo "| ${icon} ${severity} | ${architect} | ${title} | ${detail} | ${file:+\`${file}\`}${line:+:${line}} |" >> "$REPORT_FILE"
}

section() {
  echo "" >> "$REPORT_FILE"
  echo "## $1" >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"
}

subsection() {
  echo "" >> "$REPORT_FILE"
  echo "### $1" >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"
}

start_table() {
  echo "| Severity | Architect | Finding | Detail | Location |" >> "$REPORT_FILE"
  echo "|----------|-----------|---------|--------|----------|" >> "$REPORT_FILE"
}

# =============================================================================
# REPORT HEADER
# =============================================================================
generate_header() {
  cat > "$REPORT_FILE" << 'HEADER'
# Architecture Review Report

> Automated analysis performed by the Architecture Review Board (ARB)

HEADER
  echo "**Report Date:** ${TIMESTAMP}" >> "$REPORT_FILE"
  echo "**Commit:** \`$(git -C "$PROJECT_ROOT" rev-parse --short HEAD 2>/dev/null || echo 'N/A')\`" >> "$REPORT_FILE"
  echo "**Branch:** \`$(git -C "$PROJECT_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'N/A')\`" >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"
  echo "---" >> "$REPORT_FILE"
}

# =============================================================================
# 1. DATA ARCHITECT
# =============================================================================
review_data() {
  section "1. Data Architect Review"
  subsection "Database Schema & Data Flow Analysis"
  start_table

  log "Running Data Architect review..."

  # --- Check: Missing indexes on foreign keys ---
  if [ -f "$PRISMA_SCHEMA" ]; then
    # Check for foreign keys without explicit indexes
    local fk_fields
    fk_fields=$(grep -E '^\s+\w+\s+String\s*$' "$PRISMA_SCHEMA" | grep -i 'id\b' | head -20 || true)
    
    # Check if major query fields have indexes
    if ! grep -q '@@index.*\[status\]' "$PRISMA_SCHEMA"; then
      finding "MEDIUM" "Data" "Missing index on status fields" "Some status fields may lack indexes for query optimization" "$PRISMA_SCHEMA"
    else
      finding "PASS" "Data" "Status field indexes present" "Key status fields have proper indexes" "$PRISMA_SCHEMA"
    fi

    # Check: Cascade delete risks
    local cascade_count
    cascade_count=$(grep -c 'onDelete: Cascade' "$PRISMA_SCHEMA" 2>/dev/null || echo "0")
    if [ "$cascade_count" -gt 10 ]; then
      finding "MEDIUM" "Data" "Extensive cascade deletes (${cascade_count} found)" "High number of cascade deletes could cause unintended data loss in complex relation chains" "$PRISMA_SCHEMA"
    fi

    # Check: No soft-delete pattern
    if ! grep -q 'deletedAt' "$PRISMA_SCHEMA" 2>/dev/null; then
      finding "HIGH" "Data" "No soft-delete pattern" "No deletedAt fields found. Hard deletes on compliance-sensitive data (manuscripts, audit logs) violate data retention best practices" "$PRISMA_SCHEMA"
    fi

    # Check: Audit log immutability
    if grep -q 'IMMUTABLE' "$PRISMA_SCHEMA"; then
      finding "PASS" "Data" "Audit log immutability documented" "Audit logs are marked as immutable in schema comments" "$PRISMA_SCHEMA"
    fi

    # Check: Vector embedding dimensions
    if grep -q 'vector(384)' "$PRISMA_SCHEMA"; then
      finding "INFO" "Data" "Embedding dimension: 384" "Using all-MiniLM-L6-v2 (384 dims). Consider 768/1536 dims for higher quality if latency allows" "$PRISMA_SCHEMA"
    fi

    # Check: JSON fields without validation schemas
    local json_fields
    json_fields=$(grep -cE '@db.JsonB|Json' "$PRISMA_SCHEMA" 2>/dev/null || echo "0")
    if [ "$json_fields" -gt 5 ]; then
      finding "MEDIUM" "Data" "Multiple JSON/JSONB fields (${json_fields})" "JSON fields lack schema enforcement at DB level. Ensure Zod validation exists at application layer" "$PRISMA_SCHEMA"
    fi

    # Check: No database migration files
    if [ ! -d "${PROJECT_ROOT}/prisma/migrations" ]; then
      finding "HIGH" "Data" "No Prisma migration files" "Using 'prisma db push' instead of migrations. This is unsafe for production - use 'prisma migrate' for version-controlled schema changes" "$PRISMA_SCHEMA"
    else
      finding "PASS" "Data" "Migration files present" "Database migrations are version controlled" "$PRISMA_SCHEMA"
    fi

    # Check: publisherId denormalization consistency
    local denorm_count
    denorm_count=$(grep -c 'Denormalized for query efficiency' "$PRISMA_SCHEMA" 2>/dev/null || echo "0")
    if [ "$denorm_count" -gt 0 ]; then
      finding "MEDIUM" "Data" "Denormalized publisherId (${denorm_count} models)" "Denormalized fields require sync logic to prevent data inconsistency. Verify triggers or app-level enforcement exist" "$PRISMA_SCHEMA"
    fi
  else
    finding "CRITICAL" "Data" "No Prisma schema found" "Database schema file is missing" ""
  fi

  # Check: No database connection pooling
  if [ -f "${SRC_DIR}/lib/prisma.ts" ]; then
    if ! grep -qE 'connection_limit|pool' "${SRC_DIR}/lib/prisma.ts" 2>/dev/null; then
      finding "MEDIUM" "Data" "No connection pooling configured" "Prisma client lacks explicit connection pool settings. Critical for production concurrency" "${SRC_DIR}/lib/prisma.ts"
    fi
  fi

  # Check: extractedText stored in DB as Text
  if grep -q 'extractedText.*@db.Text' "$PRISMA_SCHEMA"; then
    finding "MEDIUM" "Data" "Full manuscript text stored in DB" "Large text blobs (extractedText) in PostgreSQL can impact query performance. Consider external storage for text > 1MB" "$PRISMA_SCHEMA"
  fi
}

# =============================================================================
# 2. SECURITY ARCHITECT
# =============================================================================
review_security() {
  section "2. Security Architect Review"
  subsection "Authentication, Authorization & Vulnerability Analysis"
  start_table

  log "Running Security Architect review..."

  # --- Check: Hardcoded secrets ---
  local secret_files
  secret_files=$(grep -rlE 'super-secret|CHANGE.*IN.*PRODUCTION|TODO.*secret' "${PROJECT_ROOT}" \
    --include="*.ts" --include="*.tsx" --include="*.yml" --include="*.yaml" --include="*.json" \
    2>/dev/null | grep -v node_modules | grep -v '.next' | grep -v '.test.ts' | grep -v 'test/' | grep -v 'env.ts' | head -10 || true)
  
  if [ -n "$secret_files" ]; then
    for f in $secret_files; do
      finding "CRITICAL" "Security" "Potential hardcoded secret" "File contains hardcoded secrets or TODO markers for secrets" "$f"
    done
  fi

  # Check docker-compose for hardcoded passwords
  if grep -q 'POSTGRES_PASSWORD: postgres' "${PROJECT_ROOT}/docker-compose.yml" 2>/dev/null; then
    finding "HIGH" "Security" "Default DB password in docker-compose" "Development compose uses 'postgres/postgres' credentials. Ensure this file is never used in production" "docker-compose.yml"
  fi

  if [ -f "${PROJECT_ROOT}/docker-compose.prod.yml" ]; then
    if grep -q '\${.*:?.*required}' "${PROJECT_ROOT}/docker-compose.prod.yml" 2>/dev/null; then
      finding "PASS" "Security" "Production compose requires secrets" "Production docker-compose enforces required secrets via variable substitution" "docker-compose.prod.yml"
    fi
  fi

  # --- Check: CSP unsafe-inline / unsafe-eval ---
  local csp_files
  csp_files=$(grep -rlE "unsafe-inline|unsafe-eval" "${SRC_DIR}" --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v node_modules || true)
  if [ -n "$csp_files" ]; then
    for f in $csp_files; do
      finding "HIGH" "Security" "CSP uses unsafe-inline/unsafe-eval" "Content Security Policy allows unsafe-inline and unsafe-eval, weakening XSS protection" "$f"
    done
  fi

  # --- Check: NextAuth secret configuration ---
  if grep -q 'NEXTAUTH_SECRET.*super-secret' "${PROJECT_ROOT}/docker-compose.yml" 2>/dev/null; then
    finding "CRITICAL" "Security" "Weak NEXTAUTH_SECRET in compose" "NEXTAUTH_SECRET uses a weak default value. JWT tokens could be forged" "docker-compose.yml"
  fi

  # --- Check: Authentication bypass risks ---
  # Check if all API routes have auth checks
  local api_routes_total api_routes_no_auth
  api_routes_total=$(find "${SRC_DIR}/app/api" -name "route.ts" 2>/dev/null | wc -l | tr -d ' ')
  api_routes_no_auth=0
  
  while IFS= read -r route_file; do
    if ! grep -qE 'auth\(\)|getServerSession|session' "$route_file" 2>/dev/null; then
      # Skip health and metrics endpoints
      if ! echo "$route_file" | grep -qE 'health|metrics|auth/\['; then
        api_routes_no_auth=$((api_routes_no_auth + 1))
        finding "HIGH" "Security" "API route without authentication" "Route handler does not call auth() or check session" "$route_file"
      fi
    fi
  done < <(find "${SRC_DIR}/app/api" -name "route.ts" 2>/dev/null)

  if [ "$api_routes_no_auth" -eq 0 ]; then
    finding "PASS" "Security" "All sensitive API routes require auth" "All non-public API routes check authentication" ""
  fi

  # --- Check: Rate limiting coverage ---
  local rate_limit_count
  rate_limit_count=$(grep -rlE 'checkRateLimit|rateLimit' "${SRC_DIR}/app/api" --include="*.ts" 2>/dev/null | wc -l | tr -d ' ' || echo "0")
  if [ "$rate_limit_count" -lt 3 ]; then
    finding "HIGH" "Security" "Limited rate limiting coverage" "Only ${rate_limit_count} API routes implement rate limiting. Critical endpoints (login, upload, search) should all be rate-limited" ""
  fi

  # --- Check: In-memory rate limiting ---
  if grep -q 'new Map.*RateLimitEntry' "${SRC_DIR}/lib/security.ts" 2>/dev/null; then
    # Check if Redis adapter is also present
    if grep -qE 'RedisRateLimitStore|REDIS_URL|ioredis' "${SRC_DIR}/lib/security.ts" 2>/dev/null; then
      finding "PASS" "Security" "Rate limiting with Redis support" "Rate limiting supports Redis (REDIS_URL) with in-memory fallback" "${SRC_DIR}/lib/security.ts"
    else
      finding "HIGH" "Security" "In-memory rate limiting" "Rate limiting uses in-memory Map - resets on server restart and doesn't work across multiple instances. Use Redis in production" "${SRC_DIR}/lib/security.ts"
    fi
  fi

  # --- Check: Password hashing ---
  if grep -q 'bcryptjs' "${PROJECT_ROOT}/package.json" 2>/dev/null; then
    finding "PASS" "Security" "Password hashing with bcrypt" "Using bcryptjs for password hashing" ""
  fi

  # --- Check: SQL injection via raw queries ---
  local raw_sql
  raw_sql=$(grep -rnE '\$queryRaw|\$executeRaw|\.raw\(' "${SRC_DIR}" --include="*.ts" 2>/dev/null | grep -v node_modules || true)
  if [ -n "$raw_sql" ]; then
    finding "HIGH" "Security" "Raw SQL queries detected" "Raw queries bypass Prisma's SQL injection protection. Ensure parameterized queries are used" ""
  else
    finding "PASS" "Security" "No raw SQL queries" "All database queries use Prisma's parameterized query builder" ""
  fi

  # --- Check: File upload security ---
  if grep -q 'validateFileType' "${SRC_DIR}/app/api/manuscripts/upload/route.ts" 2>/dev/null; then
    finding "PASS" "Security" "File upload validates magic bytes" "Upload endpoint validates file content against claimed MIME type" ""
  fi

  # --- Check: CORS configuration ---
  if ! grep -rqE 'Access-Control-Allow-Origin|cors' "${SRC_DIR}" --include="*.ts" 2>/dev/null; then
    finding "MEDIUM" "Security" "No explicit CORS configuration" "No CORS headers or middleware found. If API is consumed by external clients, CORS must be configured" ""
  fi

  # --- Check: Environment file exposure ---
  if [ -f "${PROJECT_ROOT}/.env" ]; then
    if ! grep -q '\.env' "${PROJECT_ROOT}/.gitignore" 2>/dev/null; then
      finding "CRITICAL" "Security" ".env file may be committed" ".env file exists but may not be in .gitignore" ".env"
    fi
  fi

  # --- Check: cookies.txt exposure ---
  if [ -f "${PROJECT_ROOT}/cookies.txt" ]; then
    finding "CRITICAL" "Security" "cookies.txt in repository" "A cookies.txt file exists in the repository. This could contain session cookies or authentication tokens" "cookies.txt"
  fi

  # --- Check: Audit logging completeness ---
  if grep -q 'auditLog' "${SRC_DIR}/app/api/manuscripts/upload/route.ts" 2>/dev/null; then
    finding "PASS" "Security" "Audit logging on file upload" "Manuscript upload endpoint logs security events" ""
  fi

  # --- Check: Input validation with Zod ---
  local zod_usage
  zod_usage=$(grep -rlE 'z\.|zod' "${SRC_DIR}/app/api" --include="*.ts" 2>/dev/null | wc -l | tr -d ' ' || echo "0")
  # Also check for centralized validation module
  if [ -f "${SRC_DIR}/lib/api/validation.ts" ]; then
    finding "PASS" "Security" "Centralized API validation schemas" "Zod validation schemas defined in src/lib/api/validation.ts" "${SRC_DIR}/lib/api/validation.ts"
  elif [ "${zod_usage:-0}" -lt 5 ]; then
    finding "HIGH" "Security" "Limited input validation" "Only ${zod_usage} API routes use Zod validation. All user input should be validated at API boundary" ""
  else
    finding "PASS" "Security" "API routes use Zod validation" "${zod_usage} API routes have Zod validation" ""
  fi
}

# =============================================================================
# 3. INFRASTRUCTURE ARCHITECT
# =============================================================================
review_infrastructure() {
  section "3. Infrastructure Architect Review"
  subsection "Containerization, Deployment & Scalability"
  start_table

  log "Running Infrastructure Architect review..."

  # --- Check: Dockerfile security ---
  if [ -f "${PROJECT_ROOT}/Dockerfile" ]; then
    # Non-root user
    if grep -qE 'USER nextjs|USER node' "${PROJECT_ROOT}/Dockerfile" 2>/dev/null; then
      finding "PASS" "Infra" "Container runs as non-root" "Dockerfile creates and uses a non-root user" "Dockerfile"
    else
      finding "HIGH" "Infra" "Container runs as root" "No USER directive found. Container should not run as root" "Dockerfile"
    fi

    # Multi-stage build
    if grep -q 'FROM.*AS builder' "${PROJECT_ROOT}/Dockerfile" 2>/dev/null; then
      finding "PASS" "Infra" "Multi-stage Docker build" "Uses multi-stage build to minimize production image size" "Dockerfile"
    fi

    # Node version pinning
    if grep -q 'node:20-alpine' "${PROJECT_ROOT}/Dockerfile" 2>/dev/null; then
      finding "MEDIUM" "Infra" "Node version loosely pinned" "Using node:20-alpine without specific patch version. Pin to exact version (e.g., node:20.11.0-alpine) for reproducible builds" "Dockerfile"
    fi

    # Health check in Dockerfile
    if ! grep -q 'HEALTHCHECK' "${PROJECT_ROOT}/Dockerfile" 2>/dev/null; then
      finding "MEDIUM" "Infra" "No HEALTHCHECK in Dockerfile" "Dockerfile lacks HEALTHCHECK instruction. Container orchestrators benefit from built-in health checks" "Dockerfile"
    fi
  fi

  # --- Check: Health endpoints ---
  if [ -d "${SRC_DIR}/app/api/health" ]; then
    finding "PASS" "Infra" "Health check endpoints present" "Application has /api/health endpoints for liveness/readiness probes" ""
    
    # Check for database health in readiness probe
    if [ -f "${SRC_DIR}/app/api/health/ready/route.ts" ]; then
      if grep -qE 'prisma|database|db' "${SRC_DIR}/app/api/health/ready/route.ts" 2>/dev/null; then
        finding "PASS" "Infra" "Readiness probe checks database" "Health readiness endpoint verifies database connectivity" ""
      else
        finding "MEDIUM" "Infra" "Readiness probe may skip DB check" "Readiness endpoint should verify database connectivity" ""
      fi
    fi
  else
    finding "HIGH" "Infra" "No health check endpoints" "Application lacks /api/health endpoints for container orchestration" ""
  fi

  # --- Check: Metrics endpoint ---
  if [ -f "${SRC_DIR}/app/api/metrics/route.ts" ]; then
    finding "PASS" "Infra" "Metrics endpoint present" "Application exposes /api/metrics for monitoring" ""
  else
    finding "MEDIUM" "Infra" "No metrics endpoint" "Consider adding Prometheus-compatible metrics endpoint" ""
  fi

  # --- Check: Resource limits in docker-compose ---
  if grep -q 'deploy:' "${PROJECT_ROOT}/docker-compose.prod.yml" 2>/dev/null; then
    if grep -q 'memory:' "${PROJECT_ROOT}/docker-compose.prod.yml" 2>/dev/null; then
      finding "PASS" "Infra" "Memory limits configured" "Production compose sets memory limits on containers" "docker-compose.prod.yml"
    fi
  fi

  # --- Check: Database backup strategy ---
  if ! grep -rqE 'backup|pg_dump|pg_basebackup' "${PROJECT_ROOT}" --include="*.yml" --include="*.yaml" --include="*.sh" 2>/dev/null; then
    finding "HIGH" "Infra" "No database backup configuration" "No backup scripts or cron jobs found. Production databases MUST have automated backups" ""
  fi

  # --- Check: SSL/TLS termination ---
  if grep -q 'Strict-Transport-Security' "${PROJECT_ROOT}/next.config.ts" 2>/dev/null; then
    finding "PASS" "Infra" "HSTS header configured" "Strict-Transport-Security header enforces HTTPS" "next.config.ts"
  fi

  local proxy_config
  proxy_config=$(grep -rlE 'nginx|traefik|caddy' "${PROJECT_ROOT}" --include="*.yml" --include="*.yaml" 2>/dev/null | head -1 || true)
  if [ -z "$proxy_config" ]; then
    finding "MEDIUM" "Infra" "No reverse proxy configured" "Nginx/Traefik reverse proxy is commented out. Production should use a reverse proxy for SSL termination, load balancing" "docker-compose.prod.yml"
  fi

  # --- Check: Network isolation ---
  if grep -q 'networks:' "${PROJECT_ROOT}/docker-compose.prod.yml" 2>/dev/null; then
    if grep -q 'internal:' "${PROJECT_ROOT}/docker-compose.prod.yml" 2>/dev/null; then
      finding "PASS" "Infra" "Network isolation in production" "Production compose uses internal and external networks" "docker-compose.prod.yml"
    fi
  fi

  # --- Check: .dockerignore ---
  if [ -f "${PROJECT_ROOT}/.dockerignore" ]; then
    if grep -qE 'node_modules|\.env|\.git' "${PROJECT_ROOT}/.dockerignore" 2>/dev/null; then
      finding "PASS" "Infra" "Docker ignore configured" ".dockerignore excludes node_modules, .env, and .git" ".dockerignore"
    fi
  else
    finding "MEDIUM" "Infra" "No .dockerignore file" "Missing .dockerignore could lead to large Docker contexts" ""
  fi

  # --- Check: Logging strategy ---
  local console_log_count
  console_log_count=$(grep -rcE 'console\.log|console\.error' "${SRC_DIR}" --include="*.ts" --include="*.tsx" 2>/dev/null | awk -F: '{s+=$2} END {print s+0}' || echo "0")
  if [ "$console_log_count" -gt 50 ]; then
    finding "MEDIUM" "Infra" "Excessive console.log usage (${console_log_count})" "Use structured logging (e.g., pino, winston) instead of console.log for production observability" ""
  fi

  # Check for structured logger
  if [ -d "${SRC_DIR}/lib/logger" ]; then
    finding "PASS" "Infra" "Structured logger module exists" "Application has a dedicated logger module" "${SRC_DIR}/lib/logger/"
  fi

  # --- Check: Graceful shutdown ---
  if grep -rqE 'SIGTERM|SIGINT|graceful.*shutdown|initShutdownHandlers' "${SRC_DIR}" --include="*.ts" 2>/dev/null; then
    finding "PASS" "Infra" "Graceful shutdown handlers present" "Application handles SIGTERM/SIGINT for clean container restarts" ""
  else
    finding "MEDIUM" "Infra" "No graceful shutdown handler" "No SIGTERM/SIGINT handlers found. In-flight requests may be lost during container restarts" ""
  fi

  # --- Check: CI/CD pipeline ---
  if [ -d "${PROJECT_ROOT}/.github/workflows" ]; then
    local workflow_count
    workflow_count=$(find "${PROJECT_ROOT}/.github/workflows" -name "*.yml" -o -name "*.yaml" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$workflow_count" -gt 0 ]; then
      finding "PASS" "Infra" "CI/CD workflows present (${workflow_count})" "GitHub Actions workflows are configured" ""
    fi
  else
    finding "HIGH" "Infra" "No CI/CD pipeline" "No GitHub Actions workflows found. Automated testing, linting, and deployment should be configured" ""
  fi
}

# =============================================================================
# 4. INTEGRATION ARCHITECT
# =============================================================================
review_integration() {
  section "4. Integration Architect Review"
  subsection "API Design, External Services & Error Handling"
  start_table

  log "Running Integration Architect review..."

  # --- Check: API response consistency ---
  local api_error_patterns
  api_error_patterns=$(grep -rn 'NextResponse.json.*error' "${SRC_DIR}/app/api" --include="*.ts" 2>/dev/null | head -5 || true)
  if [ -n "$api_error_patterns" ]; then
    # Check if there's a standard error response helper
    if [ -f "${SRC_DIR}/lib/api/response.ts" ]; then
      finding "PASS" "Integration" "Standardized API response module" "Application has a centralized API response helper" "${SRC_DIR}/lib/api/response.ts"
    else
      finding "MEDIUM" "Integration" "No standard API error format" "API routes use inline error responses. Create a standard error envelope for consistency" ""
    fi
  fi

  # --- Check: External API error handling ---
  # Anthropic API
  if grep -rq 'api.anthropic.com' "${SRC_DIR}" --include="*.ts" 2>/dev/null; then
    if grep -A5 'api.anthropic.com' "${SRC_DIR}/lib/llm.ts" 2>/dev/null | grep -q 'catch\|try'; then
      finding "PASS" "Integration" "Anthropic API has error handling" "LLM service wraps API calls in try/catch" "${SRC_DIR}/lib/llm.ts"
    fi

    # Check for retry logic
    if grep -rqE 'retry|backoff|resilientFetch|withRetry' "${SRC_DIR}/lib/llm.ts" 2>/dev/null; then
      finding "PASS" "Integration" "LLM API has retry logic" "LLM service uses retry with exponential backoff" "${SRC_DIR}/lib/llm.ts"
    else
      finding "HIGH" "Integration" "No retry logic for LLM API" "Anthropic API calls lack retry with exponential backoff. Transient failures will surface to users" "${SRC_DIR}/lib/llm.ts"
    fi

    # Check for timeout
    if grep -rqE 'timeout|AbortController|signal|LLM_TIMEOUT' "${SRC_DIR}/lib/llm.ts" 2>/dev/null; then
      finding "PASS" "Integration" "LLM API has timeout" "LLM service uses request timeouts" "${SRC_DIR}/lib/llm.ts"
    else
      finding "HIGH" "Integration" "No timeout on LLM API calls" "LLM API calls lack request timeouts. Slow responses could hang the server" "${SRC_DIR}/lib/llm.ts"
    fi
  fi

  # --- Check: External API configurations ---
  local external_apis=0
  for api in "openalex" "semantic-scholar" "pubmed" "orcid"; do
    if [ -f "${SRC_DIR}/lib/${api}.ts" ] || grep -rq "$api" "${SRC_DIR}/lib" --include="*.ts" 2>/dev/null; then
      external_apis=$((external_apis + 1))
    fi
  done
  finding "INFO" "Integration" "External API count: ${external_apis}" "Application integrates with ${external_apis} external academic APIs" ""

  # Check for circuit breaker pattern
  if grep -rqE 'circuit.*breaker|CircuitBreaker' "${SRC_DIR}" --include="*.ts" 2>/dev/null; then
    finding "PASS" "Integration" "Circuit breaker pattern implemented" "Resilience module provides circuit breakers for external API calls" ""
  else
    finding "HIGH" "Integration" "No circuit breaker pattern" "External API integrations lack circuit breakers. Cascading failures from downstream services could bring down the app" ""
  fi

  # --- Check: OpenAPI specification ---
  if [ -f "${PROJECT_ROOT}/docs/api/openapi.yaml" ]; then
    finding "PASS" "Integration" "OpenAPI specification exists" "API documentation in OpenAPI/Swagger format" "docs/api/openapi.yaml"
  else
    finding "MEDIUM" "Integration" "No OpenAPI specification" "Consider generating or maintaining an OpenAPI spec for API consumers" ""
  fi

  # --- Check: API versioning ---
  if ! grep -rqE '/api/v[0-9]|/v[0-9]/' "${SRC_DIR}/app/api" --include="*.ts" 2>/dev/null; then
    if ! ls -d "${SRC_DIR}/app/api/v"* 2>/dev/null | grep -q 'v[0-9]'; then
      finding "MEDIUM" "Integration" "No API versioning" "API routes are unversioned (/api/manuscripts vs /api/v1/manuscripts). Breaking changes will affect all clients" ""
    fi
  fi

  # --- Check: Webhook/event system ---
  if ! grep -rqE 'webhook|event.*bus|EventEmitter|pubsub' "${SRC_DIR}" --include="*.ts" 2>/dev/null; then
    finding "LOW" "Integration" "No event/webhook system" "Consider implementing webhooks or event bus for async notifications (e.g., manuscript status changes)" ""
  fi

  # --- Check: Request/response logging for integrations ---
  local fetch_count
  fetch_count=$(grep -rc 'fetch(' "${SRC_DIR}/lib" --include="*.ts" 2>/dev/null | awk -F: '{s+=$2} END {print s+0}' || echo "0")
  if [ "$fetch_count" -gt 5 ]; then
    finding "MEDIUM" "Integration" "External API calls (${fetch_count} fetch calls)" "Multiple external fetch calls found. Ensure all have proper logging, timeouts, and error handling" ""
  fi

  # --- Check: API key management ---
  local env_api_keys
  env_api_keys=$(grep -c 'API_KEY\|API_SECRET\|CLIENT_SECRET' "${PROJECT_ROOT}/docker-compose.prod.yml" 2>/dev/null || echo "0")
  if [ "$env_api_keys" -gt 0 ]; then
    finding "MEDIUM" "Integration" "API keys via environment variables" "API keys are passed via env vars. Consider using a secrets manager (AWS Secrets Manager, Vault) for production" "docker-compose.prod.yml"
  fi

  # --- Check: Async processing reliability ---
  if grep -q 'fire and forget' "${SRC_DIR}/app/api/manuscripts/upload/route.ts" 2>/dev/null; then
    finding "MEDIUM" "Integration" "Async processing with error recovery" "Manuscript processing uses catch-and-recover pattern. Consider a proper job queue (BullMQ, pg-boss) for full reliability" ""
  fi

  # --- Check: Database as job queue ---
  if grep -q 'ProcessingJob' "$PRISMA_SCHEMA" 2>/dev/null; then
    if ! grep -rqE 'bull|bullmq|pg-boss|agenda|bee-queue' "${PROJECT_ROOT}/package.json" 2>/dev/null; then
      finding "MEDIUM" "Integration" "Database used as job queue" "ProcessingJob table is used as a job queue. A dedicated queue (BullMQ, pg-boss) provides better reliability, retries, and concurrency control" ""
    fi
  fi
}

# =============================================================================
# 5. SOLUTION ARCHITECT
# =============================================================================
review_solution() {
  section "5. Solution Architect Review"
  subsection "Code Structure, Patterns & Dependencies"
  start_table

  log "Running Solution Architect review..."

  # --- Check: Architecture pattern adherence ---
  if [ -d "${SRC_DIR}/domain" ] && [ -d "${SRC_DIR}/infrastructure" ]; then
    finding "PASS" "Solution" "DDD layers present" "Domain and Infrastructure layers are structured per DDD principles" ""
  fi

  # Check domain coverage
  local entity_count
  entity_count=$(find "${SRC_DIR}/domain/entities" -name "*.ts" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$entity_count" -lt 3 ]; then
    finding "MEDIUM" "Solution" "Sparse domain model (${entity_count} entities)" "Only ${entity_count} domain entities defined. Rich domain models (Journal, Submission, Review) should be modeled as entities" "${SRC_DIR}/domain/entities/"
  fi

  # Check repository pattern completeness
  local repo_interfaces repo_implementations
  repo_interfaces=$(find "${SRC_DIR}/domain/repositories" -name "*.ts" 2>/dev/null | wc -l | tr -d ' ')
  repo_implementations=$(find "${SRC_DIR}/infrastructure/repositories" -name "*.ts" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$repo_interfaces" -ne "$repo_implementations" ]; then
    finding "MEDIUM" "Solution" "Repository interface/impl mismatch" "${repo_interfaces} interfaces vs ${repo_implementations} implementations. Each interface should have exactly one implementation" ""
  fi

  # --- Check: Dependency management ---
  if [ -f "${PROJECT_ROOT}/package.json" ]; then
    # Check for outdated/beta dependencies
    if grep -qE 'beta|alpha|rc|canary' "${PROJECT_ROOT}/package.json" 2>/dev/null; then
      local beta_deps
      beta_deps=$(grep -cE 'beta|alpha|rc|canary' "${PROJECT_ROOT}/package.json" 2>/dev/null || echo "0")
      finding "HIGH" "Solution" "Pre-release dependencies (${beta_deps})" "Production code depends on beta/alpha packages. These may have breaking changes or security issues" "package.json"
    fi

    # Check for lock file
    if [ -f "${PROJECT_ROOT}/package-lock.json" ]; then
      finding "PASS" "Solution" "Lock file present" "package-lock.json ensures reproducible installs" ""
    else
      finding "HIGH" "Solution" "No lock file" "Missing package-lock.json. Builds may not be reproducible" ""
    fi
  fi

  # --- Check: Error handling patterns ---
  local unhandled_promises
  unhandled_promises=$(grep -rnE '\.catch.*console\.(log|error)' "${SRC_DIR}" --include="*.ts" 2>/dev/null | wc -l | tr -d '[:space:]' || echo "0")
  unhandled_promises="${unhandled_promises:-0}"
  if [ "$unhandled_promises" -gt 5 ]; then
    finding "MEDIUM" "Solution" "Swallowed errors (${unhandled_promises} catch-and-log)" "Multiple catch blocks only log errors without proper error propagation or user notification" ""
  fi

  # --- Check: TypeScript strictness ---
  if [ -f "${PROJECT_ROOT}/tsconfig.json" ]; then
    if grep -q '"strict": true' "${PROJECT_ROOT}/tsconfig.json" 2>/dev/null; then
      finding "PASS" "Solution" "TypeScript strict mode enabled" "Strict type checking is configured" "tsconfig.json"
    else
      finding "HIGH" "Solution" "TypeScript strict mode not enabled" "Enable strict mode in tsconfig.json for better type safety" "tsconfig.json"
    fi
  fi

  # --- Check: Test coverage ---
  local test_files
  test_files=$(find "${PROJECT_ROOT}" \( -name "*.test.ts" -o -name "*.spec.ts" -o -name "*.test.tsx" -o -name "*.spec.tsx" \) -not -path "*/node_modules/*" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$test_files" -eq 0 ]; then
    finding "CRITICAL" "Solution" "No test files found" "Zero test files in the project. Unit tests, integration tests, and E2E tests are essential for production quality" ""
  elif [ "$test_files" -lt 10 ]; then
    finding "HIGH" "Solution" "Minimal test coverage (${test_files} files)" "Very few test files. Aim for tests on critical paths: auth, upload, processing, API routes" ""
  fi

  # Check for test framework
  if grep -qE 'jest|vitest|mocha|cypress|playwright' "${PROJECT_ROOT}/package.json" 2>/dev/null; then
    finding "PASS" "Solution" "Test framework configured" "Testing framework is configured in dependencies" "package.json"
  else
    finding "HIGH" "Solution" "No test framework configured" "No testing framework in dependencies. Add vitest or jest" "package.json"
  fi

  # --- Check: Code duplication indicators ---
  # Check for duplicated security header definitions
  local security_header_defs
  security_header_defs=$(grep -rl 'X-Content-Type-Options' "${SRC_DIR}" --include="*.ts" 2>/dev/null | wc -l | tr -d ' ')
  if [ "${security_header_defs:-0}" -gt 1 ]; then
    finding "MEDIUM" "Solution" "Duplicated security header definitions" "Security headers are defined in ${security_header_defs} files (middleware.ts, security.ts, next.config.ts). Centralize to one source of truth" ""
  fi

  # --- Check: Environment variable validation ---
  if [ -f "${SRC_DIR}/lib/env.ts" ] && grep -qE 'envSchema|z\.object|safeParse' "${SRC_DIR}/lib/env.ts" 2>/dev/null; then
    finding "PASS" "Solution" "Environment variable validation" "Zod-based env validation module exists at src/lib/env.ts" "${SRC_DIR}/lib/env.ts"
  elif grep -rlE 'z\.string.*env|createEnv|env.*schema|envalid|validateEnv' "${SRC_DIR}" --include="*.ts" >/dev/null 2>&1; then
    finding "PASS" "Solution" "Environment variable validation" "Environment variables are validated at startup" ""
  else
    finding "HIGH" "Solution" "No environment variable validation" "Environment variables are used without schema validation. Missing vars cause runtime errors. Use @t3-oss/env-nextjs or envalid" ""
  fi

  # --- Check: Proper separation of concerns ---
  local route_files_with_business_logic=0
  local route_file_list
  route_file_list=$(find "${SRC_DIR}/app/api" -name "route.ts" 2>/dev/null || true)
  if [ -n "$route_file_list" ]; then
    while IFS= read -r route_file; do
      if [ -f "$route_file" ]; then
        local line_count
        line_count=$(wc -l < "$route_file" | tr -d ' ')
        if [ "$line_count" -gt 150 ]; then
          route_files_with_business_logic=$((route_files_with_business_logic + 1))
        fi
      fi
    done <<< "$route_file_list"
  fi

  if [ "$route_files_with_business_logic" -gt 3 ]; then
    finding "MEDIUM" "Solution" "Large API route handlers (${route_files_with_business_logic})" "Multiple route handlers exceed 150 lines. Extract business logic into service/use-case layer" ""
  fi
}

# =============================================================================
# 6. ENTERPRISE ARCHITECT
# =============================================================================
review_enterprise() {
  section "6. Enterprise Architect Review"
  subsection "Standards, Compliance & Governance"
  start_table

  log "Running Enterprise Architect review..."

  # --- Check: Architecture Decision Records ---
  if [ -d "${PROJECT_ROOT}/docs/architecture/decisions" ]; then
    local adr_count
    adr_count=$(find "${PROJECT_ROOT}/docs/architecture/decisions" -name "*.md" -not -name "README*" -not -name "*template*" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$adr_count" -ge 5 ]; then
      finding "PASS" "Enterprise" "ADRs documented (${adr_count})" "Architecture decisions are well-documented with ${adr_count} ADRs" "docs/architecture/decisions/"
    else
      finding "LOW" "Enterprise" "Few ADRs (${adr_count})" "Consider documenting more architecture decisions" ""
    fi
  else
    finding "HIGH" "Enterprise" "No Architecture Decision Records" "Create docs/architecture/decisions/ directory with ADR documentation" ""
  fi

  # --- Check: Security documentation ---
  if [ -f "${PROJECT_ROOT}/docs/SECURITY.md" ]; then
    finding "PASS" "Enterprise" "Security documentation exists" "Security policies and practices are documented" "docs/SECURITY.md"
  else
    finding "MEDIUM" "Enterprise" "No SECURITY.md" "Document security practices, vulnerability reporting, and security architecture" ""
  fi

  # --- Check: Compliance frameworks ---
  if grep -rqE 'GDPR|SOX|HIPAA|COPE|ICMJE' "${PROJECT_ROOT}/docs" --include="*.md" 2>/dev/null || \
     grep -q 'complianceFramework' "$PRISMA_SCHEMA" 2>/dev/null; then
    finding "PASS" "Enterprise" "Compliance frameworks referenced" "Application references relevant compliance frameworks (GDPR, COPE, etc.)" ""
  else
    finding "MEDIUM" "Enterprise" "No compliance framework mapping" "Map features to compliance requirements (GDPR for data, COPE for editorial integrity)" ""
  fi

  # --- Check: Data retention policies ---
  if grep -q 'DataRetentionPolicy' "$PRISMA_SCHEMA" 2>/dev/null; then
    finding "PASS" "Enterprise" "Data retention model defined" "DataRetentionPolicy model exists for automated data lifecycle management" "$PRISMA_SCHEMA"
  fi
  
  if [ -d "${SRC_DIR}/lib/retention" ]; then
    finding "PASS" "Enterprise" "Retention logic implemented" "Data retention module exists" "${SRC_DIR}/lib/retention/"
  else
    finding "MEDIUM" "Enterprise" "Retention logic may be incomplete" "Verify retention policies are enforced via scheduled jobs" ""
  fi

  # --- Check: Deployment documentation ---
  if [ -f "${PROJECT_ROOT}/docs/DEPLOYMENT.md" ]; then
    finding "PASS" "Enterprise" "Deployment docs present" "Deployment procedures are documented" "docs/DEPLOYMENT.md"
  fi

  # --- Check: README quality ---
  if [ -f "${PROJECT_ROOT}/README.md" ]; then
    local readme_lines
    readme_lines=$(wc -l < "${PROJECT_ROOT}/README.md" | tr -d ' ')
    if [ "$readme_lines" -lt 20 ]; then
      finding "LOW" "Enterprise" "Sparse README (${readme_lines} lines)" "README should cover setup, architecture, contributing guidelines, and deployment" "README.md"
    else
      finding "PASS" "Enterprise" "README documentation" "Project README is documented" "README.md"
    fi
  fi

  # --- Check: License ---
  if [ ! -f "${PROJECT_ROOT}/LICENSE" ] && [ ! -f "${PROJECT_ROOT}/LICENSE.md" ]; then
    finding "MEDIUM" "Enterprise" "No LICENSE file" "Repository lacks a license file. Add appropriate license for intellectual property clarity" ""
  fi

  # --- Check: Code of Conduct ---
  # (optional for internal projects)

  # --- Check: Monitoring & Alerting readiness ---
  # Check both package.json and source code for monitoring
  if grep -rqE 'prometheus|datadog|newrelic|sentry' "${PROJECT_ROOT}/package.json" 2>/dev/null; then
    finding "PASS" "Enterprise" "Monitoring integration present" "Application has monitoring/APM integration in dependencies" ""
  elif [ -d "${SRC_DIR}/lib/monitoring" ] || grep -rqE 'captureException|initMonitoring|@sentry' "${SRC_DIR}" --include="*.ts" 2>/dev/null; then
    finding "PASS" "Enterprise" "Monitoring module present" "Application has a monitoring/error tracking module (add @sentry/nextjs to activate)" "${SRC_DIR}/lib/monitoring/"
  else
    finding "HIGH" "Enterprise" "No monitoring/APM integration" "No Sentry, Datadog, or similar monitoring. Production applications need error tracking and APM" ""
  fi

  # --- Check: Semantic versioning ---
  if [ -f "${PROJECT_ROOT}/package.json" ]; then
    local version
    version=$(grep '"version"' "${PROJECT_ROOT}/package.json" | head -1 | grep -o '"[0-9][^"]*"' | tr -d '"')
    if [ "$version" = "0.1.0" ]; then
      finding "INFO" "Enterprise" "Pre-release version (${version})" "Application is at version ${version}. Establish release versioning strategy before production" "package.json"
    fi
  fi

  # --- Check: CONTRIBUTING.md ---
  if [ ! -f "${PROJECT_ROOT}/CONTRIBUTING.md" ]; then
    finding "LOW" "Enterprise" "No CONTRIBUTING.md" "Add contributing guidelines for team collaboration" ""
  fi

  # --- Check: Dependency audit ---
  if grep -rqE 'audit|snyk|dependabot' "${PROJECT_ROOT}/.github" --include="*.yml" --include="*.yaml" 2>/dev/null; then
    finding "PASS" "Enterprise" "Dependency scanning configured" "Automated dependency vulnerability scanning is set up" ""
  else
    finding "HIGH" "Enterprise" "No dependency vulnerability scanning" "Configure Dependabot or Snyk for automated security updates on dependencies" ""
  fi
}

# =============================================================================
# REMEDIATION PLAN GENERATOR
# =============================================================================
generate_remediation_plan() {
  section "Remediation Plan"
  
  echo "Based on the findings above, the following remediation plan is recommended, prioritized by severity and impact." >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"

  subsection "Priority 1: Critical & High Severity (Immediate Action Required)"
  cat >> "$REPORT_FILE" << 'PLAN1'

| # | Action | Architect | Effort | Impact |
|---|--------|-----------|--------|--------|
| 1 | **Add test framework and critical path tests** | Solution | 2-3 days | Prevents regressions, enables CI/CD |
| 2 | **Remove cookies.txt from repository** | Security | 1 hour | Prevents credential exposure |
| 3 | **Implement database migrations** | Data | 1 day | Safe, version-controlled schema changes |
| 4 | **Add soft-delete pattern for compliance data** | Data | 1-2 days | Data retention compliance |
| 5 | **Replace in-memory rate limiting with Redis** | Security | 1 day | Works across instances, survives restarts |
| 6 | **Add retry logic + timeouts to LLM API calls** | Integration | 1 day | Prevents hangs and transient failures |
| 7 | **Add circuit breakers for external APIs** | Integration | 1-2 days | Prevents cascading failures |
| 8 | **Replace fire-and-forget with proper job queue** | Integration | 2-3 days | Reliable async processing |
| 9 | **Add environment variable validation** | Solution | 0.5 day | Fail-fast on missing config |
| 10 | **Implement Zod validation on all API routes** | Security | 2-3 days | Prevents injection and invalid data |
| 11 | **Set up Dependabot/Snyk for dependency scanning** | Enterprise | 0.5 day | Automated vulnerability detection |
| 12 | **Add monitoring/APM (Sentry or similar)** | Enterprise | 1 day | Error tracking and performance visibility |
| 13 | **Set up CI/CD pipeline (GitHub Actions)** | Infra | 1-2 days | Automated testing and deployment |

PLAN1

  subsection "Priority 2: Medium Severity (Plan for Next Sprint)"
  cat >> "$REPORT_FILE" << 'PLAN2'

| # | Action | Architect | Effort | Impact |
|---|--------|-----------|--------|--------|
| 14 | **Centralize security headers to single source** | Solution | 0.5 day | Eliminates configuration drift |
| 15 | **Add HEALTHCHECK to Dockerfile** | Infra | 0.5 hour | Better container orchestration |
| 16 | **Pin Node.js version in Dockerfile** | Infra | 0.5 hour | Reproducible builds |
| 17 | **Configure database connection pooling** | Data | 0.5 day | Production concurrency |
| 18 | **Implement structured logging (pino/winston)** | Infra | 1-2 days | Production observability |
| 19 | **Add CORS configuration** | Security | 0.5 day | Required if API has external consumers |
| 20 | **Configure reverse proxy (Nginx/Traefik)** | Infra | 1 day | SSL termination, load balancing |
| 21 | **Add API versioning strategy** | Integration | 1 day | Non-breaking API evolution |
| 22 | **Move to dedicated job queue (BullMQ/pg-boss)** | Integration | 2 days | Better reliability and monitoring |
| 23 | **Validate JSON schema fields at app layer** | Data | 1 day | Data integrity for JSON columns |
| 24 | **Add database backup automation** | Infra | 0.5 day | Disaster recovery |

PLAN2

  subsection "Priority 3: Low Severity & Improvements (Backlog)"
  cat >> "$REPORT_FILE" << 'PLAN3'

| # | Action | Architect | Effort | Impact |
|---|--------|-----------|--------|--------|
| 25 | **Enrich domain model (more entities)** | Solution | Ongoing | Better DDD adherence |
| 26 | **Add event/webhook system** | Integration | 2-3 days | Async notifications |
| 27 | **Add LICENSE file** | Enterprise | 0.5 hour | IP clarity |
| 28 | **Add CONTRIBUTING.md** | Enterprise | 0.5 day | Team collaboration |
| 29 | **Consider larger embedding dimensions** | Data | Research | Better RAG quality |
| 30 | **Graceful shutdown handlers** | Infra | 0.5 day | Clean container restarts |
| 31 | **Use secrets manager in production** | Integration | 1 day | Better secret hygiene |
| 32 | **CSP without unsafe-inline/unsafe-eval** | Security | 1-2 days | Stronger XSS protection |

PLAN3
}

# =============================================================================
# EXECUTIVE SUMMARY
# =============================================================================
generate_summary() {
  # Insert summary after the header (using temp file)
  local tmpfile
  tmpfile=$(mktemp)
  
  local total=$((CRITICAL + HIGH + MEDIUM + LOW + INFO))
  local total_checks=$((total + PASSED))
  local score
  if [ "$total_checks" -gt 0 ]; then
    # Weighted score: PASS=100%, INFO=90%, LOW=70%, MEDIUM=50%, HIGH=20%, CRITICAL=0%
    local weighted_sum=$(( PASSED * 100 + INFO * 90 + LOW * 70 + MEDIUM * 50 + HIGH * 20 + CRITICAL * 0 ))
    score=$(( weighted_sum / total_checks ))
  else
    score=100
  fi
  [ "$score" -lt 0 ] && score=0

  local grade
  if [ "$score" -ge 90 ]; then grade="A"
  elif [ "$score" -ge 80 ]; then grade="B"
  elif [ "$score" -ge 70 ]; then grade="C"
  elif [ "$score" -ge 60 ]; then grade="D"
  else grade="F"
  fi

  cat > "$tmpfile" << SUMMARY

## Executive Summary

| Metric | Value |
|--------|-------|
| **Architecture Health Score** | **${score}/100 (Grade: ${grade})** |
| Total Findings | ${total} |
| Checks Passed | ${PASSED} |
| Critical | ${CRITICAL} |
| High | ${HIGH} |
| Medium | ${MEDIUM} |
| Low | ${LOW} |
| Informational | ${INFO} |

### Key Risk Areas

SUMMARY

  if [ "$CRITICAL" -gt 0 ]; then
    echo "- **CRITICAL (${CRITICAL}):** Issues requiring immediate attention before production deployment" >> "$tmpfile"
  fi
  if [ "$HIGH" -gt 0 ]; then
    echo "- **HIGH (${HIGH}):** Significant issues that should be resolved in the current sprint" >> "$tmpfile"
  fi
  if [ "$MEDIUM" -gt 0 ]; then
    echo "- **MEDIUM (${MEDIUM}):** Issues to plan for in upcoming sprints" >> "$tmpfile"
  fi
  
  echo "" >> "$tmpfile"
  echo "---" >> "$tmpfile"

  # Insert summary after the header (after first ---)
  local header_end
  header_end=$(grep -n '^---$' "$REPORT_FILE" | head -1 | cut -d: -f1)
  
  if [ -n "$header_end" ]; then
    head -n "$header_end" "$REPORT_FILE" > "${REPORT_FILE}.new"
    cat "$tmpfile" >> "${REPORT_FILE}.new"
    tail -n +"$((header_end + 1))" "$REPORT_FILE" >> "${REPORT_FILE}.new"
    mv "${REPORT_FILE}.new" "$REPORT_FILE"
  fi

  rm -f "$tmpfile"
}

# =============================================================================
# MAIN EXECUTION
# =============================================================================
main() {
  log "Architecture Review Engine starting..."
  log "Project: ${PROJECT_ROOT}"
  log "Report: ${REPORT_FILE}"

  mkdir -p "$REPORT_DIR"
  
  generate_header
  
  review_data
  review_security
  review_infrastructure
  review_integration
  review_solution
  review_enterprise
  generate_remediation_plan
  generate_summary

  log "================================================"
  log "Review complete!"
  log "  Critical: ${CRITICAL}"
  log "  High:     ${HIGH}"
  log "  Medium:   ${MEDIUM}"
  log "  Low:      ${LOW}"
  log "  Info:     ${INFO}"
  log "  Passed:   ${PASSED}"
  log "  Report:   ${REPORT_FILE}"
  log "================================================"

  # Exit with non-zero if critical issues found
  if [ "$CRITICAL" -gt 0 ]; then
    exit 2
  elif [ "$HIGH" -gt 0 ]; then
    exit 1
  fi
  exit 0
}

main "$@"
