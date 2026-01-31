# PubliMentor - Future Improvements

This document tracks optional improvements and enhancements identified during the enterprise architecture review.

---

## High Priority

### 1. Redis Integration for Production
**Status**: Ready to implement  
**Effort**: Low  

Install Redis for distributed rate limiting in production:
```bash
npm install redis
```

Configure in `.env`:
```
REDIS_URL=redis://localhost:6379
```

The rate limiter at `/src/lib/rate-limit/redis.ts` will automatically use Redis when available.

---

### 2. Database Migration for Audit Logs
**Status**: Schema ready, migration needed  
**Effort**: Low  

Run the Prisma migration to create the AuditLog tables:
```bash
npx prisma migrate dev --name add_audit_log
```

This adds:
- `AuditLog` table for compliance tracking
- `DataRetentionPolicy` table for data lifecycle management

---

### 3. HIBP Password Check
**Status**: Not implemented  
**Effort**: Medium  

Integrate [Have I Been Pwned](https://haveibeenpwned.com/API/v3) API to check passwords against known breaches.

**Implementation location**: `/src/lib/security.ts` in `validatePassword()`

```typescript
// Uses k-anonymity - only sends first 5 chars of SHA-1
async function checkBreachedPassword(password: string): Promise<boolean> {
  const sha1 = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  
  const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`);
  const hashes = await response.text();
  return hashes.split('\n').some(line => line.startsWith(suffix));
}
```

---

### 4. Multi-Factor Authentication (MFA)
**Status**: Not implemented  
**Effort**: High  

Add TOTP-based MFA using libraries like `otplib`:
```bash
npm install otplib qrcode
```

**Required changes**:
- Add `mfaSecret` and `mfaEnabled` fields to User model
- Create MFA setup/verify endpoints
- Update login flow to check MFA

---

## Medium Priority

### 5. Session Binding (Device Fingerprinting)
**Status**: Not implemented  
**Effort**: Medium  

Bind sessions to device fingerprints to detect session hijacking.

**Implementation**:
- Generate fingerprint on client (browser, OS, screen resolution hash)
- Store with session in Redis
- Validate on each request
- Invalidate all sessions if fingerprint mismatch detected

---

### 6. PostgreSQL Row-Level Security (RLS)
**Status**: Not implemented  
**Effort**: High  

Add database-level tenant isolation as defense-in-depth.

```sql
-- Enable RLS on manuscripts table
ALTER TABLE manuscripts ENABLE ROW LEVEL SECURITY;

-- Policy for tenant isolation
CREATE POLICY tenant_isolation ON manuscripts
  USING (publisher_id = current_setting('app.current_publisher_id')::text);
```

**Note**: Requires careful integration with Prisma.

---

### 7. OpenTelemetry Distributed Tracing
**Status**: Not implemented  
**Effort**: Medium  

Add full distributed tracing:
```bash
npm install @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node
```

**Benefits**:
- Trace requests across services
- Identify performance bottlenecks
- Correlate logs with traces

---

### 8. GraphQL API (Optional)
**Status**: Not implemented  
**Effort**: High  

Add GraphQL alongside REST for more flexible queries:
```bash
npm install @apollo/server graphql
```

**Use cases**:
- Complex nested queries (manuscript with authors and affiliations)
- Partial field selection
- Real-time subscriptions

---

## Low Priority

### 9. Kubernetes Manifests
**Status**: Not implemented  
**Effort**: Medium  

Create Kubernetes deployment files:
```
k8s/
├── base/
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── configmap.yaml
│   └── hpa.yaml
├── overlays/
│   ├── staging/
│   └── production/
└── kustomization.yaml
```

---

### 10. Helm Charts
**Status**: Not implemented  
**Effort**: Medium  

Package Kubernetes manifests as Helm chart for easier deployment:
```
helm/
├── Chart.yaml
├── values.yaml
└── templates/
```

---

### 11. Infrastructure as Code (Terraform)
**Status**: Not implemented  
**Effort**: High  

Define cloud infrastructure:
```hcl
# AWS example
resource "aws_rds_cluster" "publimentor" {
  cluster_identifier = "publimentor-db"
  engine             = "aurora-postgresql"
  # ...
}
```

---

### 12. Load Testing
**Status**: Not implemented  
**Effort**: Medium  

Create performance benchmarks using k6 or Artillery:
```bash
npm install -D @artilleryio/artillery
```

**Test scenarios**:
- Manuscript upload under load
- Concurrent reviewer discovery
- API rate limit behavior

---

### 13. Event Sourcing
**Status**: Not implemented  
**Effort**: High  

For complex audit requirements, consider event sourcing:
- Store all state changes as events
- Rebuild state from event log
- Perfect audit trail

**Use case**: Manuscript lifecycle tracking

---

### 14. Webhook System
**Status**: Not implemented  
**Effort**: Medium  

Allow external systems to subscribe to events:
- Manuscript uploaded
- Review completed
- COI detected

---

### 15. API Versioning Strategy
**Status**: Partial (OpenAPI spec exists)  
**Effort**: Low  

Implement URL-based versioning:
```
/api/v1/manuscripts
/api/v2/manuscripts
```

---

## Completed Items

- [x] ADR Structure (2026-01-31)
- [x] AuditLog Model (2026-01-31)
- [x] Permission System RBAC (2026-01-31)
- [x] API Response Envelope (2026-01-31)
- [x] Request Correlation IDs (2026-01-31)
- [x] Health Endpoints (2026-01-31)
- [x] Structured Logging (2026-01-31)
- [x] Data Classification (2026-01-31)
- [x] OpenAPI Spec (2026-01-31)
- [x] Redis Rate Limiting (ready, needs npm install) (2026-01-31)
- [x] Domain Entities (2026-01-31)
- [x] Repository Pattern (2026-01-31)
- [x] Retention Policies (2026-01-31)
- [x] Prometheus Metrics (2026-01-31)
- [x] C4 Diagrams (2026-01-31)

---

## References

- [Enterprise Architecture Compliance Report](/docs/ARCHITECTURE-COMPLIANCE.md)
- [Architecture Decision Records](/docs/architecture/decisions/)
- [Security Documentation](/docs/SECURITY.md)
- [OpenAPI Specification](/docs/api/openapi.yaml)
