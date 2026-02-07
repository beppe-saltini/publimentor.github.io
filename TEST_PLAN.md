# PubliMentor - Comprehensive Test Plan

> **Version**: 1.0.0
> **Created**: 2026-02-06
> **Methodology**: Vibe Testing + Traditional QA Pyramid
> **Status**: Active

---

## 1. Executive Summary

This test plan establishes a comprehensive quality assurance strategy for PubliMentor, a scientific editorial workflow management platform. Given that PubliMentor is a **vibe-coded project** (AI-assisted development), this plan incorporates specific strategies to address the unique risks of AI-generated code, including:

- **Hallucination-prone logic**: AI may generate plausible-looking but incorrect algorithms
- **Implicit assumptions**: AI code may assume context not present in the codebase
- **Security blind spots**: Research shows only 10.5% of AI-generated code is secure (UIUC benchmark, 2025)
- **Edge case gaps**: AI tends to handle the happy path well but miss edge cases
- **Integration seams**: AI-generated modules may have subtle interface mismatches

---

## 2. Vibe Testing Methodology

### 2.1 What is Vibe Testing?

Vibe testing goes beyond "does it work?" to ask "does it feel right?" It combines:

1. **Functional correctness**: Traditional assertion-based testing
2. **Instruction following**: Does the code adhere to non-functional requirements (readability, style, conventions)?
3. **UX coverage**: Capturing subtle flaws like slow responses, unclear error messages
4. **Human-AI collaboration**: Leveraging AI for test generation while maintaining human oversight

### 2.2 Vibe-Coding Specific Test Strategy

| Risk Category | Mitigation Strategy | Test Type |
|---|---|---|
| Incorrect algorithms | Property-based testing for pure functions | Unit |
| Security vulnerabilities | Input fuzzing, injection testing, file validation | Unit + Integration |
| Edge case gaps | Boundary value analysis, equivalence partitioning | Unit |
| API contract drift | Schema validation, response shape testing | Integration |
| Name matching errors | Comprehensive cross-cultural name corpus testing | Unit |
| Data integrity | Referential integrity tests, constraint validation | Integration |
| Error handling | Negative path testing, error response validation | Unit + Integration |

### 2.3 Test Pyramid for PubliMentor

```
        /  E2E Tests  \          (Future: Playwright)
       / Integration    \        API routes, DB operations
      /   Unit Tests      \      Pure functions, utilities
     /______________________\    Foundation: ~80% of tests
```

**Current phase focuses on Unit + Integration tests** (~95% of test effort).

---

## 3. Scope

### 3.1 In Scope

| Module | Priority | Test Type | Rationale |
|---|---|---|---|
| `name-matcher.ts` | **Critical** | Unit | Core matching algorithm - incorrect matches = wrong COI results |
| `coi-detector.ts` | **Critical** | Unit | Pure functions (severity calculation) affect editorial decisions |
| `format-checker.ts` | **High** | Unit | Format compliance logic must be deterministic |
| `security.ts` | **Critical** | Unit | XSS prevention, rate limiting, password validation, file validation |
| `author-parser.ts` | **High** | Unit | Name parsing accuracy across diverse formats |
| `tortured-phrases.ts` | **High** | Unit | Paper mill detection must be accurate (false positives harm authors) |
| `reference-validator.ts` | **High** | Unit | DOI/PMID parsing correctness |
| `pdf-parser.ts` | **Medium** | Unit | Section extraction, reference counting |
| `dblp.ts` | **High** | Unit + Integration | DBLP API client for CS-focused COI detection |
| `full-report/route.ts` | **Critical** | Integration | Composite integrity report - parallel execution, fault tolerance |
| `dashboard-shell.tsx` | **High** | Component (E2E) | Responsive layout - mobile drawer, desktop sidebar |
| `onboarding.tsx` | **High** | Component (E2E) | Multi-step onboarding wizard flow |
| API Health routes | **High** | Integration | System reliability indicators |
| API Auth routes | **Critical** | Integration | Authentication correctness |
| Domain entities | **Medium** | Unit | Business rule enforcement |

