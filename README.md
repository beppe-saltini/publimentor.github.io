# Publimentor

A modern web application for managing scientific editorial workflows. Publimentor helps journal editors find reviewers, detect conflicts of interest, and check paper formatting compliance.

## Features

- **Multi-tenant Journal Management**: Create and manage multiple journals with role-based access control (Admin, Editor, Reviewer)
- **Reviewer Finder**: Search for potential reviewers using OpenAlex academic database with filters for publications, citations, and h-index
- **Conflict of Interest Detection**: Automatically detect co-authorship history between paper authors and potential reviewers
- **Format Compliance Checking**: Verify that submissions meet journal formatting guidelines (word count, sections, references)
- **Submission Management**: Full workflow from submission to acceptance/rejection
- **Authentication**: Email/password and ORCID OAuth login

## Quick Start with Docker

The easiest way to run Publimentor is with Docker Compose.

### Prerequisites

- Docker and Docker Compose installed

### Running the Application

1. **Start the application:**

```bash
docker-compose up -d
```

This will:
- Start a PostgreSQL database
- Build and start the Next.js application
- Run database migrations automatically

2. **Open your browser:**

Navigate to [http://localhost:3000](http://localhost:3000)

3. **Create an account and start using Publimentor!**

### Stopping the Application

```bash
docker-compose down
```

To also remove the database data:

```bash
docker-compose down -v
```

### Production Deployment

For production, use the production Docker Compose file:

```bash
# Copy and customize environment variables
cp .env.docker .env

# Edit .env with your production settings
# - Set a strong NEXTAUTH_SECRET
# - Configure ORCID credentials if using OAuth
# - Set your production URL

# Start with production config
docker-compose -f docker-compose.prod.yml up -d
```

## Development Setup (Without Docker)

### Prerequisites

- Node.js 18+
- PostgreSQL database

### Installation

1. Install dependencies:

```bash
npm install
```

2. Set up environment variables:

```bash
cp .env.example .env
# Edit .env with your database URL and other settings
```

3. Set up the database:

```bash
npx prisma migrate dev
```

4. Start the development server:

```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000)

## Tech Stack

- **Framework**: Next.js 16 with App Router
- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: NextAuth.js v5 (Email + ORCID OAuth)
- **Styling**: Tailwind CSS + shadcn/ui
- **External APIs**: OpenAlex (academic database)
- **PDF Processing**: pdf-parse

## Project Structure

```
publimentor/
├── prisma/
│   └── schema.prisma          # Database schema
├── src/
│   ├── app/
│   │   ├── (auth)/            # Login & registration pages
│   │   ├── (dashboard)/       # Protected dashboard routes
│   │   │   └── dashboard/
│   │   │       ├── journals/[slug]/
│   │   │       │   ├── submissions/
│   │   │       │   ├── reviewers/
│   │   │       │   ├── coi/
│   │   │       │   ├── format/
│   │   │       │   └── settings/
│   │   └── api/               # API routes
│   ├── components/
│   │   ├── ui/                # shadcn/ui components
│   │   └── dashboard/         # Dashboard components
│   ├── lib/
│   │   ├── auth.ts            # NextAuth configuration
│   │   ├── prisma.ts          # Prisma client
│   │   ├── openalex.ts        # OpenAlex API client
│   │   ├── coi-detector.ts    # COI detection logic
│   │   ├── pdf-parser.ts      # PDF parsing utilities
│   │   └── format-checker.ts  # Format compliance checking
│   └── types/                 # TypeScript types
├── docker-compose.yml         # Development Docker setup
├── docker-compose.prod.yml    # Production Docker setup
├── Dockerfile                 # Production Docker image
└── Dockerfile.dev             # Development Docker image
```

## Usage Guide

### Creating a Journal

1. Sign up or log in
2. Click "Create Journal" from the dashboard
3. Enter journal name and URL slug
4. Invite team members (Editors, Reviewers)

### Managing Submissions

1. Navigate to your journal
2. Click "New Submission" to add a paper
3. Enter paper details and upload PDF
4. Add author information (names, ORCIDs)

### Finding Reviewers

1. Go to "Find Reviewers" in the journal menu
2. Search by research topic or keywords
3. Filter by publications, citations, h-index
4. View potential reviewers' expertise and topics

### Checking Conflicts of Interest

1. Go to "COI Check" in the journal menu
2. Enter paper author names and ORCIDs
3. Enter potential reviewer information
4. View co-authorship history report

### Format Compliance

1. Go to "Format Check" in the journal menu
2. Upload the PDF to check
3. View compliance report with issues
4. Address any errors or warnings

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `NEXTAUTH_SECRET` | Session encryption secret | Yes |
| `NEXTAUTH_URL` | Application URL | Yes |
| `ORCID_CLIENT_ID` | ORCID OAuth client ID | No |
| `ORCID_CLIENT_SECRET` | ORCID OAuth client secret | No |
| `OPENALEX_EMAIL` | Email for OpenAlex polite pool | No |

## License

MIT
