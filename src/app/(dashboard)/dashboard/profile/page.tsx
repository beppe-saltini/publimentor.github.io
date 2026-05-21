"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ArrowLeft, User } from "lucide-react";
import { toast } from "sonner";

interface UserProfile {
  id: string;
  name: string | null;
  email: string;
  role: string | null;
  institution: string | null;
  orcid: string | null;
  primaryExpertise: string | null;
  secondaryExpertise: string | null;
}

export default function ProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [role, setRole] = useState("");
  const [institution, setInstitution] = useState("");
  const [primaryExpertise, setPrimaryExpertise] = useState("");
  const [secondaryExpertise, setSecondaryExpertise] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/user/profile");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load profile");
        const user = data.user as UserProfile;
        setProfile(user);
        setRole(user.role || "");
        setInstitution(user.institution || "");
        setPrimaryExpertise(user.primaryExpertise || "");
        setSecondaryExpertise(user.secondaryExpertise || "");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to load profile");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: role || undefined,
          institution: institution.trim() || undefined,
          primaryExpertise: primaryExpertise.trim() || undefined,
          secondaryExpertise: secondaryExpertise.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save profile");
      setProfile(data.user);
      toast.success("Profile updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const backHref =
    profile?.role === "EDITOR" ? "/dashboard/editor/reviewers" : "/dashboard";

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!profile) {
    return (
      <Card className="max-w-md mx-auto">
        <CardContent className="pt-6">
          <p className="text-sm text-gray-600">Could not load your profile.</p>
          <Button variant="outline" className="mt-4" onClick={() => router.push(backHref)}>
            Go back
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href={backHref}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Profile
          </CardTitle>
          <CardDescription>Your account details and research profile</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={profile.name || ""} disabled className="bg-gray-50" />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={profile.email} disabled className="bg-gray-50" />
            </div>
            {profile.orcid && (
              <div className="space-y-2">
                <Label>ORCID</Label>
                <Input value={profile.orcid} disabled className="bg-gray-50 font-mono text-sm" />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger id="role">
                  <SelectValue placeholder="Select your role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="AUTHOR">Author</SelectItem>
                  <SelectItem value="EDITOR">Editor</SelectItem>
                  <SelectItem value="PUBLISHER">Publisher</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="institution">Institution</Label>
              <Input
                id="institution"
                value={institution}
                onChange={(e) => setInstitution(e.target.value)}
                placeholder="University or organization"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="primaryExpertise">Primary expertise</Label>
              <Input
                id="primaryExpertise"
                value={primaryExpertise}
                onChange={(e) => setPrimaryExpertise(e.target.value)}
                placeholder="e.g., infectious disease epidemiology"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="secondaryExpertise">Secondary expertise</Label>
              <Input
                id="secondaryExpertise"
                value={secondaryExpertise}
                onChange={(e) => setSecondaryExpertise(e.target.value)}
                placeholder="Optional second research area"
              />
            </div>

            <Button type="submit" disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save changes"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
