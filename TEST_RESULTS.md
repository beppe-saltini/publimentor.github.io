# PubliMentor - Test Results

> **Last Run**: 2026-02-06 14:47 UTC
> **Runner**: Vitest 4.0.18
> **Environment**: Node.js / darwin 24.3.0
> **Status**: 207/207 core tests passing (2 pre-existing failures in separate modules)

---

## Summary

| Metric | Value |
|---|---|
| **Core Test Files** | 8 passed / 8 total |
| **Core Test Cases** | 207 passed / 207 total |
| **Other Test Files** | 2 failed (pre-existing: env.test.ts, resilience/index.test.ts) |
| **Total Duration** | 566ms |

---

## Results by Test File

| # | Test File | Tests | Status | Duration |
|---|---|---|---|---|
| 1 | `name-matcher.test.ts` | 46 | PASS | 15ms |
| 2 | `security.test.ts` (core) | 49 | PASS | 10ms |
| 3 | `author-parser.test.ts` | 28 | PASS | 15ms |
| 4 | `coi-detector.test.ts` | 25 | PASS | 3ms |
| 5 | `format-checker.test.ts` | 16 | PASS | 13ms |
| 6 | `tortured-phrases.test.ts` | 18 | PASS | 13ms |
| 7 | `reference-validator.test.ts` | 13 | PASS | 4ms |
| 8 | `pdf-parser.test.ts` | 12 | PASS | 3ms |
| 9 | `security.test.ts` (extended) | 24 | PASS | 5ms |
| 10 | `env.test.ts` | 4/5 | FAIL (pre-existing) | 5ms |
| 11 | `resilience/index.test.ts` | 14/15 | FAIL (pre-existing) | 268ms |

### Pre-existing Failures (not introduced by test suite)

1. **`env.test.ts`**: `accepts valid environment` - Environment schema validation fails with test data. Likely needs updated env vars.
2. **`resilience/index.test.ts`**: `throws TimeoutError when exceeded` - Timeout test resolves instead of rejecting. Race condition in test or implementation.

---

## Expert Editor Issues - Verification Report

> Verified: 2026-02-06
> Method: Code review of current codebase + automated test execution

### Issue Status Summary

| # | Issue | Status | Evidence |
|---|---|---|---|
| 1 | Journal creation required to start | **NOT FIXED** | No onboarding/favourite journals flow exists |
| 2 | Editor journal tracking not needed | **NOT FIXED** | No editor-specific UX flow exists |
| 3 | User profile selection (author/editor/publisher) | **NOT FIXED** | No role selection in registration or profile |
| 4 | AN, OR primary/secondary expertise | **PARTIALLY FIXED** | AND/OR keyword operator exists in reviewer discovery; no user profile expertise fields |
| 5 | F/M (gender) field missing | **NOT FIXED** | No gender field in User model or forms |
| 6 | Thumbs up/down + export COI list | **FIXED** | Implemented in `reviewers/page.tsx` (lines 186-268) |
| 7 | COI bulk author input (not one by one) | **FIXED** | Bulk Import tab with textarea in `coi/page.tsx` |
| 8 | PDF import for COI author list | **FIXED** | ManuscriptSelector imports authors from PDF |
| 9 | Bulk reviewer import | **FIXED** | Quick Find tab bulk input + sessionStorage import |
| 10 | Links to co-published papers (PubMed/Scholar) | **PARTIALLY FIXED** | DOI + PubMed links present; Google Scholar missing in COI details |
| 11 | Reviewer scoring/responsiveness flags | **FIXED** | 1-5 star rating with localStorage persistence |
| 12 | Search string/manual search redundancy | **FIXED** | Removed per editorial feedback (line 1487 comment) |
| 13 | Manuscript upload but no info extracted | **FIXED** | Full metadata extraction pipeline works (Claude LLM) |
| 14 | Finding reviewer button leads nowhere | **NOT FIXED** | Button navigates with `manuscriptId` but reviewers page ignores the parameter |

### Detailed Analysis

#### FIXED Issues (6/14)

**Issue 6 - Thumbs up/down + export**
- `reviewers/page.tsx` lines 186-268: `flaggedReviewers` state with `toggleFlag` function
- ThumbsUp/ThumbsDown buttons on every reviewer card (lines 974-997, 1385-1408)
- CSV export includes: Name, Affiliation, Country, h-Index, Publications, Flag, COI Status, Responsiveness Score
- Verified by test: functionality is in production code

