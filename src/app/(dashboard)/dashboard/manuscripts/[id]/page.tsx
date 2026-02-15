"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { 
  FileText, ArrowLeft, Clock, CheckCircle, XCircle, Loader2, 
  Users, BookOpen, Building, Mail, ExternalLink, Download, Search, AlertTriangle
} from "lucide-react";

interface Author {
  id: string;
  fullName: string;
  email?: string;
  orcid?: string;
  authorOrder: number;
  isCorresponding: boolean;
  affiliationNums: number[];
}

interface Affiliation {
  id: string;
  affiliationNumber: number;
  rawText: string;
  institutionName?: string;
  country?: string;
}

interface Reference {
  id: string;
  refNumber: number;
  rawText: string;
  authors?: string;
  title?: string;
  journal?: string;
  year?: number;
  doi?: string;
}

interface Manuscript {
  id: string;
  title?: string;
  abstract?: string;
  keywords: string[];
  manuscriptType?: string;
  language?: string;
  status: string;
  statusMessage?: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  wordCount?: number;
  pageCount?: number;
  figureCount?: number;
  tableCount?: number;
  referenceCount: number;
  chunkCount: number;
  declarations: {
    funding?: string;
    conflictOfInterest?: string;
    dataAvailability?: string;
    ethics?: string;
    authorContributions?: string;
  };
  publisher: { id: string; name: string; slug: string };
  journal?: { id: string; name: string; slug: string };
  uploader: { id: string; name: string; email: string };
  authors: Author[];
  affiliations: Affiliation[];
  references: Reference[];
  processingStarted?: string;
  processingEnded?: string;
  createdAt: string;
  updatedAt: string;
}

