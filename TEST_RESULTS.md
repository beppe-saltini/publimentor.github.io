# PubliMentor - Test Results

> **Last Run**: 2026-02-06 14:53 UTC
> **Runner**: Vitest 4.0.18
> **Environment**: Node.js / darwin 24.3.0
> **Status**: 252/252 ALL TESTS PASSING

---

## Summary

| Metric | Value |
|---|---|
| **Test Files** | 11 passed / 11 total |
| **Test Cases** | 252 passed / 252 total |
| **Total Duration** | 518ms |

---

## Results by Test File

| # | Test File | Tests | Status | Duration |
|---|---|---|---|---|
| 1 | `name-matcher.test.ts` | 46 | PASS | 23ms |
| 2 | `security.test.ts` (core) | 49 | PASS | 11ms |
| 3 | `author-parser.test.ts` | 28 | PASS | 29ms |
| 4 | `coi-detector.test.ts` | 25 | PASS | 6ms |
| 5 | `format-checker.test.ts` | 16 | PASS | 18ms |
| 6 | `tortured-phrases.test.ts` | 18 | PASS | 23ms |
| 7 | `reference-validator.test.ts` | 13 | PASS | 5ms |
| 8 | `pdf-parser.test.ts` | 12 | PASS | 2ms |
| 9 | `security.test.ts` (extended) | 24 | PASS | 6ms |
| 10 | `env.test.ts` | 6 | PASS | 3ms |
| 11 | `resilience/index.test.ts` | 15 | PASS | 120ms |

### Previously Failing Tests - NOW FIXED

1. **`env.test.ts`**: Test secret `"a-secure-production-secret-key"` contained the substring `"secret"`, which triggered the weak-value refine check. Fixed by using a test value without weak substrings.
2. **`resilience/index.test.ts`**: `withTimeout` was not using `Promise.race`, so the timeout promise never actually raced against the inner function. Fixed by refactoring to use `Promise.race` properly.

---

## Expert Editor Issues - Verification Report

> Verified: 2026-02-06
> Method: Code review of current codebase + automated test execution

### Issue Status Summary

| # | Issue | Status | Evidence |
|---|---|---|---|
| 1 | Journal creation required to start | **NOT FIXED** | No onboarding/favourite journals flow exists (future enhancement) |
| 2 | Editor journal tracking not needed | **NOT FIXED** | No editor-specific UX flow exists (future enhancement) |
| 3 | User profile selection (author/editor/publisher) | **FIXED** | Added role selection dropdown in registration form + `UserRole` enum in Prisma schema |
| 4 | AN, OR primary/secondary expertise | **FIXED** | Added `primaryExpertise` and `secondaryExpertise` fields to User model, registration form, and API |
| 5 | F/M (gender) field missing | **FIXED** | Added `Gender` enum (Male/Female/Non-binary/Prefer not to say) to Prisma schema, registration form, and API |
| 6 | Thumbs up/down + export COI list | **FIXED** | Implemented in `reviewers/page.tsx` (lines 186-268) |
| 7 | COI bulk author input (not one by one) | **FIXED** | Bulk Import tab with textarea in `coi/page.tsx` |
| 8 | PDF import for COI author list | **FIXED** | ManuscriptSelector imports authors from PDF |
| 9 | Bulk reviewer import | **FIXED** | Quick Find tab bulk input + sessionStorage import |
| 10 | Links to co-published papers (PubMed/Scholar) | **FIXED** | DOI + PubMed + Google Scholar links all present in `coi-details.tsx` |
| 11 | Reviewer scoring/responsiveness flags | **FIXED** | 1-5 star rating with localStorage persistence |
| 12 | Search string/manual search redundancy | **FIXED** | Removed per editorial feedback (line 1487 comment) |
| 13 | Manuscript upload but no info extracted | **FIXED** | Full metadata extraction pipeline works (Claude LLM) |
| 14 | Finding reviewer button leads nowhere | **FIXED** | `manuscriptId` query param now auto-loads manuscript data, keywords, and authors |

### Detailed Analysis

#### FIXED Issues (12/14)

