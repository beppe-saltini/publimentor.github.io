"use client";

import { useState, useEffect } from "react";

export interface EditorContextData {
  hasJournal: boolean;
  journalId: string | null;
  journalSlug: string | null;
  publisherId: string | null;
  loading: boolean;
}

export function useEditorContext(): EditorContextData {
  const [data, setData] = useState<EditorContextData>({
    hasJournal: false,
    journalId: null,
    journalSlug: null,
    publisherId: null,
    loading: true,
  });

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/editor/context");
        const json = await res.json();
        if (res.ok) {
          setData({
            hasJournal: json.hasJournal ?? false,
            journalId: json.journalId ?? null,
            journalSlug: json.journalSlug ?? null,
            publisherId: json.publisherId ?? null,
            loading: false,
          });
        } else {
          setData((prev) => ({ ...prev, loading: false }));
        }
      } catch {
        setData((prev) => ({ ...prev, loading: false }));
      }
    };
    load();
  }, []);

  return data;
}
