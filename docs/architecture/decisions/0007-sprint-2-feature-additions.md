# ADR-0007: Sprint 2 Feature Additions (DBLP, Integrity Report, Responsive UI, Onboarding)

## Status
Accepted

## Date
2026-02-06

## Context

Four new features have been commissioned for Sprint 2 to improve research integrity coverage, editorial UX, mobile accessibility, and new-user onboarding. Each introduces architectural considerations that require coordination across the application, infrastructure, security, and testing layers.

### Feature 2.1: One-Click Comprehensive Integrity Report
Editors currently must run tortured phrase detection, author identity verification, and reference validation as three separate operations on the integrity screening page. There is no unified report.

### Feature 2.4: DBLP Integration for COI Detection
The COI detection pipeline relies exclusively on OpenAlex for co-authorship data. For computer science-focused journals, DBLP is the gold standard bibliographic database with superior coverage. Inspired by the open-source [COI_checker](https://github.com/Hanchen-Wang/COI_checker) (MIT license).

### Feature 3.2: Responsive Mobile Layout
The dashboard sidebar is fixed at 264px and does not collapse on mobile screens. Editors increasingly need mobile access for triaging submissions on-the-go.

### Feature 3.4: First-Time User Onboarding
New users land on an empty dashboard with no guidance. There is no structured flow to help users create their first publisher organization, journal, and understand core features.

## Decision

### 2.1 Integrity Report Architecture
- **New API route**: `POST /api/integrity/full-report` that orchestrates all three integrity checks in parallel using `Promise.allSettled`
- **Fault-tolerant**: Each check runs independently; failures in one check do not block others
- **Rate-limited**: 5 requests/minute (expensive composite operation)
- **Response**: Unified `FullIntegrityReportResponse` type with overall risk assessment (clear/review/attention), per-check results, and metadata

### 2.4 DBLP Integration
- **New module**: `src/lib/dblp.ts` providing a TypeScript client for the DBLP Search API
- **Rate-limited client**: DBLP requests are throttled to 1 request/second (DBLP's fair-use policy)
- **Data source**: Used as a supplementary source alongside OpenAlex for COI co-authorship detection
- **API base**: Hardcoded to `https://dblp.org/search` (no SSRF risk)
- **No API key required**: DBLP is a free, open API

### 3.2 Responsive Layout
- **Component refactor**: Sidebar split into `SidebarContent`, `Sidebar` (desktop), and `MobileSidebar` (drawer)
- **New component**: `DashboardShell` orchestrates the responsive layout with state management for the mobile menu
- **Pattern**: Slide-over drawer with backdrop overlay on mobile; static sidebar on lg+ screens
- **Layout update**: Both the main dashboard layout and journal-scoped layout now use `DashboardShell`

### 3.4 Onboarding Flow
- **New route**: `/dashboard/onboarding` with server-side redirect from main dashboard for users with zero journals and zero publisher memberships
- **Guided steps**: Welcome > Create Organization > Create Journal > Done (with next-action shortcuts)
- **Non-blocking**: Users can skip onboarding at any time

## Consequences

### Positive
- Editors can generate a single comprehensive report per submission instead of three separate operations
- CS-focused journals get better COI coverage through DBLP's superior computer science bibliography
- Mobile editors can triage and manage submissions on phones/tablets
- New users have a clear path to a productive workspace, reducing time-to-value

### Negative
- Full integrity report is an expensive operation (3 parallel API calls); requires strict rate limiting
- DBLP's 1 req/s throttle adds latency compared to OpenAlex's more generous rate limits
- Mobile sidebar state is client-side; does not persist across page navigations (acceptable trade-off)
- Onboarding redirect adds a database query on every dashboard page load for users with no data

### Risks
- **DBLP API stability**: DBLP is an academic service without SLA. Mitigation: DBLP is supplementary, not primary; failures are gracefully handled
- **Integrity report timeouts**: External API calls (ORCID, Crossref, PubMed) may be slow. Mitigation: `Promise.allSettled` ensures partial results are returned
- **Mobile layout regressions**: Changed layout structure may affect existing journal pages. Mitigation: Both desktop and mobile paths tested

## Alternatives Considered

### Integrity Report: Server-Side PDF Generation
- **Pros**: Downloadable PDF report, more professional
- **Cons**: Requires additional dependency (puppeteer or react-pdf), significant complexity
- **Decision**: Deferred to Phase 2; text/JSON export is sufficient for MVP

### DBLP Integration: Full XML Parsing (like COI_checker)
- **Pros**: More complete data extraction
- **Cons**: XML parsing adds complexity; DBLP's JSON API is sufficient for co-authorship detection
- **Decision**: Use JSON API; migrate to XML if JSON proves insufficient

### Responsive Layout: shadcn/ui Sheet Component
- **Pros**: Consistent with existing UI component library
- **Cons**: Sheet requires additional dependency; custom drawer is simpler and more flexible
- **Decision**: Custom drawer implementation with identical UX

### Onboarding: Modal Wizard Instead of Separate Page
- **Pros**: Doesn't navigate away from dashboard
- **Cons**: Modals are worse on mobile; harder to deep-link or bookmark
- **Decision**: Dedicated page with stepper UI

## References
- [DBLP API Documentation](https://dblp.org/faq/How+to+use+the+dblp+search+API.html)
- [COI_checker (MIT)](https://github.com/Hanchen-Wang/COI_checker) - DBLP-based COI detection inspiration
- [Problematic Paper Screener](https://dbrech.irit.fr/pls/apex/f?p=9999:1) - Multi-detector integrity screening inspiration
- [Scholastica UX](https://scholasticahq.com/features/) - Editorial dashboard UX inspiration
- [ScholarOne 2025 Product Vision](https://www.silverchair.com/news/scholarone-product-vision/) - Research integrity workflow patterns
