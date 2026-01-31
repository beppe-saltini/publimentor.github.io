# PubliMentor System Architecture - C4 Model

This document describes the system architecture using the C4 model (Context, Containers, Components, Code).

## Level 1: System Context Diagram

The system context diagram shows PubliMentor and its interactions with users and external systems.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              SYSTEM CONTEXT                                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│    ┌──────────┐    ┌──────────┐    ┌──────────┐                                │
│    │ Editor   │    │ Reviewer │    │ Admin    │                                │
│    │          │    │          │    │          │                                │
│    └────┬─────┘    └────┬─────┘    └────┬─────┘                                │
│         │               │               │                                       │
│         │   Manages     │   Reviews     │   Configures                         │
│         │   manuscripts │   papers      │   system                             │
│         │               │               │                                       │
│         └───────────────┴───────┬───────┘                                       │
│                                 │                                               │
│                                 ▼                                               │
│                    ┌────────────────────────┐                                   │
│                    │                        │                                   │
│                    │      PubliMentor       │                                   │
│                    │                        │                                   │
│                    │   Scientific Editorial │                                   │
│                    │   Workflow Platform    │                                   │
│                    │                        │                                   │
│                    └───────────┬────────────┘                                   │
│                                │                                               │
│         ┌──────────────────────┼──────────────────────┐                        │
│         │                      │                      │                        │
│         ▼                      ▼                      ▼                        │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                      │
│  │   PubMed     │    │   OpenAlex   │    │   Claude     │                      │
│  │              │    │              │    │   (LLM)      │                      │
│  │ Publication  │    │ Academic     │    │ AI-powered   │                      │
│  │ database     │    │ metadata     │    │ analysis     │                      │
│  └──────────────┘    └──────────────┘    └──────────────┘                      │
│         │                      │                      │                        │
│         ▼                      ▼                      ▼                        │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                      │
│  │  Semantic    │    │    ORCID     │    │  Hugging     │                      │
│  │  Scholar     │    │              │    │  Face        │                      │
│  │              │    │ Researcher   │    │              │                      │
│  │ Citation     │    │ identity     │    │ Embeddings   │                      │
│  │ metrics      │    │              │    │              │                      │
│  └──────────────┘    └──────────────┘    └──────────────┘                      │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Level 2: Container Diagram

