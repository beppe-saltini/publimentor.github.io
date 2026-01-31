# PubliMentor Implementation Roadmap

## Vision Statement

PubliMentor is a **research integrity and editorial workflow platform** for academic journal editors and authors. It supports peer-review workflows, research integrity checks, and journal-specific submission formatting.

**Core Principle**: Flag, don't accuse. Assist editors, don't replace them. Keep humans in the loop.

---

## Phase 1: Foundation Improvements (Current Sprint)

### 1.1 Language & Safety Compliance ⚠️ CRITICAL

All UI text must reflect our legal/ethical position:

| Current Language | Required Language |
|------------------|-------------------|
| "COI Warning" | "⚠️ Potential overlap detected — editorial review required" |
| "Conflict Detected" | "Potential indicator identified" |
| "No Conflicts Found" | "No indicators found in automated check" |
| Any binary yes/no | Confidence levels + "requires review" |

**Files to Update:**
- `src/app/(dashboard)/dashboard/journals/[slug]/coi/page.tsx`
- `src/app/(dashboard)/dashboard/journals/[slug]/reviewers/page.tsx`
- All API responses

### 1.2 Reviewer Finding Enhancements

**A. Configurable Co-authorship Window**
```typescript
// Editor can toggle: 3, 5, 7, 10 years or "all time"
interface ReviewerSearchOptions {
  coauthorshipWindowYears: 3 | 5 | 7 | 10 | null;
}
```

**B. Add Contact Information**
- Extract email from OpenAlex author profiles
- Extract institutional website/homepage
- Display for editorial verification

**C. Topical Relevance Scoring**
- Compare manuscript keywords to reviewer's topic areas
- Show "relevance score" (high/medium/low)

**D. Clear "Recommendation Only" Framing**
- Add disclaimer: "These are suggestions for editorial consideration, not automated assignments"
- Add "Export for Review" button (CSV with name, affiliation, email, website, relevance, COI flags)

---

## Phase 2: Extended COI Detection

### 2.1 Shared Affiliations Check

```typescript
interface AffiliationCOI {
  type: 'same_institution' | 'same_department' | 'recent_affiliation';
  institution: string;
  confidence: number;
  explanation: string;
}
```

**Data Sources:**
- OpenAlex author affiliations
- ORCID employment history
- ROR (Research Organization Registry) for institution matching

### 2.2 Funding Overlap Detection

```typescript
interface FundingCOI {
  type: 'shared_grant' | 'same_funder';
  grantId?: string;
  funder: string;
  confidence: number;
}
```

**Data Sources:**
- OpenAlex works → grants field
- Crossref Funder Registry

### 2.3 Editorial Board / Society Links

- Check if author/reviewer serve on same editorial boards
- Check society membership overlaps (where available)

**Note:** This data is harder to obtain; may require manual input or ORCID activities.

---

## Phase 3: Tortured Phrases Detection (Paper Mill Screening)

### 3.1 Pattern Database

Build/integrate a corpus of known tortional phrase patterns:

```typescript
interface TorturedPhrasePattern {
  pattern: string | RegExp;
  originalPhrase: string;
  category: 'synonym_substitution' | 'unusual_collocation' | 'known_papermill';
  severity: 'high' | 'medium' | 'low';
}

// Examples:
const TORTURED_PHRASES = [
  { pattern: /counterfeit consciousness/i, originalPhrase: "artificial intelligence", severity: "high" },
  { pattern: /profound learning/i, originalPhrase: "deep learning", severity: "high" },
  { pattern: /recondite technique/i, originalPhrase: "novel method", severity: "medium" },
];
```

### 3.2 Detection Service

```typescript
interface TorturedPhraseResult {
  found: boolean;
  matches: {
    phrase: string;
    location: { page: number; context: string };
    likelyOriginal: string;
    severity: 'high' | 'medium' | 'low';
  }[];
  summary: string; // "3 potential language anomalies detected"
}
```

### 3.3 UI Output

