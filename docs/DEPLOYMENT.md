# PubliMentor Production Deployment Guide

## Overview

PubliMentor is a Next.js 16 application with the following infrastructure requirements:

| Component | Requirement | Notes |
|-----------|------------|-------|
| **Runtime** | Node.js 20+ | Next.js 16 with App Router |
| **Database** | PostgreSQL 16+ | Requires `pgvector` extension |
| **File Storage** | Cloud storage | S3, R2, or Supabase Storage |
| **Authentication** | NextAuth.js v5 | Credentials + ORCID OAuth |
| **External APIs** | Anthropic, OpenAlex, PubMed, HuggingFace | API keys required |

---

## Deployment Options Comparison

| Option | Complexity | Cost (Starting) | Best For |
|--------|------------|-----------------|----------|
| **Vercel + Supabase** | Low | Free tier | Quick launch, scaling |
| **Railway** | Low | ~$5/mo | All-in-one simplicity |
| **Docker on VPS** | Medium | ~$20/mo | Full control |
| **AWS (ECS/RDS)** | High | ~$50/mo | Enterprise, compliance |

---

## Recommended: Vercel + Supabase

This combination provides the best developer experience with native Next.js support and PostgreSQL with pgvector.

### Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│                 │     │                 │     │                 │
│   Cloudflare    │────▶│     Vercel      │────▶│    Supabase     │
│   (DNS/CDN)     │     │   (Next.js)     │     │  (PostgreSQL)   │
│                 │     │                 │     │                 │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │  Supabase       │
                        │  Storage (S3)   │
                        └─────────────────┘
```

---

## Phase 1: Database Setup (Supabase)

### 1.1 Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign up
2. Click "New Project"
3. Choose:
   - **Name**: `publimentor-prod`
   - **Region**: Choose closest to your users (e.g., `eu-west-1` for Europe)
   - **Database Password**: Generate a strong password (save it!)

4. Wait for project to initialize (~2 minutes)

### 1.2 Enable pgvector Extension

1. Go to **Database** → **Extensions**
2. Search for `vector`
3. Enable the `vector` extension

### 1.3 Get Connection Strings

Go to **Settings** → **Database** and copy:

```bash
# Connection pooler (for app - use this as DATABASE_URL)
postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true

# Direct connection (for migrations - use this as DIRECT_URL)
postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres
```

### 1.4 Configure Prisma for Supabase

Update your `prisma/schema.prisma`:

```prisma
datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  directUrl  = env("DIRECT_URL")
  extensions = [vector]
}
```

### 1.5 Run Migrations

```bash
# Set environment variables
export DATABASE_URL="your-pooler-connection-string"
export DIRECT_URL="your-direct-connection-string"

# Run migrations
npx prisma migrate deploy

# (Optional) Seed initial data
npx prisma db seed
```

---

## Phase 2: File Storage Setup

### Option A: Supabase Storage (Simplest)

1. Go to **Storage** in Supabase dashboard
2. Create a bucket called `manuscripts`
3. Set bucket to **private** (authenticated access only)
4. Get your storage URL from **Settings** → **API**

Update your storage configuration:
```env
STORAGE_PROVIDER=supabase
SUPABASE_URL=https://[project-ref].supabase.co
SUPABASE_SERVICE_KEY=eyJ...  # From Settings → API → service_role key
```

### Option B: Cloudflare R2 (Cost-effective)

1. Go to Cloudflare dashboard → R2
2. Create a bucket called `publimentor-manuscripts`
3. Create an API token with read/write access

```env
STORAGE_PROVIDER=s3
S3_BUCKET=publimentor-manuscripts
S3_ACCESS_KEY=your-r2-access-key
S3_SECRET_KEY=your-r2-secret-key
S3_ENDPOINT=https://[account-id].r2.cloudflarestorage.com
S3_REGION=auto
```

---

## Phase 3: External API Keys

### 3.1 Anthropic (Claude AI)

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create an API key
3. Set spending limits appropriate for your usage

```env
ANTHROPIC_API_KEY=sk-ant-...
```

### 3.2 ORCID OAuth (Optional)

1. Go to [orcid.org/developer-tools](https://orcid.org/developer-tools)
2. Register your application
3. Set redirect URI: `https://app.publimentor.com/api/auth/callback/orcid`

