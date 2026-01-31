# Architecture Decision Records (ADRs)

This directory contains Architecture Decision Records for PubliMentor.

## What is an ADR?

An Architecture Decision Record captures an important architectural decision made along with its context and consequences. ADRs help:

- Document the "why" behind technical decisions
- Onboard new team members
- Avoid re-litigating past decisions
- Track when decisions become obsolete

## ADR Index

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [0001](0001-nextjs-app-router.md) | Next.js App Router as Primary Framework | Accepted | 2026-01-31 |
| [0002](0002-postgresql-prisma.md) | PostgreSQL with Prisma ORM | Accepted | 2026-01-31 |
| [0003](0003-multi-tenancy-model.md) | Multi-Tenancy Data Isolation Model | Accepted | 2026-01-31 |
| [0004](0004-authentication-strategy.md) | Authentication with NextAuth.js v5 | Accepted | 2026-01-31 |
| [0005](0005-llm-integration-strategy.md) | LLM Integration Strategy | Accepted | 2026-01-31 |
| [0006](0006-security-architecture.md) | Security Architecture and Controls | Accepted | 2026-01-31 |

## Creating a New ADR

1. Copy the template: `cp 0000-template.md XXXX-short-title.md`
2. Fill in all sections
3. Update this README with the new entry
4. Submit for review

## ADR Lifecycle

- **Proposed**: Under discussion
- **Accepted**: Decision made, implementation in progress or complete
- **Deprecated**: No longer applies but kept for historical context
- **Superseded**: Replaced by a newer ADR (link to successor)

## Guidelines

- One decision per ADR
- Be concise but complete
- Include alternatives considered
- Document consequences honestly (both positive and negative)
- Link to relevant code, issues, or external resources