### 3.2 Out of Scope (Phase 1)

- E2E browser tests (Playwright - Phase 2)
- Visual regression testing
- Performance/load testing
- External API integration tests (OpenAlex, PubMed, Anthropic)
- React component rendering tests

---

## 4. Test Cases

### 4.1 Name Matcher (`src/lib/name-matcher.ts`)

| TC-ID | Test Case | Input | Expected | Priority |
|---|---|---|---|---|
| NM-001 | Exact match | "John Smith" vs "John Smith" | Match, confidence=1.0 | Critical |
| NM-002 | Case insensitivity | "john smith" vs "JOHN SMITH" | Match | Critical |
| NM-003 | Nickname resolution (James/Jim) | "James" vs "Jim" | Match, type=nickname | Critical |
| NM-004 | Nickname resolution (William/Bill) | "William" vs "Bill" | Match, type=nickname | High |
| NM-005 | Chinese transliteration (Zhang/Chang) | "Zhang" vs "Chang" | Match, type=transliteration | Critical |
| NM-006 | Chinese transliteration (Li/Lee) | "Li" vs "Lee" | Match, type=transliteration | High |
| NM-007 | Diacritics normalization | "José" vs "Jose" | Match | High |
| NM-008 | Completely different names | "John" vs "Maria" | No match | Critical |
| NM-009 | Phonetic match (Soundex) | "Smith" vs "Smyth" | Match, type=phonetic | Medium |
| NM-010 | Full name exact match | "John Smith" vs "John Smith" | Match | Critical |
| NM-011 | Full name nickname match | "James Smith" vs "Jim Smith" | Match | Critical |
| NM-012 | Full name different surnames | "John Smith" vs "John Jones" | No match | Critical |
| NM-013 | Levenshtein distance accuracy | "kitten" vs "sitting" | Distance=3 | Medium |
| NM-014 | Jaro-Winkler identical strings | "abc" vs "abc" | Similarity=1.0 | Medium |
| NM-015 | Jaro-Winkler empty strings | "" vs "" | Similarity=0 | Medium |
| NM-016 | Soundex encoding | "Robert" | "R163" | Medium |
| NM-017 | Name variations generation | "James" | includes "jim", "jimmy" | High |
| NM-018 | Chinese variations generation | "zhang" | includes "chang", "cheung" | High |
| NM-019 | Best matches finder | "Jim" in ["James","John","Jane"] | "James" as best match | High |
| NM-020 | German diacritics (ß) | "straße" | normalizes to "strasse" | Medium |

### 4.2 COI Detector (`src/lib/coi-detector.ts`)

| TC-ID | Test Case | Input | Expected | Priority |
|---|---|---|---|---|
| COI-001 | Critical severity for first author | role="first" | severity="critical" | Critical |
| COI-002 | Critical severity for last author | role="last" | severity="critical" | Critical |
| COI-003 | Critical severity for corresponding | role="corresponding" | severity="critical" | Critical |
| COI-004 | High severity for middle_early | role="middle_early" | severity="high" | High |
| COI-005 | Medium severity for middle_late | role="middle_late" | severity="medium" | High |
| COI-006 | Default medium for unknown role | role=undefined | severity="medium" | Medium |
| COI-007 | No time adjustment (0-2 years) | critical, 1 year | severity="critical" | Critical |
| COI-008 | One-step downgrade (3-5 years) | critical, 4 years | severity="high" | Critical |
| COI-009 | Two-step downgrade (6-10 years) | critical, 8 years | severity="medium" | Critical |
| COI-010 | Three-step downgrade (10+ years) | critical, 15 years | severity="low" | Critical |
| COI-011 | Capped at minimal | low, 15 years | severity="minimal" | High |
| COI-012 | No time info returns base | critical, undefined | severity="critical" | High |
| COI-013 | Negative years returns base | critical, -1 | severity="critical" | Medium |
| COI-014 | Worst severity from list | ["low","critical","medium"] | "critical" | High |
| COI-015 | Worst severity empty list | [] | null | Medium |
| COI-016 | Worst severity single item | ["medium"] | "medium" | Medium |

