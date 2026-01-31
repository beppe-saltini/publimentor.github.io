"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

interface Author {
  name: string;
  email: string;
  orcid: string;
  affiliation: string;
}

export default function NewSubmissionPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;

  const [isLoading, setIsLoading] = useState(false);
  const [title, setTitle] = useState("");
  const [abstract, setAbstract] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [authors, setAuthors] = useState<Author[]>([
    { name: "", email: "", orcid: "", affiliation: "" },
  ]);

  const addAuthor = () => {
    setAuthors([...authors, { name: "", email: "", orcid: "", affiliation: "" }]);
  };

  const removeAuthor = (index: number) => {
    if (authors.length > 1) {
      setAuthors(authors.filter((_, i) => i !== index));
    }
  };

  const updateAuthor = (index: number, field: keyof Author, value: string) => {
    const updated = [...authors];
    updated[index][field] = value;
    setAuthors(updated);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.type !== "application/pdf") {
        toast.error("Please select a PDF file");
        return;
      }
      if (file.size > 50 * 1024 * 1024) {
        toast.error("File size must be less than 50MB");
        return;
      }
      setPdfFile(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.append("title", title);
      formData.append("abstract", abstract);
      formData.append("authors", JSON.stringify(authors.filter((a) => a.name)));
      if (pdfFile) {
        formData.append("pdf", pdfFile);
      }

      const response = await fetch(`/api/journals/${slug}/submissions`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create submission");
      }

      toast.success("Submission created successfully");
      router.push(`/dashboard/journals/${slug}/submissions/${data.submission.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create submission");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>New Submission</CardTitle>
            <CardDescription>Submit a new paper to this journal</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                placeholder="Enter the paper title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="abstract">Abstract</Label>
              <Textarea
                id="abstract"
                placeholder="Enter the paper abstract"
                value={abstract}
                onChange={(e) => setAbstract(e.target.value)}
                rows={6}
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="pdf">PDF File</Label>
              <div className="flex items-center gap-4">
                <Input
                  id="pdf"
                  type="file"
                  accept=".pdf"
                  onChange={handleFileChange}
                  disabled={isLoading}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => document.getElementById("pdf")?.click()}
                  disabled={isLoading}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  {pdfFile ? pdfFile.name : "Choose PDF"}
                </Button>
                {pdfFile && (
                  <span className="text-sm text-gray-500">
                    {(pdfFile.size / 1024 / 1024).toFixed(2)} MB
                  </span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Authors</CardTitle>
                <CardDescription>Add authors in order of contribution</CardDescription>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addAuthor}>
                <Plus className="h-4 w-4 mr-2" />
                Add Author
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {authors.map((author, index) => (
              <div key={index} className="border rounded-lg p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Author {index + 1}</span>
                  {authors.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeAuthor(index)}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Name</Label>
                    <Input
                      placeholder="Full name"
                      value={author.name}
                      onChange={(e) => updateAuthor(index, "name", e.target.value)}
                      required
                      disabled={isLoading}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <Input
                      type="email"
                      placeholder="email@example.com"
                      value={author.email}
                      onChange={(e) => updateAuthor(index, "email", e.target.value)}
                      disabled={isLoading}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>ORCID</Label>
                    <Input
                      placeholder="0000-0000-0000-0000"
                      value={author.orcid}
                      onChange={(e) => updateAuthor(index, "orcid", e.target.value)}
                      disabled={isLoading}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Affiliation</Label>
                    <Input
                      placeholder="University or institution"
                      value={author.affiliation}
                      onChange={(e) => updateAuthor(index, "affiliation", e.target.value)}
                      disabled={isLoading}
                    />
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="flex gap-4">
          <Button type="submit" disabled={isLoading}>
            {isLoading ? "Submitting..." : "Submit Paper"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={isLoading}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