```env
ORCID_CLIENT_ID=APP-XXXXXXXX
ORCID_CLIENT_SECRET=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

### 3.3 OpenAlex (Optional - for higher rate limits)

```env
OPENALEX_EMAIL=your-email@domain.com
```

---

## Phase 4: Vercel Deployment

### 4.1 Connect Repository

1. Go to [vercel.com](https://vercel.com) and sign in with GitHub
2. Click "Import Project"
3. Select your `publimentor` repository
4. Choose the `app` branch

### 4.2 Configure Build Settings

| Setting | Value |
|---------|-------|
| Framework Preset | Next.js |
| Build Command | `prisma generate && next build` |
| Output Directory | `.next` |
| Install Command | `npm ci` |
| Root Directory | `./` |

### 4.3 Add Environment Variables

In Vercel project settings → Environment Variables, add:

```bash
# Required
DATABASE_URL=postgresql://postgres.[ref]:[pass]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://postgres.[ref]:[pass]@aws-0-[region].pooler.supabase.com:5432/postgres
NEXTAUTH_SECRET=<generate-with: openssl rand -base64 32>
NEXTAUTH_URL=https://app.publimentor.com
AUTH_TRUST_HOST=true

# External APIs
ANTHROPIC_API_KEY=sk-ant-...

# Storage (choose one)
STORAGE_PROVIDER=supabase
SUPABASE_URL=https://[ref].supabase.co
SUPABASE_SERVICE_KEY=eyJ...

# Optional
ORCID_CLIENT_ID=APP-...
ORCID_CLIENT_SECRET=...
OPENALEX_EMAIL=...
```

### 4.4 Deploy

Click "Deploy" and wait for the build to complete.

---

## Phase 5: Custom Domain Setup

### 5.1 Add Domain in Vercel

1. Go to your project → **Settings** → **Domains**
2. Add: `app.publimentor.com`
3. Vercel will show you DNS records to add

### 5.2 Configure DNS

Add these DNS records at your domain registrar:

| Type | Name | Value |
|------|------|-------|
| CNAME | app | cname.vercel-dns.com |

Or if using Cloudflare:

| Type | Name | Value | Proxy |
|------|------|-------|-------|
| CNAME | app | cname.vercel-dns.com | DNS only (gray cloud) |

### 5.3 Verify SSL

Vercel automatically provisions SSL certificates. Verify at:
- https://app.publimentor.com

---

## Phase 6: Database Migrations

After deployment, run migrations:

```bash
# Option 1: Local (recommended for first deploy)
export DATABASE_URL="your-direct-connection-string"
npx prisma migrate deploy

# Option 2: Via Vercel CLI
vercel env pull .env.local
npx prisma migrate deploy
```

---

## Phase 7: Post-Deployment Verification

### 7.1 Health Checks

Verify these endpoints return 200:

```bash
curl https://app.publimentor.com/api/health
curl https://app.publimentor.com/api/health/ready
curl https://app.publimentor.com/api/health/live
```

### 7.2 Authentication Test

1. Navigate to https://app.publimentor.com/login
2. Create a test account
3. Verify login works

### 7.3 Upload Test

1. Log in as a publisher admin
2. Try uploading a test PDF
3. Verify processing completes

---

## Phase 8: Monitoring Setup

### 8.1 Vercel Analytics (Built-in)

1. Go to project → **Analytics**
2. Enable Web Vitals

### 8.2 Error Tracking (Sentry - Recommended)

```bash
npm install @sentry/nextjs
npx @sentry/wizard@latest -i nextjs
```

Add to environment:
```env
SENTRY_DSN=https://...@sentry.io/...
```

### 8.3 Uptime Monitoring

Set up external monitoring (e.g., UptimeRobot, Better Stack):
- Monitor: `https://app.publimentor.com/api/health`
- Alert threshold: 5 minutes

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection (pooled) |
| `DIRECT_URL` | Yes | PostgreSQL connection (direct, for migrations) |
| `NEXTAUTH_SECRET` | Yes | 32+ character random string |
| `NEXTAUTH_URL` | Yes | Full URL of your app |
| `AUTH_TRUST_HOST` | Yes | Set to `true` for Vercel |
| `ANTHROPIC_API_KEY` | For AI features | Claude API key |
| `ORCID_CLIENT_ID` | For ORCID login | ORCID OAuth client ID |
| `ORCID_CLIENT_SECRET` | For ORCID login | ORCID OAuth secret |
| `STORAGE_PROVIDER` | For file uploads | `local`, `s3`, or `supabase` |
| `S3_BUCKET` | If using S3/R2 | Bucket name |
| `S3_ACCESS_KEY` | If using S3/R2 | Access key |
| `S3_SECRET_KEY` | If using S3/R2 | Secret key |
| `S3_ENDPOINT` | If using R2 | Cloudflare R2 endpoint |
| `SUPABASE_URL` | If using Supabase storage | Project URL |
| `SUPABASE_SERVICE_KEY` | If using Supabase storage | Service role key |
| `OPENALEX_EMAIL` | Optional | For higher API rate limits |

