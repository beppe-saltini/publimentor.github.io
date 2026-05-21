"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { CoiCheckContent } from "@/components/coi/coi-check-content";

function JournalCoiPage() {
  const params = useParams();
  const slug = params.slug as string;

  return <CoiCheckContent journalSlug={slug} />;
}

export default function COICheckPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64">Loading...</div>}>
      <JournalCoiPage />
    </Suspense>
  );
}
