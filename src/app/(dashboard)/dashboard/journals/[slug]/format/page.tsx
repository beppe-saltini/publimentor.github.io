"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { FormatCheckContent } from "@/components/format/format-check-content";

function JournalFormatPage() {
  const params = useParams();
  const slug = params.slug as string;
  return <FormatCheckContent journalSlug={slug} />;
}

export default function FormatCheckPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64">Loading...</div>}>
      <JournalFormatPage />
    </Suspense>
  );
}
