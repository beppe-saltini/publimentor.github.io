# ADR-0004: Authentication with NextAuth.js v5

## Status
Accepted

## Date
2026-01-31

## Context
The application requires authentication supporting:
- Email/password login for general users
- ORCID OAuth for researcher identity verification
- Session management with JWT
- Future SSO integration possibilities

## Decision
We will use NextAuth.js v5 (Auth.js) with:
- JWT session strategy
- Credentials provider for email/password
- ORCID OAuth provider for researcher authentication
- Prisma adapter for user persistence

## Consequences

### Positive
- **Standardized**: Well-tested authentication flows
- **ORCID integration**: Native OAuth support for researcher identity
- **JWT sessions**: Stateless, scalable session management
- **Prisma adapter**: Seamless database integration
- **Extensible**: Easy to add new providers (Google, institutional SSO)

### Negative
- **Credentials complexity**: Password handling requires careful security
- **JWT limitations**: Cannot immediately revoke sessions
- **Version volatility**: v5 is newer, some breaking changes possible

### Risks
- **Session hijacking**: JWT theft allows impersonation; mitigated by short expiry, refresh tokens
- **Password attacks**: Brute force attempts; mitigated by rate limiting, account lockout

## Security Measures Implemented

1. **Password hashing**: bcryptjs with appropriate cost factor
2. **Rate limiting**: 5 attempts per 15 minutes on auth endpoints
3. **Password policy**: Minimum 10 characters, complexity requirements
4. **Session binding**: Future device fingerprint validation
5. **Audit logging**: All auth events logged

## Alternatives Considered

### Option A: Clerk
- **Pros**: Managed service, beautiful UI, many features
- **Cons**: Vendor lock-in, monthly costs, data residency concerns

### Option B: Auth0
- **Pros**: Enterprise features, compliance certifications
- **Cons**: Expensive at scale, complex configuration

### Option C: Custom JWT Implementation
- **Pros**: Full control, no dependencies
- **Cons**: Security risks, maintenance burden, reinventing the wheel

## References
- [NextAuth.js v5 Documentation](https://authjs.dev/)
- [ORCID OAuth Guide](https://info.orcid.org/documentation/api-tutorials/api-tutorial-get-and-authenticated-orcid-id/)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