export default function ManuscriptDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [manuscript, setManuscript] = useState<Manuscript | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [defaultJournalSlug, setDefaultJournalSlug] = useState<string | null>(null);

  useEffect(() => {
    async function fetchManuscript() {
      try {
        const response = await fetch(`/api/manuscripts/${params.id}`);
        const data = await response.json();
        
        if (!response.ok) {
          throw new Error(data.error || "Failed to load manuscript");
        }
        
        setManuscript(data.manuscript);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load manuscript");
      } finally {
        setLoading(false);
      }
    }

    async function fetchDefaultJournal() {
      try {
        const response = await fetch("/api/journals");
        const data = await response.json();
        if (response.ok && data.journals?.length > 0) {
          setDefaultJournalSlug(data.journals[0].slug);
        }
      } catch {
        // Silently fail
      }
    }

    if (params.id) {
      fetchManuscript();
      fetchDefaultJournal();
    }
  }, [params.id]);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "READY":
        return <Badge className="bg-green-100 text-green-700">Ready</Badge>;
      case "PROCESSING":
      case "EXTRACTING":
      case "EMBEDDING":
        return <Badge className="bg-blue-100 text-blue-700">Processing</Badge>;
      case "ERROR":
        return <Badge className="bg-red-100 text-red-700">Error</Badge>;
      default:
        return <Badge className="bg-gray-100 text-gray-700">{status}</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto py-8 px-4 max-w-6xl">
        <Card>
          <CardContent className="py-12 text-center">
            <Loader2 className="h-8 w-8 mx-auto animate-spin text-gray-400" />
            <p className="mt-2 text-gray-500">Loading manuscript...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !manuscript) {
    return (
      <div className="container mx-auto py-8 px-4 max-w-6xl">
        <Card>
          <CardContent className="py-12 text-center">
            <XCircle className="h-12 w-12 mx-auto text-red-400 mb-4" />
            <h3 className="text-lg font-medium text-gray-700">{error || "Manuscript not found"}</h3>
            <Button variant="outline" className="mt-4" onClick={() => router.back()}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Go Back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4 max-w-6xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <Button variant="ghost" size="sm" onClick={() => router.back()} className="mb-2">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <h1 className="text-2xl font-bold">{manuscript.title || manuscript.fileName}</h1>
          <div className="flex items-center gap-3 mt-2 text-sm text-gray-500">
            {getStatusBadge(manuscript.status)}
            <span>{manuscript.manuscriptType || "Document"}</span>
            <span>•</span>
            <span>{formatSize(manuscript.fileSize)}</span>
            <span>•</span>
            <span>Uploaded {new Date(manuscript.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline"
            onClick={() => window.open(`/api/manuscripts/${manuscript.id}/download`, '_blank')}
          >
            <Download className="h-4 w-4 mr-2" />
            Download
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              const journalSlug = manuscript.journal?.slug || defaultJournalSlug;
              if (journalSlug) {
                router.push(`/dashboard/journals/${journalSlug}/coi`);
              } else {
                toast.error("Please create a journal first to use COI screening");
              }
            }}
          >
            <AlertTriangle className="h-4 w-4 mr-2" />
            COI Check
          </Button>
          <Button
            onClick={() => {
              const journalSlug = manuscript.journal?.slug || defaultJournalSlug;
              if (journalSlug) {
                router.push(`/dashboard/journals/${journalSlug}/reviewers?manuscriptId=${manuscript.id}`);
              } else {
                toast.error("Please create a journal first to find reviewers");
              }
            }}
          >
            <Search className="h-4 w-4 mr-2" />
            Find Reviewers
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-2xl font-bold text-blue-600">{manuscript.wordCount?.toLocaleString() || "—"}</p>
            <p className="text-sm text-gray-500">Words</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-2xl font-bold text-blue-600">{manuscript.pageCount || "—"}</p>
            <p className="text-sm text-gray-500">Pages</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-2xl font-bold text-blue-600">{manuscript.authors.length}</p>
            <p className="text-sm text-gray-500">Authors</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-2xl font-bold text-blue-600">{manuscript.referenceCount}</p>
            <p className="text-sm text-gray-500">References</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-2xl font-bold text-blue-600">{manuscript.figureCount || 0}</p>
            <p className="text-sm text-gray-500">Figures</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="authors">Authors ({manuscript.authors.length})</TabsTrigger>
          <TabsTrigger value="references">References ({manuscript.referenceCount})</TabsTrigger>
          <TabsTrigger value="declarations">Declarations</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="mt-4 space-y-4">
          {manuscript.abstract && (
            <Card>
              <CardHeader>
                <CardTitle>Abstract</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-700 whitespace-pre-wrap">{manuscript.abstract}</p>
              </CardContent>
            </Card>
          )}

          {manuscript.keywords.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Keywords</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {manuscript.keywords.map((keyword, i) => (
                    <Badge key={i} variant="secondary">{keyword}</Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>File Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">File Name</span>
                <span>{manuscript.fileName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">File Type</span>
                <span className="uppercase">{manuscript.fileType}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">File Size</span>
                <span>{formatSize(manuscript.fileSize)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Publisher</span>
                <span>{manuscript.publisher.name}</span>
              </div>
              {manuscript.journal && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Journal</span>
                  <span>{manuscript.journal.name}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500">Uploaded By</span>
                <span>{manuscript.uploader.name}</span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Authors Tab */}
        <TabsContent value="authors" className="mt-4 space-y-4">
          {manuscript.authors.map((author) => (
            <Card key={author.id}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{author.fullName}</span>
                      {author.isCorresponding && (
                        <Badge variant="outline" className="text-xs">Corresponding</Badge>
                      )}
                      <span className="text-gray-400 text-sm">#{author.authorOrder}</span>
                    </div>
                    {author.email && (
                      <div className="flex items-center gap-1 text-sm text-gray-500 mt-1">
                        <Mail className="h-3 w-3" />
                        {author.email}
                      </div>
                    )}
                    {author.affiliationNums.length > 0 && (
                      <div className="text-sm text-gray-500 mt-1">
                        Affiliations: {author.affiliationNums.join(", ")}
                      </div>
                    )}
                  </div>
                  {author.orcid && (
                    <a
                      href={`https://orcid.org/${encodeURIComponent(author.orcid)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-green-600 hover:underline text-sm flex items-center gap-1"
                    >
                      ORCID <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}

          {manuscript.affiliations.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building className="h-5 w-5" />
                  Affiliations
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {manuscript.affiliations.map((aff) => (
                  <div key={aff.id} className="text-sm">
                    <span className="font-medium text-gray-700">{aff.affiliationNumber}.</span>{" "}
                    {aff.rawText}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* References Tab */}
        <TabsContent value="references" className="mt-4">
          <Card>
            <CardContent className="py-4 space-y-3">
              {manuscript.references.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No references extracted</p>
              ) : (
                manuscript.references.map((ref) => (
                  <div key={ref.id} className="text-sm border-b pb-2 last:border-0">
                    <span className="font-medium text-gray-700">[{ref.refNumber}]</span>{" "}
                    <span className="text-gray-600">{ref.rawText}</span>
                    {ref.doi && (
                      <a
                        href={`https://doi.org/${encodeURIComponent(ref.doi)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-2 text-blue-600 hover:underline"
                      >
                        DOI
                      </a>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Declarations Tab */}
        <TabsContent value="declarations" className="mt-4 space-y-4">
          {manuscript.declarations.funding && (
            <Card>
              <CardHeader>
                <CardTitle>Funding</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-700">{manuscript.declarations.funding}</p>
              </CardContent>
            </Card>
          )}

          {manuscript.declarations.conflictOfInterest && (
            <Card>
              <CardHeader>
                <CardTitle>Conflict of Interest</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-700">{manuscript.declarations.conflictOfInterest}</p>
              </CardContent>
            </Card>
          )}

          {manuscript.declarations.ethics && (
            <Card>
              <CardHeader>
                <CardTitle>Ethics Statement</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-700">{manuscript.declarations.ethics}</p>
              </CardContent>
            </Card>
          )}

          {manuscript.declarations.dataAvailability && (
            <Card>
              <CardHeader>
                <CardTitle>Data Availability</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-700">{manuscript.declarations.dataAvailability}</p>
              </CardContent>
            </Card>
          )}

          {manuscript.declarations.authorContributions && (
            <Card>
              <CardHeader>
                <CardTitle>Author Contributions</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-700">{manuscript.declarations.authorContributions}</p>
              </CardContent>
            </Card>
          )}

          {!manuscript.declarations.funding && 
           !manuscript.declarations.conflictOfInterest && 
           !manuscript.declarations.ethics && 
           !manuscript.declarations.dataAvailability &&
           !manuscript.declarations.authorContributions && (
            <Card>
              <CardContent className="py-8 text-center text-gray-500">
                No declarations found in this manuscript
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
