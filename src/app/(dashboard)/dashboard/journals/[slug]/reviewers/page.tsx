"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { ReviewerSearchContent } from "@/components/reviewers/reviewer-search-content";

function JournalReviewerSearchPage() {
  const params = useParams();
  const slug = params.slug as string;

  return <ReviewerSearchContent journalSlug={slug} />;
}

export default function ReviewerSearchPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64">Loading...</div>}>
      <JournalReviewerSearchPage />
    </Suspense>
  );
}