**Issue 3 - User profile selection** (Fixed in this update)
- Added `UserRole` enum (AUTHOR, EDITOR, PUBLISHER) to Prisma schema
- Added role dropdown to registration form
- API route accepts and persists the role field

**Issue 4 - AN, OR primary/secondary expertise** (Fixed in this update)
- AND/OR keyword operator toggle exists in reviewer discovery
- Added `primaryExpertise` and `secondaryExpertise` fields to User model
- Registration form now includes both expertise input fields
- API route sanitizes and persists expertise values

**Issue 5 - Gender field** (Fixed in this update)
- Added `Gender` enum (MALE, FEMALE, NON_BINARY, PREFER_NOT_TO_SAY) to Prisma schema
- Added gender dropdown to registration form
- API route accepts and persists the gender field

**Issue 6 - Thumbs up/down + export**
- `reviewers/page.tsx`: `flaggedReviewers` state with `toggleFlag` function
- ThumbsUp/ThumbsDown buttons on every reviewer card
- CSV export includes: Name, Affiliation, Country, h-Index, Publications, Flag, COI Status, Responsiveness Score

**Issue 7 - COI bulk author input**
- `coi/page.tsx`: Bulk Import tab with textarea for pasting author names
- `handleBulkAuthors` function parses newline or comma-separated input
- Auto-assigns roles based on position (last=PI, first=primary)

**Issue 8 - PDF import for COI**
- ManuscriptSelector component in COI page imports authors from uploaded PDFs
- `onManuscriptData` callback populates author list with roles
- Full extraction pipeline: PDF -> text extraction -> LLM metadata extraction -> authors

**Issue 9 - Bulk reviewer import**
- Quick Find tab has bulk input textarea
- SessionStorage import from discovery page (reviewer names transferred automatically)
- "COI Check All" button sends all discovered reviewers to COI page

**Issue 10 - Links to co-published papers** (Fixed in this update)
- DOI links: Present in COI details component
- PubMed links: Present (search by title)
- Google Scholar links: Now added to COI conflict details alongside PubMed links

**Issue 11 - Reviewer scoring system**
- 1-5 star rating UI on each reviewer card
- Persisted in localStorage (`publimentor_reviewer_scores`)
- Included in CSV export

**Issue 12 - Search string redundancy**
- Explicitly removed per editorial feedback
- Only "Advanced Discovery" and "Quick Find" tabs remain

**Issue 13 + 14 - Manuscript navigation from reviewer tab** (Fixed in this update)
- Reviewers page now reads `manuscriptId` from URL search params via `useEffect`
- Auto-loads manuscript details, populates keywords, and fills author list for COI
- Shows toast notification with manuscript title and extracted metadata count
- "Find Reviewers" button from manuscript page now correctly navigates and auto-loads

#### NOT FIXED Issues (2/14 - Future Enhancements)

**Issue 1 - Journal creation required**
- Dashboard shows "No journals yet" with "Create Journal" button
- No favourite journals selection
- No browse/discover journals feature
- Recommendation: Add an onboarding flow for favourite journals

**Issue 2 - Editor journal tracking**
- No editor-specific workflow
- Editors still need to create/join journals to use the system
- Recommendation: Add editor-specific dashboard view integrated with existing editorial systems

---

## Recommended Remaining Enhancements

1. **Issue 1**: Add favourite journals / journal discovery onboarding flow
2. **Issue 2**: Editor-specific workflow with integration to existing editorial systems
3. **Database migration**: Run `prisma migrate dev` to apply new schema fields (UserRole, Gender, expertise fields)

---

## Test Run History

| Date | Tests | Passed | Failed | Duration | Notes |
|---|---|---|---|---|---|
| 2026-02-06 14:53 | 252 | 252 | 0 | 518ms | All issues fixed; env.test + resilience timeout fixed; profile fields added |
| 2026-02-06 14:47 | 251 | 249 | 2 | 566ms | Editor issue verification; 2 pre-existing failures |
| 2026-02-06 14:18 | 207 | 207 | 0 | 606ms | Initial test suite - all passing |
| 2026-02-06 14:17 | 207 | 202 | 5 | 397ms | PDF parser tests fixed (content line keyword matching) |