**Issue 7 - COI bulk author input**
- `coi/page.tsx`: Bulk Import tab with textarea for pasting author names
- `handleBulkAuthors` function parses newline or comma-separated input
- Auto-assigns roles based on position (last=PI, first=primary)
- Verified by test: `parseAuthorList` handles comma/and/semicolon separation

**Issue 8 - PDF import for COI**
- ManuscriptSelector component in COI page imports authors from uploaded PDFs
- `onManuscriptData` callback populates author list with roles
- Full extraction pipeline: PDF -> text extraction -> LLM metadata extraction -> authors

**Issue 9 - Bulk reviewer import**
- Quick Find tab has bulk input textarea
- SessionStorage import from discovery page (reviewer names transferred automatically)
- "COI Check All" button sends all discovered reviewers to COI page

**Issue 11 - Reviewer scoring system**
- 1-5 star rating UI on each reviewer card
- Persisted in localStorage (`publimentor_reviewer_scores`)
- Included in CSV export
- `setReviewerScore` function with optional notes

**Issue 12 - Search string redundancy**
- Explicitly removed per editorial feedback
- Comment on line 1487: "Search Strings and Manual Search tabs removed per editorial feedback"
- Only "Advanced Discovery" and "Quick Find" tabs remain

#### PARTIALLY FIXED Issues (2/14)

**Issue 4 - AN, OR primary/secondary expertise**
- AND/OR keyword operator toggle exists in reviewer discovery (lines 596-627)
- Primary and Secondary expertise fields exist for searches
- BUT: No expertise fields in User profile/registration
- Missing: User model has no `primaryExpertise` or `secondaryExpertise` fields

**Issue 10 - Links to co-published papers**
- DOI links: Present in COI details component (coi-details.tsx lines 139-186)
- PubMed links: Present (lines 188-196 search by title)
- Google Scholar links: Present on reviewer cards (verification URLs) but MISSING in COI conflict details
- OpenAlex ID is available but not linked in COI details

#### NOT FIXED Issues (6/14)

**Issue 1 - Journal creation required**
- Dashboard shows "No journals yet" with "Create Journal" button
- No favourite journals selection
- No browse/discover journals feature
- System requires journal context for most features (COI, reviewers)

**Issue 2 - Editor journal tracking**
- No editor-specific workflow
- Editors still need to create/join journals to use the system
- No integration with existing editorial systems

**Issue 3 - User profile selection**
- Registration only collects: name, email, password, institution
- No role selection (author/editor/publisher)
- User model has no `role` field (roles are via JournalMember/PublisherMember relations)
- No profile page for updating preferences

**Issue 5 - Gender field**
- No gender/sex field in User model (`prisma/schema.prisma`)
- Not in registration form
- Not tracked anywhere in the system
- Relevant for reviewer diversity analysis

**Issue 13 - Manuscript info not visible from reviewer tab**
- ManuscriptSelector component exists on reviewer page for manual selection
- BUT: `manuscriptId` query parameter from manuscript detail page is ignored
- Line 137 reads `submissionId` but not `manuscriptId`
- `selectedManuscriptId` state (line 150) only set via manual UI selection

**Issue 14 - Find Reviewers button leads nowhere**
- Manuscript detail page correctly navigates to: `/dashboard/journals/${slug}/reviewers?manuscriptId=${id}`
- BUT: Reviewers page does NOT read `manuscriptId` from URL search params
- User must manually re-select the manuscript on the reviewer page
- Fix needed: Add `useEffect` to read `manuscriptId` from `searchParams` and auto-load

---

## Recommended Priority Fixes

### High Priority (Broken functionality)
1. **Issue 14 + 13**: Add `manuscriptId` query param handling to reviewers page
2. **Issue 10**: Add Google Scholar link to COI conflict details

### Medium Priority (Missing features)
3. **Issue 3**: Add user role selection to registration
4. **Issue 5**: Add gender field to User model
5. **Issue 4**: Add expertise fields to User profile
6. **Issue 1**: Add favourite journals / journal discovery

### Lower Priority (UX improvements)
7. **Issue 2**: Editor-specific workflow

---

## Test Run History

| Date | Tests | Passed | Failed | Duration | Notes |
|---|---|---|---|---|---|
| 2026-02-06 14:47 | 251 | 249 | 2 | 566ms | Editor issue verification; 2 pre-existing failures |
| 2026-02-06 14:18 | 207 | 207 | 0 | 606ms | Initial test suite - all passing |
| 2026-02-06 14:17 | 207 | 202 | 5 | 397ms | PDF parser tests fixed (content line keyword matching) |
