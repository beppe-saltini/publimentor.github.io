"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

interface JournalSettings {
  name: string;
  description: string;
}

export default function JournalSettingsPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [settings, setSettings] = useState<JournalSettings>({
    name: "",
    description: "",
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const fetchJournal = async () => {
      try {
        const response = await fetch(`/api/journals/${slug}`);
        const data = await response.json();
        if (response.ok) {
          setSettings({
            name: data.journal.name,
            description: data.journal.description || "",
          });
        }
      } catch (error) {
        console.error("Failed to fetch journal:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchJournal();
  }, [slug]);

  const handleSave = async () => {
    setIsSaving(true);

    try {
      const response = await fetch(`/api/journals/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to save settings");
      }

      toast.success("Settings saved successfully");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save settings");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-64">Loading...</div>;
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Journal Settings</h1>
        <p className="text-gray-500">Manage your journal&apos;s configuration</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>General Settings</CardTitle>
          <CardDescription>Basic information about your journal</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Journal Name</Label>
            <Input
              id="name"
              value={settings.name}
              onChange={(e) => setSettings({ ...settings, name: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={settings.description}
              onChange={(e) => setSettings({ ...settings, description: e.target.value })}
              rows={4}
            />
          </div>

          <Separator />

          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save Changes"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Format Guidelines</CardTitle>
          <CardDescription>
            Configure format requirements for submissions (coming soon)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500">
            Custom format guidelines configuration will be available in a future update.
            Currently using default academic paper guidelines.
          </p>
        </CardContent>
      </Card>

      <Card className="border-red-200">
        <CardHeader>
          <CardTitle className="text-red-600">Danger Zone</CardTitle>
          <CardDescription>Irreversible actions for this journal</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" disabled>
            Delete Journal
          </Button>
          <p className="text-xs text-gray-500 mt-2">
            Journal deletion is disabled. Contact support if you need to delete a journal.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