### 4.3 Format Checker (`src/lib/format-checker.ts`)

| TC-ID | Test Case | Input | Expected | Priority |
|---|---|---|---|---|
| FC-001 | Paper within all limits | 5000 words, 8 pages | passed=true | Critical |
| FC-002 | Below minimum word count | 1000 words | error issue for min-word-count | Critical |
| FC-003 | Above maximum word count | 15000 words | error issue for max-word-count | Critical |
| FC-004 | Below minimum pages | 2 pages | error issue for min-pages | High |
| FC-005 | Above maximum pages | 25 pages | error issue for max-pages | High |
| FC-006 | Missing required section | no "methods" section | warning issue | High |
| FC-007 | All required sections present | all 7 sections | no section issues | High |
| FC-008 | Below minimum references | 5 references | warning issue | Medium |
| FC-009 | Abstract too long | 500 word abstract | warning issue | Medium |
| FC-010 | Passed=true with only warnings | warnings but no errors | passed=true | Critical |
| FC-011 | Passed=false with errors | has error issues | passed=false | Critical |
| FC-012 | Custom section rule - missing | custom rule, section missing | issue returned | Medium |
| FC-013 | Custom length rule - below min | wordCount < custom min | issue returned | Medium |
| FC-014 | Custom metadata rule - missing | required metadata absent | issue returned | Medium |

### 4.4 Security (`src/lib/security.ts`)

| TC-ID | Test Case | Input | Expected | Priority |
|---|---|---|---|---|
| SEC-001 | Rate limit - first request | new identifier | allowed=true | Critical |
| SEC-002 | Rate limit - exceeded | maxRequests+1 calls | allowed=false | Critical |
| SEC-003 | Rate limit - window expiry | after windowMs | allowed=true (reset) | Critical |
| SEC-004 | Sanitize HTML tags | `<script>alert('xss')</script>` | tags removed | Critical |
| SEC-005 | Sanitize javascript: protocol | "javascript:alert(1)" | protocol removed | Critical |
| SEC-006 | Sanitize event handlers | "onerror=alert(1)" | removed | Critical |
| SEC-007 | Sanitize angle brackets | `<div>` | `&lt;div&gt;` | High |
| SEC-008 | Sanitize object recursively | nested object with XSS | all strings sanitized | High |
| SEC-009 | Path traversal detection | "../../../etc/passwd" | isPathWithinBase=false | Critical |
| SEC-010 | Valid path within base | "uploads/file.pdf" | isPathWithinBase=true | Critical |
| SEC-011 | Filename sanitization | "../../file.pdf" | "__file.pdf" | Critical |
| SEC-012 | Filename null bytes | "file\x00.pdf" | "file.pdf" | Critical |
| SEC-013 | Password too short | "Aa1!short" | invalid | Critical |
| SEC-014 | Password no uppercase | "abcdefgh1!" | invalid | High |
| SEC-015 | Password no lowercase | "ABCDEFGH1!" | invalid | High |
| SEC-016 | Password no number | "Abcdefgh!!" | invalid | High |
| SEC-017 | Password no special char | "Abcdefgh12" | invalid | High |
| SEC-018 | Password common pattern | "password123!" | invalid | High |
| SEC-019 | Strong password | "MyS3cure!Pass" | valid | Critical |
| SEC-020 | PDF magic bytes validation | valid PDF header | true | High |
| SEC-021 | Invalid file type | wrong magic bytes | false | High |
| SEC-022 | MIME type detection - PDF | PDF bytes | "application/pdf" | High |
| SEC-023 | MIME type detection - unknown | random bytes | null | Medium |
| SEC-024 | Secure token generation | length=32 | 64-char hex string | Medium |
| SEC-025 | API key format | generated key | starts with "pm_" | Medium |
| SEC-026 | Client IP from x-forwarded-for | header present | first IP | Medium |
| SEC-027 | Client IP fallback | no headers | "unknown" | Medium |