---

## Security Checklist

Before going live, verify:

- [ ] All secrets are in environment variables (not in code)
- [ ] `NEXTAUTH_SECRET` is a unique, random 32+ character string
- [ ] Database password is strong (20+ characters)
- [ ] API keys have appropriate spending limits
- [ ] File storage bucket is private (not public)
- [ ] Rate limiting is working (test with rapid requests)
- [ ] HTTPS is enforced (check redirect)
- [ ] Security headers are present (check at securityheaders.com)
- [ ] CORS is configured correctly (if using external clients)

---

## Troubleshooting

### Build Fails: Prisma Generate

Ensure build command includes Prisma:
```
prisma generate && next build
```

### Database Connection Timeout

Use connection pooler URL for `DATABASE_URL` (port 6543), not direct connection.

### pgvector Extension Missing

Run in Supabase SQL Editor:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### File Uploads Fail

1. Check storage provider configuration
2. Verify bucket exists and is accessible
3. Check API key permissions

### Authentication Redirect Issues

Ensure `NEXTAUTH_URL` exactly matches your domain including protocol:
```
NEXTAUTH_URL=https://app.publimentor.com
```

---

## Scaling Considerations

### Database

- Supabase Pro: 8GB RAM, 100GB storage
- Consider read replicas for heavy read loads
- Enable connection pooling (PgBouncer)

### Application

- Vercel auto-scales serverless functions
- Consider edge functions for latency-sensitive routes
- Use ISR for semi-static pages

### Storage

- Use CDN for frequently accessed files
- Consider multi-region replication for global users

---

## Cost Estimation

### Startup (Free Tier)

| Service | Free Tier |
|---------|-----------|
| Vercel | 100GB bandwidth, serverless |
| Supabase | 500MB DB, 1GB storage, 2GB bandwidth |
| Cloudflare R2 | 10GB storage, 10M operations |
| **Total** | **$0/month** |

### Growth (~1000 users)

| Service | Plan | Cost |
|---------|------|------|
| Vercel Pro | $20/seat | $20/mo |
| Supabase Pro | 8GB, 100GB | $25/mo |
| R2 | 50GB storage | ~$1/mo |
| Anthropic | ~10K API calls | ~$10/mo |
| **Total** | | **~$56/month** |

### Production (~10,000 users)

| Service | Plan | Cost |
|---------|------|------|
| Vercel Enterprise | Custom | $500+/mo |
| Supabase Team | 16GB, 500GB | $599/mo |
| R2 | 500GB storage | ~$10/mo |
| Anthropic | ~100K API calls | ~$100/mo |
| **Total** | | **~$1,200/month** |

---

## Next Steps

After deployment:

1. **Set up CI/CD** - Automatic deployments on push to `app` branch
2. **Configure backups** - Enable point-in-time recovery in Supabase
3. **Set up staging** - Create a staging environment for testing
4. **Add monitoring** - Sentry for errors, custom dashboards
5. **Document runbooks** - Incident response procedures
6. **Plan for Redis** - For distributed rate limiting (Upstash recommended)

---

## Support

- **Vercel Docs**: https://vercel.com/docs
- **Supabase Docs**: https://supabase.com/docs
- **Next.js Docs**: https://nextjs.org/docs
- **Prisma Docs**: https://www.prisma.io/docs
