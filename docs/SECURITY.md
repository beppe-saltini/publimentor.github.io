# Security Documentation

This document outlines the security measures implemented in PubliMentor and best practices for deployment.

## Security Architecture Review (v0.2.0)

A comprehensive security audit was performed covering OWASP Top 10 and application-specific attack vectors.

## Security Features Implemented

### 1. Authentication & Authorization

- **NextAuth.js v5** with JWT sessions
- **bcryptjs** password hashing with cost factor 12
- **Strong password policy**:
  - Minimum 10 characters
  - Requires uppercase, lowercase, numbers, and special characters
  - Rejects common patterns (password, 123456, etc.)
- **Rate limiting** on auth endpoints (5 attempts per 15 minutes)
- **Session management** via secure HTTP-only cookies
- **IDOR protection** - Proper authorization checks on all resource access

### 2. Input Validation & Sanitization

- **Zod schema validation** on all API inputs with size limits:
  - String length limits (200-500 chars for text fields)
  - Array size limits (max 10 keywords, max 50 authors)
  - Number range validation (year: 1900-2100, H-index: 0-100)
- **HTML/XSS sanitization** for user-provided text
- **LLM output sanitization** - All AI-extracted metadata is sanitized before storage
- **SQL injection prevention** via Prisma ORM parameterized queries
- **Path traversal prevention** with resolved path validation

### 3. File Upload Security