### 4.5 Author Parser (`src/lib/author-parser.ts`)

| TC-ID | Test Case | Input | Expected | Priority |
|---|---|---|---|---|
| AP-001 | Simple two-name author | "John Smith" | firstName="John", surname="Smith" | Critical |
| AP-002 | Author with middle initial | "John A. Smith" | middleInitials="A" | High |
| AP-003 | Author with surname prefix | "Ludwig van Beethoven" | surnamePrefix="van" | High |
| AP-004 | Author with title removal | "Dr. John Smith" | fullName without "Dr." | High |
| AP-005 | Author with suffix removal | "John Smith PhD" | fullName without "PhD" | High |
| AP-006 | Single name (mononym) | "Madonna" | surname="Madonna" | Medium |
| AP-007 | Author list parsing | "John Smith, Jane Doe" | 2 authors | Critical |
| AP-008 | Author list with "and" | "John Smith and Jane Doe" | 2 authors | High |
| AP-009 | Duplicate author removal | "John Smith, John Smith" | 1 author | High |
| AP-010 | PubMed format generation | parsed author | "Smith J[au]" format | High |
| AP-011 | Scholar format generation | parsed author | 'author:"John Smith"' | High |
| AP-012 | Empty input | "" | null | Medium |
| AP-013 | Superscript removal | "John Smith¹²" | clean name | Medium |
| AP-014 | PubMed search string | authors + reviewer | correct format | High |
| AP-015 | OpenAlex queries | list of authors | array of query strings | Medium |

### 4.6 Tortured Phrases (`src/lib/tortured-phrases.ts`)

| TC-ID | Test Case | Input | Expected | Priority |
|---|---|---|---|---|
| TP-001 | No tortured phrases | clean academic text | found=false, severity="none" | Critical |
| TP-002 | Single high-severity match | "counterfeit consciousness" | found=true, severity varies | Critical |
| TP-003 | Multiple high-severity matches | 3+ high phrases | severity="high" | Critical |
| TP-004 | Case insensitive matching | "PROFOUND LEARNING" | match found | High |
| TP-005 | Context extraction | phrase in text | context includes surrounding text | High |
| TP-006 | Category breakdown in summary | mixed categories | summary includes categories | Medium |
| TP-007 | Disclaimer always present | any result | disclaimer is non-empty | High |
| TP-008 | Sorting by severity | mixed severity | high severity first | Medium |
| TP-009 | Category display names | "ai_ml" | "AI/Machine Learning" | Low |
| TP-010 | Severity color classes | "high" | contains "orange" | Low |

### 4.7 Reference Validator (`src/lib/reference-validator.ts`)

| TC-ID | Test Case | Input | Expected | Priority |
|---|---|---|---|---|
| RV-001 | Extract DOI standard format | "10.1234/test.123" | DOI extracted | Critical |
| RV-002 | Extract DOI from URL | "doi.org/10.1234/test" | DOI extracted | High |
| RV-003 | Extract DOI with prefix | "doi: 10.1234/test" | DOI extracted | High |
| RV-004 | Extract PMID | "PMID: 12345678" | "12345678" | High |
| RV-005 | Extract PMID from URL | "pubmed.ncbi.nlm.nih.gov/12345" | "12345" | High |
| RV-006 | Parse reference block | multi-line refs | array of ReferenceInput | High |
| RV-007 | Skip short lines | line < 20 chars | skipped | Medium |
| RV-008 | Remove leading numbers | "[1] Reference text..." | cleaned text | Medium |
| RV-009 | No DOI or PMID | plain text reference | doi=undefined, pmid=undefined | Medium |

### 4.8 PDF Parser (`src/lib/pdf-parser.ts`)

