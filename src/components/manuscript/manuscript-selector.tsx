"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FileText, Check, Loader2, Upload, X } from "lucide-react";

interface ManuscriptSummary {
  id: string;
  title: string;
  fileName: string;
  fileType: string;
  status: string;
  wordCount?: number;
  authorCount: number;
  createdAt: string;
}

interface ManuscriptSelectorProps {
  value?: string;
  onChange: (manuscript: ManuscriptSummary | null) => void;
  onManuscriptData?: (data: {
    title: string;
    abstract: string;
    keywords: string[];
    authors: Array<{ name: string; email?: string; affiliation?: string }>;
  }) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function ManuscriptSelector({
  value,
  onChange,
  onManuscriptData,
  placeholder = "Select a manuscript",
  disabled = false,
}: ManuscriptSelectorProps) {
  const [open, setOpen] = useState(false);
  const [manuscripts, setManuscripts] = useState<ManuscriptSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<ManuscriptSummary | null>(null);

  // Fetch manuscripts when dialog opens
  useEffect(() => {
    if (open && manuscripts.length === 0) {
      fetchManuscripts();
    }
  }, [open]);

  // Fetch selected manuscript details when value changes
  useEffect(() => {
    if (value && !selected) {
      fetchManuscriptDetails(value);
    }
  }, [value]);

  const fetchManuscripts = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/manuscripts?status=READY&limit=50");
      const data = await response.json();
      if (response.ok) {
        setManuscripts(data.manuscripts);
      }
    } catch (error) {
      console.error("Failed to fetch manuscripts:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchManuscriptDetails = async (id: string) => {
    try {
      const response = await fetch(`/api/manuscripts/${id}`);
      const data = await response.json();
      
      if (response.ok && data.manuscript) {
        const m = data.manuscript;
        setSelected({
          id: m.id,
          title: m.title || m.fileName,
          fileName: m.fileName,
          fileType: m.fileType,
          status: m.status,
          wordCount: m.wordCount,
          authorCount: m.authors?.length || 0,
          createdAt: m.createdAt,
        });

        // Pass manuscript data to parent
        if (onManuscriptData) {
          onManuscriptData({
            title: m.title || "",
            abstract: m.abstract || "",
            keywords: m.keywords || [],
            authors: m.authors?.map((a: any) => ({
              name: a.fullName,
              email: a.email,
              affiliation: m.affiliations?.find((aff: any) => 
                a.affiliationNums?.includes(aff.affiliationNumber)
              )?.rawText,
            })) || [],
          });
        }
      }
    } catch (error) {
      console.error("Failed to fetch manuscript details:", error);
    }
  };

  const handleSelect = async (manuscript: ManuscriptSummary) => {
    setSelected(manuscript);
    onChange(manuscript);
    setOpen(false);

    // Fetch full details for parent
    if (onManuscriptData) {
      fetchManuscriptDetails(manuscript.id);
    }
  };

  const handleClear = () => {
    setSelected(null);
    onChange(null);
  };

  return (
    <div className="space-y-2">
      {selected ? (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-blue-600" />
                <div>
                  <p className="font-medium text-sm">{selected.title}</p>
                  <p className="text-xs text-gray-500">
                    {selected.fileName} • {selected.wordCount?.toLocaleString() || "?"} words
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClear}
                disabled={disabled}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" className="w-full justify-start" disabled={disabled}>
              <Upload className="h-4 w-4 mr-2" />
              {placeholder}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Select Manuscript</DialogTitle>
              <DialogDescription>
                Choose a manuscript to use as input for this workflow
              </DialogDescription>
            </DialogHeader>

            {loading ? (
              <div className="py-8 text-center">
                <Loader2 className="h-8 w-8 mx-auto animate-spin text-gray-400" />
                <p className="mt-2 text-gray-500">Loading manuscripts...</p>
              </div>
            ) : manuscripts.length === 0 ? (
              <div className="py-8 text-center">
                <FileText className="h-12 w-12 mx-auto text-gray-300 mb-4" />
                <p className="text-gray-500">No manuscripts available</p>
                <p className="text-sm text-gray-400 mt-1">
                  Upload a manuscript first to use it here
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {manuscripts.map((m) => (
                  <Card
                    key={m.id}
                    className={`cursor-pointer hover:border-blue-300 transition-colors ${
                      selected?.id === m.id ? "border-blue-500 bg-blue-50" : ""
                    }`}
                    onClick={() => handleSelect(m)}
                  >
                    <CardContent className="py-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <FileText className="h-5 w-5 text-gray-400" />
                          <div>
                            <p className="font-medium text-sm">{m.title}</p>
                            <p className="text-xs text-gray-500">
                              {m.fileName} • {m.authorCount} authors • {new Date(m.createdAt).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="uppercase text-xs">
                            {m.fileType}
                          </Badge>
                          {selected?.id === m.id && (
                            <Check className="h-5 w-5 text-blue-600" />
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
