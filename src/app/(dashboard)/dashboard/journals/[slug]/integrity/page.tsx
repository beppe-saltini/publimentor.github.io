"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { IntegrityCheckContent } from "@/components/integrity/integrity-check-content";

function JournalIntegrityPage() {
  const params = useParams();
  const slug = params.slug as string;
  return <IntegrityCheckContent journalSlug={slug} />;
}

export default function IntegrityCheckPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64">Loading...</div>}>
      <JournalIntegrityPage />
    </Suspense>
  );
}
