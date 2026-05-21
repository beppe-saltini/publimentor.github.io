"use client";

import { useParams } from "next/navigation";
import { ManuscriptDetailContent } from "@/components/manuscript/manuscript-detail-content";

export default function ManuscriptDetailPage() {
  const params = useParams();
  const manuscriptId = params.id as string;

  return <ManuscriptDetailContent manuscriptId={manuscriptId} />;
}
