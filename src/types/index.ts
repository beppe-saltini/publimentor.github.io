import type {
  User,
  Journal,
  JournalMember,
  Submission,
  Author,
  ReviewAssignment,
  FormatGuideline,
  FormatReport,
  MemberRole,
  SubmissionStatus,
  ReviewStatus,
  ReviewDecision,
} from "@prisma/client";

// Re-export Prisma types
export type {
  User,
  Journal,
  JournalMember,
  Submission,
  Author,
  ReviewAssignment,
  FormatGuideline,
  FormatReport,
  MemberRole,
  SubmissionStatus,
  ReviewStatus,
  ReviewDecision,
};

// Extended types with relations
export type JournalWithMembers = Journal & {
  members: (JournalMember & { user: User })[];
};

export type SubmissionWithAuthors = Submission & {
  authors: Author[];
};

export type SubmissionWithDetails = Submission & {
  authors: Author[];
  reviewAssignments: (ReviewAssignment & { reviewer: User })[];
  formatReport: FormatReport | null;
  journal: Journal;
};

export type ReviewAssignmentWithDetails = ReviewAssignment & {
  reviewer: User;
  submission: SubmissionWithAuthors;
};

// OpenAlex API types
export interface OpenAlexAuthor {
  id: string;
  orcid?: string;
  display_name: string;
  works_count: number;
  cited_by_count: number;
  summary_stats?: {
    h_index: number;
    i10_index: number;
  };
  affiliations?: {
    institution: {
      id: string;
      display_name: string;
      ror?: string;
      country_code?: string;
    };
    years: number[];
  }[];
  last_known_institutions?: {
    id: string;
    display_name: string;
    ror?: string;
    country_code?: string;
  }[];
  topics?: {
    id: string;
    display_name: string;
    count: number;
  }[];
}

export interface OpenAlexWork {
  id: string;
  doi?: string;
  title: string;
  publication_year: number;
  authorships: {
    author_position: "first" | "middle" | "last";
    is_corresponding?: boolean;
    author: {
      id: string;
      display_name: string;
      orcid?: string;
    };
    institutions: {
      id: string;
      display_name: string;
    }[];
  }[];
  cited_by_count: number;
  primary_location?: {
    source?: {
      display_name: string;
      id?: string;
      type?: string;
    };
  };
}

export interface OpenAlexSearchResponse<T> {
  meta: {
    count: number;
    page: number;
    per_page: number;
  };
  results: T[];
}

// COI Report types
export interface COIReport {
  hasConflict: boolean;
  coauthoredPapers: {
    title: string;
    year: number;
    doi?: string;
    openAlexId: string;
  }[];
  sharedInstitutions?: {
    id: string;
    name: string;
    type: "current_both" | "current_one" | "historical";
    years?: number[];
    authorName: string;
  }[];
  checkedAt: string;
  authorId: string;
  reviewerId: string;
}

// Format check types
export interface FormatRule {
  id: string;
  name: string;
  type: "section" | "length" | "reference" | "metadata";
  config: Record<string, unknown>;
  severity: "error" | "warning";
}

export interface FormatIssue {
  ruleId: string;
  ruleName: string;
  severity: "error" | "warning";
  message: string;
  location?: {
    page?: number;
    section?: string;
  };
}