**CRITICAL LANGUAGE:**
- ✅ "Language anomaly detected"
- ✅ "Unusual phrasing — may warrant review"
- ✅ "Potential indicator — editor discretion advised"
- ❌ NEVER: "Paper mill detected", "Fraud", "Reject"

---

## Phase 4: Author Identity Verification

### 4.1 ORCID Validation

```typescript
interface ORCIDValidation {
  orcidExists: boolean;
  nameMatch: 'exact' | 'partial' | 'mismatch' | 'unknown';
  affiliationMatch: 'match' | 'mismatch' | 'not_available';
  accountAge: Date;
  worksCount: number;
  confidence: 'high' | 'medium' | 'low' | 'unverified';
}
```

### 4.2 Email Domain Validation

```typescript
interface EmailValidation {
  emailProvided: boolean;
  domainType: 'institutional' | 'personal' | 'disposable' | 'unknown';
  matchesAffiliation: boolean;
  institutionVerified: boolean; // via ROR
}
```

### 4.3 Affiliation Plausibility

- Verify institution exists via ROR API
- Check for formatting anomalies
- Flag: fake institutions, formatting inconsistencies

### 4.4 Duplicate Identity Detection

- Hash author details across submissions
- Flag similar/duplicate entries
- Output: "Author profile appears in X other submissions"

---

## Phase 5: Reference Validation

### 5.1 Reference Existence Check

```typescript
interface ReferenceValidation {
  totalReferences: number;
  validated: number;
  notFound: number;
  suspicious: number;
  
  issues: {
    reference: string;
    issue: 'not_found' | 'doi_invalid' | 'retracted' | 'predatory_journal';
    suggestion?: string;
  }[];
}
```

**Data Sources:**
- Crossref DOI validation
- PubMed ID lookup
- Retraction Watch database

### 5.2 Citation-Text Match

- Parse in-text citations
- Match to reference list
- Flag: orphan references, uncited citations

### 5.3 Topical Relevance

- Extract topics from cited papers
- Compare to manuscript topics
- Flag: potentially irrelevant citations, citation padding patterns

### 5.4 Citation Cartel Detection (Later Phase)

- Analyze citation networks
- Flag unusual citation clusters
- "⚠️ Citation pattern requires review"

---

## Phase 6: Author Formatting Tool

### 6.1 Journal Template System

```typescript
interface JournalTemplate {
  journalId: string;
  name: string;
  
  structure: {
    sections: SectionRequirement[];
    headingStyle: 'numbered' | 'unnumbered';
    abstractFormat: 'structured' | 'unstructured';
  };
  
  limits: {
    wordCount: { min?: number; max?: number };
    abstractWords: { max: number };
    figureCount: { max?: number };
    tableCount: { max?: number };
    referenceCount: { min?: number; max?: number };
  };
  
  referenceStyle: 'apa7' | 'vancouver' | 'nature' | 'custom';
  
  requiredStatements: (
    | 'ethics_approval'
    | 'data_availability'
    | 'coi_declaration'
    | 'author_contributions'
    | 'funding'
  )[];
}
```

### 6.2 Compliance Checker

```typescript
interface ComplianceReport {
  passed: boolean;
  score: number; // 0-100
  
  sections: {
    structure: { passed: boolean; issues: string[] };
    wordLimits: { passed: boolean; issues: string[] };
    references: { passed: boolean; issues: string[] };
    statements: { passed: boolean; missing: string[] };
    figures: { passed: boolean; issues: string[] };
  };
  
  actionItems: {
    priority: 'must_fix' | 'recommended' | 'optional';
    description: string;
    location?: string;
  }[];
}
```

### 6.3 Formatting Engine (Future)

- Auto-apply journal styles to DOCX
- Reformat references to journal style
- Adjust heading formats
- Generate compliance checklist PDF

---

## Database Schema Extensions

