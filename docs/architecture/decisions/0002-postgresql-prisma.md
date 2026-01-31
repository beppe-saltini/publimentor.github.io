# ADR-0002: PostgreSQL with Prisma ORM

## Status
Accepted

## Date
2026-01-31

## Context
The application requires a robust database solution for:
- Storing manuscript metadata, authors, affiliations, references
- Multi-tenant data isolation (Publisher → Journal → Manuscript)
- Vector embeddings for RAG-based document search (pgvector)
- Complex relational queries (author co-authorship, citation networks)
- ACID compliance for financial/audit data

## Decision
We will use PostgreSQL as our primary database with Prisma as the ORM, enabling the pgvector extension for embeddings.

## Consequences

### Positive
- **pgvector support**: Native vector similarity search without external service
- **JSONB**: Flexible schema for metadata without sacrificing performance
- **Prisma type safety**: Generated TypeScript types from schema
- **Migration management**: Version-controlled database changes
- **Mature ecosystem**: Excellent tooling, monitoring, backup solutions
- **ACID compliance**: Data integrity for critical operations

### Negative
- **Vertical scaling limits**: Requires read replicas for extreme scale
- **Prisma limitations**: Some advanced PostgreSQL features need raw SQL
- **Connection pooling**: Serverless requires external pooler (PgBouncer)

### Risks
- **Lock-in**: Prisma-specific patterns may complicate future ORM changes; mitigated by repository pattern
- **N+1 queries**: Prisma's relation loading can be inefficient; mitigated by explicit includes

## Alternatives Considered

### Option A: MongoDB
- **Pros**: Flexible schema, horizontal scaling
- **Cons**: No native vector support, weaker consistency guarantees, harder relational queries

### Option B: PostgreSQL + Drizzle ORM
- **Pros**: Lighter weight, closer to SQL
- **Cons**: Less mature ecosystem, fewer integrations

### Option C: PostgreSQL + Pinecone (vectors)
- **Pros**: Optimized vector search, managed service
- **Cons**: Additional service cost, data synchronization complexity, vendor lock-in

## References
- [Prisma Documentation](https://www.prisma.io/docs)
- [pgvector GitHub](https://github.com/pgvector/pgvector)
- [PostgreSQL Extensions](https://www.postgresql.org/docs/current/contrib.html)
