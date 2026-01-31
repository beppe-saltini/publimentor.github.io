# ADR-0006: Security Architecture and Controls

## Status
Accepted

## Date
2026-01-31

## Context
As a scientific publishing platform handling:
- Researcher personal data (PII)
- Unpublished manuscripts (sensitive intellectual property)
- Authentication credentials
- External API integrations

We require comprehensive security controls.

## Decision
Implement defense-in-depth security with the following layers:

### 1. Authentication & Session
- JWT with 15-minute access tokens
- Refresh token rotation
- Device fingerprint binding (planned)
- MFA support (planned)

### 2. Authorization
- Role-Based Access Control (RBAC) with scopes
- Resource:Action:Scope permission model
- Explicit manuscript permissions

### 3. Input Validation
- Zod schemas for all API inputs
- HTML/XSS sanitization
- File type validation with magic bytes
- Request size limits

### 4. Rate Limiting
- Per-IP and per-user limits
- Tiered limits (auth: strict, API: standard)
- Redis-backed for distributed deployment

### 5. Security Headers
- CSP, HSTS, X-Frame-Options
- No version disclosure

### 6. Audit Logging
- All security-relevant events logged
- Immutable audit trail in database
- Request correlation IDs

## Consequences

### Positive
- **Defense in depth**: Multiple security layers
- **Compliance ready**: Audit trail for regulatory requirements
- **Proactive detection**: Rate limiting prevents abuse

### Negative
- **Performance overhead**: Validation and logging add latency
- **Complexity**: Multiple security layers to maintain
- **False positives**: Rate limiting may affect legitimate users

### Risks
- **Bypass vulnerabilities**: New endpoints may miss security middleware; mitigated by middleware composition
- **Log tampering**: Audit logs could be modified; mitigated by immutable log design

## Security Checklist for New Features
- [ ] Input validation with Zod
- [ ] Output sanitization (especially LLM output)
- [ ] Authentication check
- [ ] Authorization check (permissions)
- [ ] Rate limiting applied
- [ ] Audit logging for sensitive operations
- [ ] Error messages don't leak information
- [ ] File uploads validated

## References
- [OWASP Top 10](https://owasp.org/Top10/)
- [OWASP API Security](https://owasp.org/www-project-api-security/)
- [CWE/SANS Top 25](https://cwe.mitre.org/top25/)
