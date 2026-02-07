# Contributing to Publimentor

Thank you for your interest in contributing to Publimentor! This document provides guidelines for contributing to the project.

## Development Setup

### Prerequisites

- Node.js 20.x (LTS)
- Docker & Docker Compose
- Git

### Getting Started

```bash
# Clone the repository
git clone <repository-url>
cd publimentor

# Start development environment
docker compose up -d

# Install dependencies
npm install

# Run database migrations
npx prisma db push

# Start the development server
npm run dev
```

## Development Workflow

### Branch Naming

- `feature/<description>` - New features
- `fix/<description>` - Bug fixes
- `refactor/<description>` - Code refactoring
- `docs/<description>` - Documentation changes
- `chore/<description>` - Maintenance tasks

### Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `ci`

### Pull Request Process

1. Create a feature branch from `develop`
2. Make your changes with appropriate tests
3. Ensure all tests pass: `npm test`
4. Ensure linting passes: `npm run lint`
5. Submit a PR with a clear description
6. Address review feedback
7. Merge after approval

## Code Standards

### TypeScript

- Strict mode is enabled - all code must be type-safe
- Use interfaces over type aliases where possible
- Avoid `any` - use `unknown` or proper generics instead

### Architecture

This project follows **Domain-Driven Design (DDD)**:

- `src/domain/` - Domain entities, value objects, repository interfaces
- `src/infrastructure/` - Repository implementations, external adapters
- `src/lib/` - Application services and utilities
- `src/app/api/` - API route handlers (thin layer)
- `src/app/(dashboard)/` - UI components and pages

### API Routes

- Use Zod schemas for all input validation
- Use the standardized response envelope (`src/lib/api/response.ts`)
- Always check authentication via `auth()`
- Log security-relevant operations via audit logger

### Security

- Never commit secrets, credentials, or API keys
- Validate all user input at the API boundary
- Use parameterized queries (Prisma handles this)
- Follow the OWASP guidelines

## Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run with coverage
npm run test:coverage
```

## Architecture Decisions

Major architecture decisions are documented as ADRs in `docs/architecture/decisions/`. When making significant changes, consider adding a new ADR.

## Questions?

Open a GitHub issue for questions, bug reports, or feature requests.
