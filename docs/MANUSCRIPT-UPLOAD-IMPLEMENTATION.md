# Manuscript Upload Feature - Implementation Plan

## Overview

A complete document ingestion pipeline with LLM-powered metadata extraction and RAG capabilities.

## Architecture Decisions

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Vector DB | pgvector | Same PostgreSQL instance, simpler |
| Embeddings | Sentence Transformers | Open source, free, self-hostable |
| File Storage | Local → S3/R2 | Abstraction layer for migration |
| Processing | Async (background jobs) | Non-blocking UI |
| Chat LLM | Discarded | RAG for search only |
| LaTeX | Phase 2 | PDF/DOCX priority |

## Multi-Tenancy Model

```
Publisher (Organization)
    └── Journal(s)
            └── User(s) with roles
                    └── Manuscript(s)
```

### Data Isolation Rules

1. **Publisher Level**: Complete isolation between publishers
2. **Journal Level**: Isolation within publisher
3. **User Level**: User sees only own manuscripts unless shared
4. **Explicit Sharing**: Via ManuscriptPermission table

## Files Created

### Database Schema
- `prisma/schema-manuscript-additions.prisma` - New tables to add

### Storage Abstraction
- `src/lib/storage/index.ts` - Storage interface
- `src/lib/storage/local.ts` - Local filesystem provider
- `src/lib/storage/s3.ts` - AWS S3 provider (ready for migration)
- `src/lib/storage/r2.ts` - Cloudflare R2 provider (ready for migration)

### Manuscript Processing
- `src/lib/manuscript/index.ts` - Module exports
- `src/lib/manuscript/text-extractor.ts` - PDF/DOCX text extraction
- `src/lib/manuscript/metadata-extractor.ts` - LLM metadata extraction
- `src/lib/manuscript/embeddings.ts` - Sentence Transformers embeddings
- `src/lib/manuscript/processor.ts` - Processing orchestrator

## Implementation Phases

### Phase 1: Core Upload (Current Priority)

- [ ] Merge schema additions into `schema.prisma`
- [ ] Add Publisher model and link to Journal
- [ ] Create `uploads/` directory with `.gitkeep`
- [ ] Add mammoth dependency: `npm install mammoth`
- [ ] Create upload API endpoint
- [ ] Create processing status API
- [ ] Create upload UI component
- [ ] Test PDF upload and extraction
- [ ] Test DOCX upload and extraction

### Phase 2: Database Integration

- [ ] Install pgvector extension in PostgreSQL
- [ ] Add Prisma migrations for new tables
- [ ] Implement manuscript storage in processor
- [ ] Implement chunk storage with embeddings
- [ ] Create manuscript list API
- [ ] Create manuscript detail API
- [ ] Create metadata edit API

### Phase 3: RAG Search

- [ ] Implement semantic search over chunks
- [ ] Create search API endpoint
- [ ] Create search UI
- [ ] Add filtering by publisher/journal/user

### Phase 4: Advanced Features

- [ ] LaTeX support
- [ ] Version control for revisions
- [ ] Duplicate detection via hash
- [ ] Reference validation
- [ ] ORCID verification
- [ ] Integration with COI/reviewer features

## Database Changes Required

### 1. Add Publisher Model

Add to existing `schema.prisma`:

```prisma
model Publisher {
  id          String   @id @default(cuid())
  name        String
  slug        String   @unique
  logoUrl     String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  journals    Journal[]
  members     PublisherMember[]
}

model PublisherMember {
  id          String        @id @default(cuid())
  role        PublisherRole @default(MEMBER)
  createdAt   DateTime      @default(now())
  
  userId      String
  publisherId String
  user        User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  publisher   Publisher     @relation(fields: [publisherId], references: [id], onDelete: Cascade)
  
  @@unique([userId, publisherId])
}

enum PublisherRole {
  OWNER
  ADMIN
  MEMBER
}
```

### 2. Link Journal to Publisher

Update Journal model:

```prisma
model Journal {
  // ... existing fields ...
  
  publisherId String
  publisher   Publisher @relation(fields: [publisherId], references: [id])
  
  manuscripts Manuscript[]
}
```

### 3. Add Manuscript Tables

Add all models from `schema-manuscript-additions.prisma`

### 4. Update User Model

Add relations:

```prisma
model User {
  // ... existing fields ...
  
  uploadedManuscripts    Manuscript[]           @relation("UploadedManuscripts")
  manuscriptPermissions  ManuscriptPermission[] @relation("ManuscriptPermissions")
  grantedPermissions     ManuscriptPermission[] @relation("GrantedPermissions")
  publisherMemberships   PublisherMember[]
}
```

## pgvector Setup

1. Enable extension in PostgreSQL:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

2. Add to Prisma schema (already in additions file):
```prisma
embedding Unsupported("vector(384)")?
```

3. Create index for similarity search:
```sql
CREATE INDEX ON document_chunks 
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);
```

## Environment Variables

Add to `.env`:

```env
# Storage
STORAGE_PROVIDER=local
LOCAL_STORAGE_PATH=./uploads

# For S3 migration (future)
# STORAGE_PROVIDER=s3
# AWS_REGION=us-east-1
# AWS_ACCESS_KEY_ID=
# AWS_SECRET_ACCESS_KEY=
# S3_BUCKET_NAME=

# For R2 migration (future)
# STORAGE_PROVIDER=r2
# R2_ACCOUNT_ID=
# R2_ACCESS_KEY_ID=
# R2_SECRET_ACCESS_KEY=
# R2_BUCKET_NAME=

# Embeddings (optional, for rate limit increase)
HF_API_TOKEN=
EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2
```

## API Endpoints (To Create)

```
POST   /api/manuscripts/upload
GET    /api/manuscripts/:id
GET    /api/manuscripts/:id/status
PUT    /api/manuscripts/:id/metadata
DELETE /api/manuscripts/:id
GET    /api/manuscripts
POST   /api/manuscripts/search
```

## Dependencies to Add

```bash
npm install mammoth    # DOCX extraction
# pdf-parse is already installed
```

## Testing Checklist

- [ ] Upload PDF and verify text extraction
- [ ] Upload DOCX and verify text extraction
- [ ] Verify LLM extracts title, authors, abstract
- [ ] Verify affiliations are parsed correctly
- [ ] Verify references are extracted
- [ ] Verify embeddings are generated
- [ ] Verify multi-tenant isolation
- [ ] Verify file storage works
- [ ] Verify processing status updates

## Security Considerations

1. **File Validation**: Check MIME type, file extension, file size
2. **Malware Scan**: Consider ClamAV integration (future)
3. **Access Control**: Check publisher/journal membership
4. **Audit Logging**: Log all access and changes
5. **Encryption**: Files at rest (future)