The container diagram shows the major technical building blocks.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              CONTAINER DIAGRAM                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                         PubliMentor System                               │   │
│  │                                                                          │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐          │   │
│  │  │                 │  │                 │  │                 │          │   │
│  │  │   Web Browser   │  │   Web Browser   │  │   Web Browser   │          │   │
│  │  │   (Editor)      │  │   (Reviewer)    │  │   (Admin)       │          │   │
│  │  │                 │  │                 │  │                 │          │   │
│  │  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘          │   │
│  │           │                    │                    │                    │   │
│  │           └────────────────────┴────────────────────┘                    │   │
│  │                                │                                         │   │
│  │                                │ HTTPS                                   │   │
│  │                                ▼                                         │   │
│  │           ┌────────────────────────────────────────────┐                │   │
│  │           │                                            │                │   │
│  │           │           Next.js Application              │                │   │
│  │           │                                            │                │   │
│  │           │  ┌──────────────┐  ┌──────────────┐       │                │   │
│  │           │  │  React UI    │  │  API Routes  │       │                │   │
│  │           │  │  Components  │  │              │       │                │   │
│  │           │  └──────────────┘  └──────────────┘       │                │   │
│  │           │                                            │                │   │
│  │           │  [Next.js 15, TypeScript, Tailwind CSS]   │                │   │
│  │           │                                            │                │   │
│  │           └────────────────────┬───────────────────────┘                │   │
│  │                                │                                         │   │
│  │              ┌─────────────────┼─────────────────┐                      │   │
│  │              │                 │                 │                      │   │
│  │              ▼                 ▼                 ▼                      │   │
│  │    ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐         │   │
│  │    │                 │ │                 │ │                 │         │   │
│  │    │   PostgreSQL    │ │   File Storage  │ │   Redis         │         │   │
│  │    │   + pgvector    │ │   (Local/S3)    │ │   (Optional)    │         │   │
│  │    │                 │ │                 │ │                 │         │   │
│  │    │ • User data     │ │ • Manuscripts   │ │ • Sessions      │         │   │
│  │    │ • Manuscripts   │ │ • PDF files     │ │ • Rate limits   │         │   │
│  │    │ • Embeddings    │ │ • Documents     │ │ • Cache         │         │   │
│  │    │ • Audit logs    │ │                 │ │                 │         │   │
│  │    │                 │ │                 │ │                 │         │   │
│  │    └─────────────────┘ └─────────────────┘ └─────────────────┘         │   │
│  │                                                                          │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│                                    │                                           │
│         ┌──────────────────────────┼──────────────────────────┐                │
│         │                          │                          │                │
│         ▼                          ▼                          ▼                │
│  ┌──────────────┐         ┌──────────────┐         ┌──────────────┐           │
│  │  PubMed API  │         │ OpenAlex API │         │ Claude API   │           │
│  └──────────────┘         └──────────────┘         └──────────────┘           │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Level 3: Component Diagram - Next.js Application

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         NEXT.JS APPLICATION COMPONENTS                          │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                          PRESENTATION LAYER                              │   │
│  │                                                                          │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────┐   │   │
│  │  │   Dashboard  │  │  Manuscript  │  │   Reviewer   │  │  Settings  │   │   │
│  │  │   Pages      │  │   Pages      │  │   Pages      │  │   Pages    │   │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  └────────────┘   │   │
│  │                                                                          │   │
│  │  ┌──────────────────────────────────────────────────────────────────┐   │   │
│  │  │                     API Routes (/api/*)                           │   │   │
│  │  │                                                                    │   │   │
│  │  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐     │   │   │
│  │  │  │  auth   │ │manuscrip│ │reviewers│ │   coi   │ │integrity│     │   │   │
│  │  │  │         │ │   ts    │ │         │ │         │ │         │     │   │   │
│  │  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘     │   │   │
│  │  │                                                                    │   │   │
│  │  └──────────────────────────────────────────────────────────────────┘   │   │
│  │                                                                          │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                         │                                       │
│                                         ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                          APPLICATION LAYER                               │   │
│  │                                                                          │   │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐       │   │
│  │  │ ManuscriptService│  │ ReviewerService  │  │   COI Service    │       │   │
│  │  │                  │  │                  │  │                  │       │   │
│  │  │ • Upload         │  │ • Discover       │  │ • Check          │       │   │
│  │  │ • Process        │  │ • Search         │  │ • Batch check    │       │   │
│  │  │ • Extract        │  │ • Enrich         │  │ • Report         │       │   │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────┘       │   │
│  │                                                                          │   │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐       │   │
│  │  │ IntegrityService │  │ PermissionService│  │   AuditService   │       │   │
│  │  │                  │  │                  │  │                  │       │   │
│  │  │ • Verify identity│  │ • Check access   │  │ • Log events     │       │   │
│  │  │ • Validate refs  │  │ • Grant/revoke   │  │ • Query logs     │       │   │
│  │  │ • Check phrases  │  │                  │  │                  │       │   │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────┘       │   │
│  │                                                                          │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                         │                                       │
│                                         ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                           DOMAIN LAYER                                   │   │
│  │                                                                          │   │
│  │  ┌─────────────────────────┐    ┌─────────────────────────┐             │   │
│  │  │      Entities           │    │     Value Objects       │             │   │
│  │  │                         │    │                         │             │   │
│  │  │ • Manuscript            │    │ • Email                 │             │   │
│  │  │ • Author                │    │ • ORCID                 │             │   │
│  │  │ • Reviewer              │    │ • DOI                   │             │   │
│  │  │ • Journal               │    │ • PMID                  │             │   │
│  │  │ • Publisher             │    │ • FileHash              │             │   │
│  │  └─────────────────────────┘    └─────────────────────────┘             │   │
│  │                                                                          │   │
│  │  ┌─────────────────────────┐    ┌─────────────────────────┐             │   │
│  │  │   Repository Interfaces │    │     Domain Events       │             │   │
│  │  │                         │    │                         │             │   │
│  │  │ • IManuscriptRepository │    │ • ManuscriptUploaded    │             │   │
│  │  │ • IUserRepository       │    │ • ProcessingCompleted   │             │   │
│  │  │ • IJournalRepository    │    │ • ReviewerAssigned      │             │   │
│  │  └─────────────────────────┘    └─────────────────────────┘             │   │
│  │                                                                          │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                         │                                       │
│                                         ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                        INFRASTRUCTURE LAYER                              │   │
│  │                                                                          │   │
│  │  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐               │   │
│  │  │    Prisma      │ │   Storage      │ │   External     │               │   │
│  │  │    Repos       │ │   Provider     │ │   API Clients  │               │   │
│  │  │                │ │                │ │                │               │   │
│  │  │ • Manuscript   │ │ • Local        │ │ • PubMed       │               │   │
│  │  │ • User         │ │ • S3           │ │ • OpenAlex     │               │   │
│  │  │ • AuditLog     │ │ • R2           │ │ • Semantic Sch │               │   │
│  │  └────────────────┘ └────────────────┘ │ • Claude       │               │   │
│  │                                        │ • HuggingFace  │               │   │
│  │  ┌────────────────┐ ┌────────────────┐ │ • ORCID        │               │   │
│  │  │    Security    │ │   Observability│ └────────────────┘               │   │
│  │  │                │ │                │                                   │   │
│  │  │ • Rate Limiter │ │ • Logger       │                                   │   │
│  │  │ • Auth         │ │ • Metrics      │                                   │   │
│  │  │ • Permissions  │ │ • Audit        │                                   │   │
│  │  └────────────────┘ └────────────────┘                                   │   │
│  │                                                                          │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Level 4: Code - Key Classes and Modules

### Domain Layer
| Module | Purpose |
|--------|---------|
| `domain/entities/manuscript.ts` | Manuscript aggregate root with business rules |
| `domain/value-objects/index.ts` | Immutable value types (Email, ORCID, DOI) |
| `domain/repositories/*` | Repository interfaces (contracts) |

### Application Layer
| Module | Purpose |
|--------|---------|
| `lib/manuscript/*` | Manuscript processing services |
| `lib/permissions/*` | RBAC permission system |
| `lib/audit/*` | Audit logging service |

### Infrastructure Layer
| Module | Purpose |
|--------|---------|
| `infrastructure/repositories/*` | Prisma repository implementations |
| `lib/pubmed.ts` | PubMed API client |
| `lib/openalex.ts` | OpenAlex API client |
| `lib/semantic-scholar.ts` | Semantic Scholar API client |
| `lib/storage.ts` | File storage abstraction |
| `lib/security.ts` | Security utilities |
| `lib/logger/*` | Structured logging |
| `lib/metrics/*` | Prometheus metrics |

## Data Flow Diagrams

### Manuscript Upload Flow

```
┌──────┐     ┌──────────┐     ┌──────────────┐     ┌──────────┐
│Editor│────>│Upload API│────>│Storage       │────>│PostgreSQL│
└──────┘     └────┬─────┘     │(Local/S3)    │     │          │
                  │           └──────────────┘     │ • Metadata│
                  │                                │ • Status  │
                  ▼                                └──────────┘
            ┌──────────┐                                 │
            │Processing│                                 │
            │Queue     │                                 │
            └────┬─────┘                                 │
                 │                                       │
                 ▼                                       ▼
            ┌──────────┐     ┌──────────┐     ┌──────────┐
            │Text      │────>│Metadata  │────>│Embedding │
            │Extraction│     │Extraction│     │Generation│
            │(pdf-parse│     │(Claude)  │     │(HuggingF)│
            └──────────┘     └──────────┘     └────┬─────┘
                                                    │
                                                    ▼
                                              ┌──────────┐
                                              │pgvector  │
                                              │(vectors) │
                                              └──────────┘
```

### Reviewer Discovery Flow

```
┌──────┐     ┌──────────┐     ┌──────────┐
│Editor│────>│Discover  │────>│Claude LLM│
└──────┘     │API       │     │          │
             └────┬─────┘     │Suggest   │
                  │           │Experts   │
                  │           └────┬─────┘
                  │                │
                  │◄───────────────┘
                  │
                  ▼
            ┌──────────┐
            │Verify    │
            │& Enrich  │
            └────┬─────┘
                 │
      ┌──────────┼──────────┐
      │          │          │
      ▼          ▼          ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│ PubMed   │ │ OpenAlex │ │ Semantic │
│          │ │          │ │ Scholar  │
│ Validate │ │ H-Index  │ │ H-Index  │
│ Author   │ │ Affil.   │ │ Citations│
└────┬─────┘ └────┬─────┘ └────┬─────┘
     │            │            │
     └────────────┴────────────┘
                  │
                  ▼
            ┌──────────┐
            │Merged    │
            │Results   │
            │(Editor)  │
            └──────────┘
```

## Deployment Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        DEPLOYMENT DIAGRAM                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      Docker Compose / Kubernetes                 │   │
│  │                                                                  │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │   │
│  │  │                 │  │                 │  │                 │  │   │
│  │  │   Next.js App   │  │   PostgreSQL    │  │     Redis       │  │   │
│  │  │   Container     │  │   Container     │  │   Container     │  │   │
│  │  │                 │  │                 │  │   (Optional)    │  │   │
│  │  │   Port: 3000    │  │   Port: 5432    │  │   Port: 6379    │  │   │
│  │  │                 │  │                 │  │                 │  │   │
│  │  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  │   │
│  │           │                    │                    │            │   │
│  │           └────────────────────┴────────────────────┘            │   │
│  │                                │                                 │   │
│  │                    Docker Network (internal)                     │   │
│  │                                                                  │   │
│  │  ┌─────────────────────────────────────────────────────────┐    │   │
│  │  │                     Volume Mounts                        │    │   │
│  │  │                                                          │    │   │
│  │  │  /uploads     → Manuscript files                         │    │   │
│  │  │  /postgres    → Database data                            │    │   │
│  │  │  /redis       → Redis persistence                        │    │   │
│  │  │                                                          │    │   │
│  │  └─────────────────────────────────────────────────────────┘    │   │
│  │                                                                  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Environment Variables:                                                 │
│  • DATABASE_URL                                                         │
│  • NEXTAUTH_SECRET                                                      │
│  • ANTHROPIC_API_KEY                                                    │
│  • HUGGINGFACE_API_KEY                                                  │
│  • ORCID_CLIENT_ID / SECRET                                            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Security Boundaries

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         SECURITY BOUNDARIES                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    INTERNET (Untrusted)                          │   │
│  │                                                                  │   │
│  │  ┌──────────────────────────────────────────────────────────┐   │   │
│  │  │                    LOAD BALANCER                          │   │   │
│  │  │                    • TLS Termination                      │   │   │
│  │  │                    • DDoS Protection                      │   │   │
│  │  │                    • WAF Rules                            │   │   │
│  │  └────────────────────────────┬─────────────────────────────┘   │   │
│  │                               │                                  │   │
│  └───────────────────────────────┼──────────────────────────────────┘   │
│                                  │                                      │
│  ┌───────────────────────────────┼──────────────────────────────────┐   │
│  │                    DMZ (Semi-trusted)                             │   │
│  │                               │                                   │   │
│  │  ┌────────────────────────────▼────────────────────────────────┐ │   │
│  │  │                    API GATEWAY                               │ │   │
│  │  │                    • Rate Limiting                           │ │   │
│  │  │                    • Authentication                          │ │   │
│  │  │                    • Request Validation                      │ │   │
│  │  │                    • Security Headers                        │ │   │
│  │  └────────────────────────────┬────────────────────────────────┘ │   │
│  │                               │                                   │   │
│  └───────────────────────────────┼───────────────────────────────────┘   │
│                                  │                                      │
│  ┌───────────────────────────────┼──────────────────────────────────┐   │
│  │                    APPLICATION ZONE (Trusted)                     │   │
│  │                               │                                   │   │
│  │  ┌────────────────────────────▼────────────────────────────────┐ │   │
│  │  │                    NEXT.JS APPLICATION                       │ │   │
│  │  │                    • Authorization (RBAC)                    │ │   │
│  │  │                    • Input Sanitization                      │ │   │
│  │  │                    • Audit Logging                           │ │   │
│  │  └────────────────────────────┬────────────────────────────────┘ │   │
│  │                               │                                   │   │
│  └───────────────────────────────┼───────────────────────────────────┘   │
│                                  │                                      │
│  ┌───────────────────────────────┼──────────────────────────────────┐   │
│  │                    DATA ZONE (Restricted)                         │   │
│  │                               │                                   │   │
│  │       ┌───────────────────────┴───────────────────────┐          │   │
│  │       │                                               │          │   │
│  │       ▼                                               ▼          │   │
│  │  ┌──────────────┐                           ┌──────────────┐    │   │
│  │  │  PostgreSQL  │                           │ File Storage │    │   │
│  │  │              │                           │              │    │   │
│  │  │ • Encrypted  │                           │ • Encrypted  │    │   │
│  │  │ • No public  │                           │ • Access     │    │   │
│  │  │   access     │                           │   controlled │    │   │
│  │  └──────────────┘                           └──────────────┘    │   │
│  │                                                                   │   │
│  └───────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## References

- [C4 Model](https://c4model.com/)
- [ADR-0001: Next.js App Router](decisions/0001-nextjs-app-router.md)
- [ADR-0002: PostgreSQL with Prisma](decisions/0002-postgresql-prisma.md)
- [ADR-0003: Multi-Tenancy Model](decisions/0003-multi-tenancy-model.md)
- [ADR-0006: Security Architecture](decisions/0006-security-architecture.md)
