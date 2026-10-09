"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { FormatCheckContent } from "@/components/format";

function JournalFormatPage() {
  const params = useParams();
  const slug = typeof params?.slug === "string" ? params.slug : "";
  // Keyed on the slug so switching journals resets the run state.
  return <FormatCheckContent key={slug} journalSlug={slug} />;
}

export default function FormatCheckPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64">Loading...</div>}>
      <JournalFormatPage />
    </Suspense>
  );
}
