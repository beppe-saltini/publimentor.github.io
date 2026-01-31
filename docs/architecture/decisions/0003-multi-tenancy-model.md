# ADR-0003: Multi-Tenancy Data Isolation Model

## Status
Accepted

## Date
2026-01-31

## Context
PubliMentor serves multiple publishers, each with multiple journals. Data must be isolated to prevent cross-tenant access:
- Publishers should not see each other's data
- Journals within a publisher may share some data
- Individual users have specific permissions per manuscript

## Decision
We will implement row-level multi-tenancy with a Publisher → Journal → Manuscript hierarchy, using:
1. `publisherId` on all tenant-scoped tables
2. Explicit permission model for cross-tenant sharing
3. Query-level filtering (not database-level RLS initially)

## Consequences

### Positive
- **Simple implementation**: No complex database configuration
- **Flexible sharing**: Explicit permissions allow controlled cross-tenant access
- **Single database**: Lower operational complexity
- **Easy debugging**: All data in one place for support

### Negative
- **Query discipline required**: Must always filter by publisherId
- **Risk of data leakage**: Missing filter exposes cross-tenant data
- **No database-level enforcement**: Security relies on application logic

### Risks
- **Developer error**: Forgetting tenant filter in queries; mitigated by repository pattern with enforced filtering
- **Performance at scale**: Large tenant data in shared tables; mitigated by proper indexing and future partitioning

## Alternatives Considered

### Option A: Database per Tenant
- **Pros**: Complete isolation, easy compliance
- **Cons**: Operational complexity, higher costs, difficult cross-tenant features

### Option B: Schema per Tenant
- **Pros**: Good isolation, shared infrastructure
- **Cons**: Migration complexity, connection pooling challenges

### Option C: PostgreSQL Row-Level Security (RLS)
- **Pros**: Database-enforced isolation
- **Cons**: Complexity with Prisma, performance overhead, debugging difficulty

## Implementation Notes

```prisma
model Manuscript {
  publisherId String  // REQUIRED - tenant isolation
  journalId   String? // Optional journal assignment
  uploaderId  String  // User who uploaded
  
  @@index([publisherId])
  @@index([publisherId, journalId])
}
```

All queries MUST include `publisherId` filter:
```typescript
// Correct
prisma.manuscript.findMany({
  where: { publisherId: user.publisherId }
})

// WRONG - security vulnerability
prisma.manuscript.findMany({})
```

## References
- [Multi-tenant SaaS Patterns](https://docs.microsoft.com/en-us/azure/architecture/guide/multitenant/overview)
- [Prisma Multi-tenancy Guide](https://www.prisma.io/docs/guides/other/multi-tenancy)
