"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Heart, Plus, Trash2, Loader2, BookOpen, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

interface Favourite {
  id: string;
  notes?: string;
  createdAt: string;
  journal: {
    id: string;
    name: string;
    slug: string;
    description?: string;
  };
}

export default function FavouriteJournalsPage() {
  const [favourites, setFavourites] = useState<Favourite[]>([]);
  const [loading, setLoading] = useState(true);
  const [journalName, setJournalName] = useState("");
  const [notes, setNotes] = useState("");
  const [adding, setAdding] = useState(false);

  const fetchFavourites = async () => {
    try {
      const res = await fetch("/api/user/favourites");
      const data = await res.json();
      if (res.ok) {
        setFavourites(data.favourites || []);
      }
    } catch (error) {
      console.error("Failed to fetch favourites:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFavourites();
  }, []);

  const handleAdd = async () => {
    if (!journalName.trim()) {
      toast.error("Please enter a journal name");
      return;
    }

    setAdding(true);
    try {
      const res = await fetch("/api/user/favourites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ journalName: journalName.trim(), notes: notes.trim() || undefined }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to add favourite");
      }

      toast.success(`"${journalName}" added to favourites`);
      setJournalName("");
      setNotes("");
      fetchFavourites();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add");
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (journalId: string, journalName: string) => {
    try {
      const res = await fetch(`/api/user/favourites?journalId=${journalId}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Failed to remove");

      setFavourites((prev) => prev.filter((f) => f.journal.id !== journalId));
      toast.success(`"${journalName}" removed from favourites`);
    } catch {
      toast.error("Failed to remove favourite");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Heart className="h-6 w-6 text-red-500" />
          Favourite Journals
        </h1>
        <p className="text-gray-500 mt-1">
          Save the journals you frequently submit to. When you check formatting,
          PubliMentor can match your manuscript against the right guidelines automatically.
        </p>
      </div>

      {/* Add new favourite */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Add a Journal
          </CardTitle>
          <CardDescription>
            Enter the name of a journal you regularly submit to.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 space-y-1">
              <Label htmlFor="journalName" className="sr-only">Journal Name</Label>
              <Input
                id="journalName"
                placeholder="e.g., The Lancet, PLOS ONE, Nature Communications..."
                value={journalName}
                onChange={(e) => setJournalName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              />
            </div>
            <div className="flex-1 space-y-1">
              <Label htmlFor="notes" className="sr-only">Notes</Label>
              <Input
                id="notes"
                placeholder="Notes (optional) e.g., &quot;Open access, 3000 word limit&quot;"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              />
            </div>
            <Button onClick={handleAdd} disabled={adding || !journalName.trim()}>
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Favourites list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      ) : favourites.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <BookOpen className="h-12 w-12 text-gray-400 mb-4" />
            <CardTitle className="text-lg mb-2">No favourites yet</CardTitle>
            <CardDescription className="text-center">
              Add journals you frequently submit to. This helps PubliMentor
              match formatting guidelines automatically.
            </CardDescription>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {favourites.map((fav) => (
            <Card key={fav.id} className="hover:shadow-md transition-shadow group">
              <CardContent className="pt-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-sm truncate">{fav.journal.name}</h3>
                    {fav.notes && (
                      <p className="text-xs text-gray-500 mt-1">{fav.notes}</p>
                    )}
                    {fav.journal.description && !fav.notes && (
                      <p className="text-xs text-gray-400 mt-1 line-clamp-2">{fav.journal.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      <Link
                        href={`/dashboard/journals/${fav.journal.slug}/format`}
                        className="text-xs text-blue-600 hover:underline flex items-center gap-0.5"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Format Check
                      </Link>
                      <Link
                        href={`/dashboard/journals/${fav.journal.slug}/reviewers`}
                        className="text-xs text-blue-600 hover:underline flex items-center gap-0.5"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Find Reviewers
                      </Link>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-red-500"
                    onClick={() => handleRemove(fav.journal.id, fav.journal.name)}
                    title="Remove from favourites"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {favourites.length > 0 && (
        <p className="text-xs text-gray-400 text-center">
          {favourites.length} favourite journal{favourites.length !== 1 ? "s" : ""} saved
        </p>
      )}
    </div>
  );
}