- **MIME type validation** using magic bytes (not just extension)
- **File size limits** (50MB max)
- **Allowed extensions whitelist** (PDF, DOCX only)
- **Sanitized filenames** removing:
  - Path separators (`/`, `\`)
  - Null bytes
  - Special characters (`<>:"|?*`)
- **Content-Type validation** matches actual file content
- **Header injection prevention** in Content-Disposition

### 4. API Security

- **Rate limiting** on all endpoints:
  - Auth endpoints: 5 req/15min
  - Expensive APIs (reviewer discovery): 10 req/min
  - COI checks: 20 req/min
  - File downloads: 30 req/min
  - Default: 60 req/min
- **Pagination limits** - Max 100 items per page, max page 1000
- **Request body size limits** - 512KB for JSON, 50MB for uploads
- **Authentication required** for all protected routes
- **Authorization checks** (publisher membership, manuscript ownership)

### 5. Security Headers

All responses include (via Next.js config and middleware):
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Content-Security-Policy` (restrictive policy)
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `X-DNS-Prefetch-Control: on`
- API routes: `Cache-Control: no-store, no-cache`

### 6. Audit Logging

Security-relevant actions are logged with structured data:
- User registration
- Login attempts (success/failure)
- File uploads (with hash)
- File downloads
- Unauthorized access attempts
- Path traversal attempts
- Rate limit violations
- Malicious file upload attempts

### 7. Secrets Management

- Environment variables for all secrets
- No hardcoded credentials
- Separate production Docker Compose with required secrets
- Hidden Next.js version (poweredByHeader: false)

### 8. External API Security

- Hardcoded base URLs (no SSRF via user input)
- API keys stored in environment variables
- Rate limiting on endpoints that call external APIs
- Error messages don't expose API errors to users

### 9. DBLP API Integration Security (Sprint 2)

- **Base URL hardcoded**: `https://dblp.org/search` - no user-controlled URL construction
- **No API key required**: DBLP is a free, open API (no secrets to manage)
- **Client-side rate throttle**: 1.1s minimum between requests (enforced in `src/lib/dblp.ts`)
- **User-Agent identification**: Requests include `PubliMentor/1.0` identifier per DBLP fair-use policy
- **Response validation**: API responses are parsed and typed; unexpected shapes handled gracefully
- **Error isolation**: DBLP failures do not cascade to other COI checks; supplementary data source only

### 10. Full Integrity Report Security (Sprint 2)

- **Rate limiting**: `POST /api/integrity/full-report` limited to **5 requests per minute per user** (expensive composite operation)
- **Authentication required**: Session-based auth check before any processing
- **Input validation**: Zod schema validation on all inputs with max lengths (text, authors, references)
- **Fault isolation**: `Promise.allSettled` ensures individual check failures don't expose internal errors
- **No data persistence**: Reports are generated on-the-fly and not stored server-side
- **Error message sanitization**: Internal errors are caught and replaced with generic user-facing messages

### 11. Onboarding Flow Security (Sprint 2)

- **Server-side redirect guard**: Onboarding redirect is computed server-side via database query; cannot be spoofed client-side
- **Authenticated access**: Onboarding page requires valid session (inherits from dashboard layout)
- **Publisher/Journal creation**: Uses existing API endpoints which have their own rate limiting, input validation, and authorization checks
- **No privilege escalation**: Onboarding creates standard resources; user role is determined by existing RBAC system
- **Redirect loop prevention**: Users with existing publisher memberships are not redirected to onboarding

## Deployment Checklist

### Required Before Production

1. **Generate strong secrets**:
   ```bash
   # Generate NEXTAUTH_SECRET
   openssl rand -base64 32
   
   # Generate database password
   openssl rand -base64 24
   ```

2. **Configure environment variables**:
   - `NEXTAUTH_SECRET` - Random 32+ character string
   - `DATABASE_URL` - With strong password
   - `POSTGRES_PASSWORD` - Unique strong password

3. **Enable HTTPS**:
   - Use a reverse proxy (nginx, Caddy) with SSL
   - Set `NEXTAUTH_URL` to https://...
   - Configure secure cookies

4. **Database security**:
   - Don't expose port 5432 publicly
   - Use strong, unique password
   - Enable SSL connections
   - Regular backups with encryption

5. **File storage** (production):
   - Use S3/R2 instead of local storage
   - Configure bucket policies (private by default)
   - Enable server-side encryption

### Environment Variables

```bash
# Required
NEXTAUTH_SECRET=<random-32-chars>
NEXTAUTH_URL=https://your-domain.com
DATABASE_URL=postgresql://user:password@host:5432/db

# Recommended
POSTGRES_USER=publimentor
POSTGRES_PASSWORD=<strong-random-password>

# Optional (external services)
ANTHROPIC_API_KEY=sk-...
ORCID_CLIENT_ID=...
ORCID_CLIENT_SECRET=...

# Storage (S3/R2)
STORAGE_PROVIDER=s3
S3_BUCKET=your-bucket
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
S3_REGION=us-east-1
```

## Security Best Practices

### For Developers

1. **Never log sensitive data** (passwords, tokens, API keys)
2. **Use parameterized queries** (Prisma handles this)
3. **Validate all inputs** with Zod schemas
4. **Sanitize outputs** when rendering user content
5. **Check authorization** on every protected action
6. **Keep dependencies updated** - run `npm audit` regularly

### For Operators

1. **Monitor audit logs** for suspicious activity
2. **Set up alerts** for rate limit violations
3. **Regular security updates** for Docker images
4. **Backup database** with encryption
5. **Use secrets manager** (AWS Secrets Manager, Vault)
6. **Enable WAF** if using cloud hosting

## Known Limitations

1. **Rate limiting is in-memory** - use Redis in multi-instance deployments
2. **Audit logs go to console** - integrate with centralized logging in production
3. **No 2FA yet** - planned for future release
4. **No account lockout** - mitigated by rate limiting

## Penetration Testing Checklist - Sprint 2 Features

### DBLP Integration (`src/lib/dblp.ts`)
- [ ] **SSRF**: Verify no user input reaches URL construction (base URL is hardcoded)
- [ ] **DoS via DBLP**: Confirm rate throttle (1.1s/req) cannot be bypassed
- [ ] **Error leakage**: Ensure DBLP API errors (500, timeout) don't leak internal details to client
- [ ] **Injection**: Verify author name input is URL-encoded before DBLP query construction

### Full Integrity Report (`/api/integrity/full-report`)
- [ ] **Rate limit bypass**: Attempt > 5 requests/min with same user session; verify 429 response
- [ ] **Auth bypass**: Attempt POST without session cookie; verify 401
- [ ] **Input validation**: Send text < 100 chars, > 20 authors, malformed author objects; verify 400
- [ ] **Partial failure information disclosure**: Trigger individual check failures; verify no stack traces or internal paths in response
- [ ] **Resource exhaustion**: Send maximum-size inputs (20 authors, 100 references, long text) simultaneously; verify server remains responsive
- [ ] **XSS via report fields**: Inject `<script>` tags in author names, reference text; verify sanitization in response

### Responsive Layout (`src/components/dashboard/*`)
- [ ] **Mobile clickjacking**: Verify X-Frame-Options: DENY is enforced on mobile viewports
- [ ] **Touch event injection**: Test that backdrop/drawer close handlers don't expose state manipulation

### Onboarding Flow (`/dashboard/onboarding`)
- [ ] **Auth bypass**: Access `/dashboard/onboarding` without session; verify redirect to login
- [ ] **Forced redirect bypass**: Manipulate onboarding completion (e.g., directly POST to `/api/publishers` then `/api/journals`); verify no security implications
- [ ] **Publisher/Journal creation IDOR**: Attempt to create resources under another user's publisher; verify authorization rejection
- [ ] **CSRF on create endpoints**: Verify CSRF protection on `POST /api/publishers` and `POST /api/journals`
- [ ] **XSS in slug/name fields**: Inject script tags in publisher name, journal name, slug; verify sanitization

## Reporting Security Issues

If you discover a security vulnerability, please email security@[your-domain].com.

Do NOT open a public GitHub issue for security vulnerabilities.

## Security Updates

| Date | Version | Description |
|------|---------|-------------|
| 2026-01-31 | 0.2.0 | Added comprehensive security hardening |
| 2026-02-06 | 0.3.0 | Sprint 2: DBLP integration security, full integrity report rate limiting, onboarding auth guards, pen test checklist |
