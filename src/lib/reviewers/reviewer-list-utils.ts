export type ReviewerFlag = "up" | "down" | null;

export type DbReviewerIndex = Record<string, { id: string; status: string }>;

export interface ExpertiseCoverageInfo {
  reviewerIds: string[];
  reviewerNames: string[];
}

export interface ExpertiseCoverageResult {
  coverage: Record<string, ExpertiseCoverageInfo>;
  coveredExpertise: string[];
  uncoveredExpertise: string[];
}

export interface ReviewerWithName {
  id: string;
  name: string;
  isNewThisRun?: boolean;
}

export function normalizeReviewerName(name: string): string {
  return name.trim().toLowerCase();
}

export function computeExpertiseCoverage(
  manuscriptExpertise: string[],
  assignedExpertise: Record<string, string[]>,
  reviewerIds: string[],
  reviewerNamesById: Record<string, string>
): ExpertiseCoverageResult {
  const coverage: Record<string, ExpertiseCoverageInfo> = {};
  for (const exp of manuscriptExpertise) {
    coverage[exp] = { reviewerIds: [], reviewerNames: [] };
  }
  for (const reviewerId of reviewerIds) {
    const assigned = assignedExpertise[reviewerId] || [];
    const name = reviewerNamesById[reviewerId] || "";
    for (const exp of assigned) {
      if (coverage[exp]) {
        coverage[exp].reviewerIds.push(reviewerId);
        if (name) coverage[exp].reviewerNames.push(name);
      }
    }
  }
  const coveredExpertise = manuscriptExpertise.filter(
    (e) => (coverage[e]?.reviewerIds.length || 0) > 0
  );
  const uncoveredExpertise = manuscriptExpertise.filter(
    (e) => (coverage[e]?.reviewerIds.length || 0) === 0
  );
  return { coverage, coveredExpertise, uncoveredExpertise };
}

export function buildFlagsFromDbReviewers(
  reviewers: Array<{ id: string; status: string }>
): Record<string, ReviewerFlag> {
  const flags: Record<string, ReviewerFlag> = {};
  for (const r of reviewers) {
    if (r.status === "SHORTLISTED") flags[r.id] = "up";
    else if (r.status === "REJECTED") flags[r.id] = "down";
  }
  return flags;
}

export function isReviewerRejected(
  reviewer: ReviewerWithName,
  flags: Record<string, ReviewerFlag>,
  dbIndex: DbReviewerIndex
): boolean {
  const key = normalizeReviewerName(reviewer.name);
  if (flags[reviewer.id] === "down") return true;
  const db = dbIndex[key];
  return db?.status === "REJECTED";
}

export function filterActiveReviewers<T extends ReviewerWithName>(
  reviewers: T[],
  flags: Record<string, ReviewerFlag>,
  dbIndex: DbReviewerIndex
): T[] {
  return reviewers.filter((r) => !isReviewerRejected(r, flags, dbIndex));
}

/** Merge by normalized name; incoming enriches existing, keeps stable DB id when present. */
export function mergeReviewerLists<T extends ReviewerWithName>(
  existing: T[],
  incoming: T[]
): T[] {
  const merged = new Map<string, T>();
  for (const r of existing) {
    merged.set(normalizeReviewerName(r.name), r);
  }
  for (const r of incoming) {
    const key = normalizeReviewerName(r.name);
    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, r);
      continue;
    }
    merged.set(key, {
      ...prev,
      ...r,
      id: prev.id.startsWith("pubmed_") || prev.id.startsWith("openalex_")
        ? r.id
        : prev.id,
      isNewThisRun: r.isNewThisRun ?? prev.isNewThisRun,
    });
  }
  return Array.from(merged.values());
}

export function tagNewReviewers<T extends ReviewerWithName>(
  reviewers: T[],
  knownNamesBeforeRun: Set<string>
): T[] {
  return reviewers.map((r) => ({
    ...r,
    isNewThisRun: !knownNamesBeforeRun.has(normalizeReviewerName(r.name)),
  }));
}

export function computeFocusKeywords(
  manuscriptExpertise: string[],
  coveredExpertise: string[],
  uncoveredExpertise: string[]
): string[] {
  if (uncoveredExpertise.length > 0 && coveredExpertise.length > 0) {
    return uncoveredExpertise;
  }
  return manuscriptExpertise;
}

/**
 * Sort: (1) expertise assigned, (2) shortlisted, (3) new this run, (4) other.
 */
export function reviewerDisplaySortRank(
  reviewer: ReviewerWithName,
  assignedExpertise: Record<string, string[]>,
  flags: Record<string, ReviewerFlag>,
  dbIndex: DbReviewerIndex,
  newThisRunNames?: Set<string>
): number {
  const hasExpertise = (assignedExpertise[reviewer.id] || []).length > 0;
  if (hasExpertise) return 0;

  const key = normalizeReviewerName(reviewer.name);
  const isShortlisted =
    flags[reviewer.id] === "up" || dbIndex[key]?.status === "SHORTLISTED";
  if (isShortlisted) return 1;

  const isNew =
    reviewer.isNewThisRun === true ||
    (newThisRunNames?.has(key) ?? false);
  if (isNew) return 2;

  return 3;
}

export function sortReviewersDisplayOrder<T extends ReviewerWithName>(
  reviewers: T[],
  options: {
    assignedExpertise: Record<string, string[]>;
    flags: Record<string, ReviewerFlag>;
    dbIndex: DbReviewerIndex;
    newThisRunNames?: Set<string>;
  }
): T[] {
  const { assignedExpertise, flags, dbIndex, newThisRunNames } = options;
  return [...reviewers].sort(
    (a, b) =>
      reviewerDisplaySortRank(a, assignedExpertise, flags, dbIndex, newThisRunNames) -
      reviewerDisplaySortRank(b, assignedExpertise, flags, dbIndex, newThisRunNames)
  );
}

export function collectKnownReviewerNames(
  reviewers: Array<{ name: string }>
): Set<string> {
  return new Set(reviewers.map((r) => normalizeReviewerName(r.name)));
}
