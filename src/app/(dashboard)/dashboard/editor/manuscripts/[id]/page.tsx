"use client";

import { useParams } from "next/navigation";
import { ManuscriptDetailContent } from "@/components/manuscript/manuscript-detail-content";
import { useEditorContext } from "@/hooks/use-editor-context";

export default function EditorManuscriptDetailPage() {
  const params = useParams();
  const manuscriptId = params.id as string;
  const { journalSlug } = useEditorContext();

  return (
    <ManuscriptDetailContent
      manuscriptId={manuscriptId}
      journalSlug={journalSlug}
      showPageContainer={false}
      routes={{
        listHref: "/dashboard/editor/manuscripts",
        reviewersHref: (id) => `/dashboard/editor/reviewers?manuscriptId=${id}`,
        coiHref: "/dashboard/editor/coi",
        coiReturnUrl: (id) => `/dashboard/editor/manuscripts/${id}`,
      }}
    />
  );
}