```prisma
// Add to schema.prisma

model IntegrityCheck {
  id           String   @id @default(cuid())
  type         CheckType
  status       CheckStatus @default(PENDING)
  result       Json?    // Type-specific result
  confidence   Float?
  flags        String[] // Array of flag codes
  reviewedBy   String?  // Editor who reviewed
  reviewedAt   DateTime?
  notes        String?  @db.Text
  createdAt    DateTime @default(now())
  
  submissionId String
  submission   Submission @relation(fields: [submissionId], references: [id])
}

enum CheckType {
  COI_COAUTHORSHIP
  COI_AFFILIATION
  COI_FUNDING
  TORTURED_PHRASES
  AUTHOR_IDENTITY
  REFERENCE_VALIDATION
}

enum CheckStatus {
  PENDING
  COMPLETED
  REQUIRES_REVIEW
  CLEARED
  FLAGGED
}

model TorturedPhrasePattern {
  id            String @id @default(cuid())
  pattern       String
  originalPhrase String
  category      String
  severity      String
  source        String? // Where pattern was sourced
  createdAt     DateTime @default(now())
}

model ReferenceCheck {
  id           String @id @default(cuid())
  reference    String @db.Text
  doi          String?
  pmid         String?
  status       ReferenceStatus
  issues       String[]
  createdAt    DateTime @default(now())
  
  submissionId String
  submission   Submission @relation(fields: [submissionId], references: [id])
}

enum ReferenceStatus {
  VALID
  NOT_FOUND
  RETRACTED
  SUSPICIOUS
}
```

---

## UI/UX Safety Guidelines

### Required Disclaimer Components

Every integrity check screen MUST include:

```tsx
<Card className="bg-amber-50 border-amber-200">
  <CardContent className="py-3">
    <div className="flex items-start gap-2">
      <AlertTriangle className="h-5 w-5 text-amber-600" />
      <div className="text-sm text-amber-800">
        <p className="font-medium">Automated Screening Notice</p>
        <p>
          These results are automated indicators only. They do not constitute 
          accusations or determinations. All flags require editorial review 
          and human judgment before any action is taken.
        </p>
      </div>
    </div>
  </CardContent>
</Card>
```

### Color Coding

| Level | Color | Meaning |
|-------|-------|---------|
| Info | Blue | Informational, no action needed |
| Review | Amber/Yellow | Potential indicator, review recommended |
| Attention | Orange | Multiple indicators, prioritize review |
| **Never Red** | - | Red implies certainty we cannot provide |

### Button Labels

- ✅ "Check for Potential Issues"
- ✅ "Run Integrity Screening"
- ✅ "Generate Review Report"
- ❌ "Detect Fraud"
- ❌ "Find Problems"
- ❌ "Verify Authenticity"

---

## API Response Standards

All integrity check APIs must return:

```typescript
interface IntegrityCheckResponse {
  status: 'completed' | 'partial' | 'error';
  
  summary: {
    indicatorsFound: number;
    requiresReview: boolean;
    confidence: 'high' | 'medium' | 'low';
  };
  
  disclaimer: string; // Always include
  
  indicators: {
    type: string;
    severity: 'info' | 'review' | 'attention';
    description: string;
    evidence: string[];
    recommendation: string; // "Editor review recommended"
  }[];
  
  metadata: {
    checkedAt: string;
    dataSources: string[];
    limitations: string[];
  };
}
```

---

## Priority Order

1. **Immediate** (This Sprint):
   - Fix all UI language to "flag not accuse"
   - Add configurable co-authorship window
   - Add reviewer contact info extraction

2. **High Priority** (Next Sprint):
   - Tortured phrases detection (high value, topical)
   - Extended COI (affiliations)

3. **Medium Priority**:
   - Author identity verification
   - Reference validation (existence check)

4. **Later**:
   - Full author formatting tool
   - Citation cartel detection
   - Advanced reference analysis

---

## Legal/Ethical Checklist

Before any release, verify:

- [ ] No feature makes accusations
- [ ] All outputs use "potential indicator" language
- [ ] Human review is required for all flags
- [ ] No auto-reject functionality
- [ ] Disclaimers present on all screens
- [ ] Data sources cited
- [ ] Limitations documented