| TC-ID | Test Case | Input | Expected | Priority |
|---|---|---|---|---|
| PP-001 | Extract sections from text | text with section headers | Map with sections | High |
| PP-002 | Count numbered references | "[1]...[2]...[3]..." | count=3 | High |
| PP-003 | Count references no section | text without "references" | count=0 | Medium |
| PP-004 | Section header length limit | header > 50 chars | not treated as header | Medium |
| PP-005 | Case insensitive sections | "INTRODUCTION" | matched | High |

### 4.9 DBLP Client (`src/lib/dblp.ts`)

| TC-ID | Test Case | Input | Expected | Priority |
|---|---|---|---|---|
| DBLP-001 | Search author by name | "Yoshua Bengio" | Non-empty results array | Critical |
| DBLP-002 | Search author no results | "xxxxxxnonexistent999" | Empty array | High |
| DBLP-003 | Rate throttle (1 req/s) | 2 rapid requests | Second delayed >= 1s | Critical |
| DBLP-004 | Find coauthored publications | Two known collaborators | Shared papers returned | Critical |
| DBLP-005 | No coauthorship | Two unrelated authors | Empty array | High |
| DBLP-006 | fromYear filter | fromYear=2020 | Only papers >= 2020 | High |
| DBLP-007 | Author aliases parsed | Author with aliases | aliases array populated | Medium |
| DBLP-008 | DOI extraction | Publication with DOI | doi field present | Medium |
| DBLP-009 | hasCoauthorship boolean | Known collaborators | true | High |
| DBLP-010 | API error handling | Simulated 500 | Error thrown | High |

### 4.10 Full Integrity Report (`src/app/api/integrity/full-report/route.ts`)

| TC-ID | Test Case | Input | Expected | Priority |
|---|---|---|---|---|
| FIR-001 | All three checks pass | text + authors + refs | All 3 results present | Critical |
| FIR-002 | Only tortured phrases | text only | torturedPhrases result only | High |
| FIR-003 | Only author identity | authors only | authorIdentity result only | High |
| FIR-004 | Only references | referenceText only | references result only | High |
| FIR-005 | No input provided | empty body | 400 error | Critical |
| FIR-006 | Partial failure graceful | text + broken refs | Partial report returned | Critical |
| FIR-007 | Risk level: clear | Clean inputs | riskLevel="clear" | High |
| FIR-008 | Risk level: review | 1-2 indicators | riskLevel="review" | High |
| FIR-009 | Risk level: attention | 3+ indicators | riskLevel="attention" | Critical |
| FIR-010 | Rate limit enforced | 6 reqs in 1 min | 6th returns 429 | Critical |
| FIR-011 | Auth required | No session | 401 Unauthorized | Critical |
| FIR-012 | Retracted ref escalates | retracted > 0 | riskLevel="attention" | Critical |
| FIR-013 | Disclaimer present | Any input | disclaimer non-empty | High |

### 4.11 Responsive Layout (`src/components/dashboard/*`)

| TC-ID | Test Case | Input | Expected | Priority |
|---|---|---|---|---|
| RL-001 | Desktop sidebar visible | viewport >= 1024px | Sidebar visible | Critical |
| RL-002 | Mobile sidebar hidden | viewport < 1024px | Sidebar hidden | Critical |
| RL-003 | Hamburger opens drawer | Click on mobile | Drawer appears | Critical |
| RL-004 | Backdrop closes drawer | Click overlay | Drawer closes | High |
| RL-005 | X button closes drawer | Click X | Drawer closes | High |
| RL-006 | Nav link closes drawer | Click nav link | Closes + navigates | High |
| RL-007 | a11y: aria-label | Mobile render | aria-label present | Medium |
| RL-008 | a11y: aria-modal | Drawer open | aria-modal="true" | Medium |

### 4.12 Onboarding Flow (`src/components/dashboard/onboarding.tsx`)

