# ADR-0001: Next.js App Router as Primary Framework

## Status
Accepted

## Date
2026-01-31

## Context
PubliMentor requires a modern web framework for building a scientific editorial workflow application. The system needs to handle:
- Server-side rendering for SEO
- API routes for backend functionality
- Real-time features for collaborative editing
- Integration with multiple external APIs (PubMed, OpenAlex, Semantic Scholar)
- Authentication with OAuth providers (ORCID)

## Decision
We will use Next.js 15+ with the App Router as our primary framework.

## Consequences

### Positive
- **Full-stack capabilities**: Single codebase for frontend and backend
- **Server Components**: Reduced client-side JavaScript, better performance
- **Built-in API routes**: No need for separate backend server
- **TypeScript first**: Strong typing across the entire application
- **Large ecosystem**: Rich component libraries (shadcn/ui)
- **Vercel deployment**: Easy deployment and scaling options
- **Active development**: Regular updates and security patches

### Negative
- **Learning curve**: App Router differs from Pages Router
- **Vendor considerations**: Some features optimized for Vercel
- **Bundle size**: Framework overhead for simple pages

### Risks
- **Breaking changes**: App Router is still evolving; mitigated by pinning versions
- **Performance edge cases**: RSC hydration issues; mitigated by testing

## Alternatives Considered

### Option A: Remix
- **Pros**: Excellent data loading patterns, progressive enhancement
- **Cons**: Smaller ecosystem, less mature than Next.js

### Option B: SvelteKit
- **Pros**: Smaller bundle size, simpler reactivity model
- **Cons**: Smaller talent pool, fewer component libraries

### Option C: Separate Frontend/Backend
- **Pros**: More flexibility in technology choices
- **Cons**: Additional complexity, deployment overhead, API versioning challenges

## References
- [Next.js Documentation](https://nextjs.org/docs)
- [App Router Migration Guide](https://nextjs.org/docs/app/building-your-application/upgrading/app-router-migration)
