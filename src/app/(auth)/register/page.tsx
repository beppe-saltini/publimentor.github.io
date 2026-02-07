"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function RegisterPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    institution: "",
    orcid: "",
    role: "",
    gender: "",
    primaryExpertise: "",
    secondaryExpertise: "",
  });
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  const handleSelectChange = (name: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    if (formData.password !== formData.confirmPassword) {
      setError("Passwords do not match");
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email,
          password: formData.password,
          institution: formData.institution || undefined,
          orcid: formData.orcid || undefined,
          role: formData.role || undefined,
          gender: formData.gender || undefined,
          primaryExpertise: formData.primaryExpertise || undefined,
          secondaryExpertise: formData.secondaryExpertise || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Registration failed");
      }

      router.push("/login?registered=true");
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <Link href="/" className="flex flex-col items-center mb-8">
        <Image
          src="/logo.png"
          alt="PubliMentor"
          width={80}
          height={80}
          className="h-20 w-20 mb-2"
        />
        <span className="text-2xl font-bold text-[#1a3a5c]">PubliMentor</span>
      </Link>
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">Create an account</CardTitle>
          <CardDescription className="text-center">
            Sign up for PubliMentor to manage your editorial workflow
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-50 text-red-600 text-sm p-3 rounded-md">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="name">Full Name</Label>
              <Input
                id="name"
                name="name"
                type="text"
                placeholder="Dr. Jane Smith"
                value={formData.name}
                onChange={handleChange}
                required
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="name@university.edu"
                value={formData.email}
                onChange={handleChange}
                required
                disabled={isLoading}
              />
            </div>

            {/* Role Selection */}
            <div className="space-y-2">
              <Label htmlFor="role">I am a...</Label>
              <Select
                value={formData.role}
                onValueChange={(value) => handleSelectChange("role", value)}
                disabled={isLoading}
              >
                <SelectTrigger id="role">
                  <SelectValue placeholder="Select your primary role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="AUTHOR">Author</SelectItem>
                  <SelectItem value="EDITOR">Editor</SelectItem>
                  <SelectItem value="PUBLISHER">Publisher</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Gender */}
            <div className="space-y-2">
              <Label htmlFor="gender">Gender</Label>
              <Select
                value={formData.gender}
                onValueChange={(value) => handleSelectChange("gender", value)}
                disabled={isLoading}
              >
                <SelectTrigger id="gender">
                  <SelectValue placeholder="Select gender" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FEMALE">Female</SelectItem>
                  <SelectItem value="MALE">Male</SelectItem>
                  <SelectItem value="NON_BINARY">Non-binary</SelectItem>
                  <SelectItem value="PREFER_NOT_TO_SAY">Prefer not to say</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="institution">Institution (optional)</Label>
              <Input
                id="institution"
                name="institution"
                type="text"
                placeholder="University of Science"
                value={formData.institution}
                onChange={handleChange}
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="orcid">ORCID (optional)</Label>
              <Input
                id="orcid"
                name="orcid"
                type="text"
                placeholder="0000-0002-1234-5678"
                value={formData.orcid}
                onChange={handleChange}
                disabled={isLoading}
              />
            </div>

            {/* Expertise fields */}
            <div className="space-y-2">
              <Label htmlFor="primaryExpertise">Primary Expertise (optional)</Label>
              <Input
                id="primaryExpertise"
                name="primaryExpertise"
                type="text"
                placeholder="e.g., Infectious Disease Epidemiology"
                value={formData.primaryExpertise}
                onChange={handleChange}
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="secondaryExpertise">Secondary Expertise (optional)</Label>
              <Input
                id="secondaryExpertise"
                name="secondaryExpertise"
                type="text"
                placeholder="e.g., Mathematical Modelling"
                value={formData.secondaryExpertise}
                onChange={handleChange}
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                value={formData.password}
                onChange={handleChange}
                required
                disabled={isLoading}
                minLength={8}
              />
              <p className="text-xs text-gray-500">Must be at least 10 characters with uppercase, lowercase, number, and special character</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                value={formData.confirmPassword}
                onChange={handleChange}
                required
                disabled={isLoading}
              />
            </div>

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? "Creating account..." : "Create account"}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="flex flex-col space-y-2">
          <div className="text-sm text-center text-gray-600">
            Already have an account?{" "}
            <Link href="/login" className="text-blue-600 hover:underline">
              Sign in
            </Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