| TC-ID | Test Case | Input | Expected | Priority |
|---|---|---|---|---|
| OB-001 | New user redirect | 0 journals, 0 publishers | Redirect to onboarding | Critical |
| OB-002 | Existing user no redirect | >= 1 journal | Stays on dashboard | Critical |
| OB-003 | Create publisher success | Valid name | POST called, step advances | Critical |
| OB-004 | Create journal success | Valid journal | POST called, step advances | Critical |
| OB-005 | Empty name rejected | Empty input | Toast error | High |
| OB-006 | Done step actions | Complete flow | 4 action buttons | High |
| OB-007 | Skip onboarding | Click skip | Navigates to dashboard | High |
| OB-008 | Slug auto-generation | "My Journal" | "my-journal" | Medium |
| OB-009 | API error handling | Server 500 | Toast error, no advance | High |

---

## 5. Test Environment

### 5.1 Tools

| Tool | Purpose | Version |
|---|---|---|
| Vitest | Test runner + assertion library | Latest |
| @testing-library/react | Component testing (future) | Latest |
| vitest-mock-extended | Prisma mocking | Latest |

### 5.2 Configuration

- **Test files**: `src/**/*.test.ts`, `src/**/*.spec.ts`
- **Setup file**: `src/test/setup.ts`
- **Path aliases**: `@/*` mapped to `./src/*`
- **Environment**: `node` (server-side logic)
- **Coverage target**: 80% line coverage for critical modules

---

## 6. Test Execution Strategy

### 6.1 Continuous Testing

Tests run automatically via:
1. **npm script**: `npm test` - runs full suite
2. **Watch mode**: `npm run test:watch` - re-runs on file changes
3. **Coverage**: `npm run test:coverage` - generates coverage report
4. **CI/CD**: Tests gate all deployments (future GitHub Actions)

### 6.2 Test Categories

```
npm test              # Run all tests
npm run test:unit     # Unit tests only
npm run test:watch    # Watch mode for development
npm run test:coverage # With coverage report
```

---

## 7. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| AI-generated false negatives in COI detection | Medium | **Critical** | Extensive name corpus testing |
| XSS via unsanitized input | Medium | **Critical** | Input fuzzing, injection testing |
| Path traversal in file operations | Low | **Critical** | Explicit traversal attack testing |
| Tortured phrase false positives | Medium | **High** | Context-aware testing, disclaimer verification |
| Password bypass | Low | **Critical** | Comprehensive validation testing |
| Rate limit bypass | Medium | **High** | Boundary testing around limits |
| Format checker inconsistencies | Low | **Medium** | Property-based testing with various inputs |
| DBLP API unavailability | Medium | **Medium** | Graceful degradation; DBLP is supplementary source |
| Full report partial failure | Medium | **High** | Promise.allSettled ensures partial results |
| Onboarding redirect loop | Low | **High** | Guard clause checks journal count before redirect |
| Mobile sidebar state leaks | Low | **Low** | Client-side state reset on close |

---

## 8. Acceptance Criteria

- All critical test cases pass
- No regressions in existing functionality
- Security tests cover OWASP Top 10 relevant categories
- Name matching handles at minimum: English, Chinese, European diacritics
- 80%+ line coverage on critical modules
- All tests complete in < 30 seconds

---

## 9. Test Results Tracking

Results are tracked in `TEST_RESULTS.md` in the repository root. Each test run updates:
- Date/time of run
- Pass/fail counts
- Coverage percentages
- Specific failures with details

---

## 10. References

- Cabanac, G., Labbé, C., & Magazinov, A. (2021). "Tortured phrases: A dubious writing style emerging in science"
- Google DORA 2025: "Every 25% increase in AI-generated code leads to 7.2% decrease in software stability"
- UIUC AI Code Security Benchmark (2025): "61% functionally correct, only 10.5% secure"
- Vibe Testing: The Next Step in Software QA (LambdaTest, 2026)
- The New QA Pyramid: Building Agentic Test Strategies from Scratch (BreakTheBuild, 2025)
