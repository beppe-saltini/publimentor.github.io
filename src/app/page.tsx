import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, AlertTriangle, FileCheck, ArrowRight, BookOpen } from "lucide-react";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      {/* Header */}
      <header className="border-b bg-white">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <Image
              src="/logo.png"
              alt="PubliMentor"
              width={48}
              height={48}
              className="h-12 w-12"
            />
            <span className="text-xl font-bold text-[#1a3a5c]">PubliMentor</span>
          </Link>
          <div className="flex items-center gap-4">
            <Button variant="ghost" asChild>
              <Link href="/login">Sign In</Link>
            </Button>
            <Button asChild>
              <Link href="/register">Get Started</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="container mx-auto px-4 py-24 text-center">
        <h1 className="text-5xl font-bold text-gray-900 mb-6">
          Scientific Editorial Workflow
          <br />
          <span className="text-[#1a3a5c]">Made Simple</span>
        </h1>
        <p className="text-xl text-gray-600 max-w-2xl mx-auto mb-8">
          Streamline your journal management with intelligent reviewer matching,
          automated conflict of interest detection, and format compliance checking.
        </p>
        <div className="flex justify-center gap-4">
          <Button size="lg" asChild>
            <Link href="/register">
              Start Free Trial
              <ArrowRight className="ml-2 h-5 w-5" />
            </Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href="/login">Sign In</Link>
          </Button>
        </div>
      </section>

      {/* Features */}
      <section className="container mx-auto px-4 py-16">
        <h2 className="text-3xl font-bold text-center mb-12">
          Everything You Need to Manage Your Journal
        </h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <Users className="h-10 w-10 text-[#1a3a5c] mb-2" />
              <CardTitle>Find Reviewers</CardTitle>
              <CardDescription>
                Search millions of researchers using OpenAlex to find the perfect reviewers
                for your submissions
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <AlertTriangle className="h-10 w-10 text-[#1a3a5c] mb-2" />
              <CardTitle>COI Detection</CardTitle>
              <CardDescription>
                Automatically detect conflicts of interest by analyzing co-authorship
                history between authors and reviewers
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <FileCheck className="h-10 w-10 text-[#1a3a5c] mb-2" />
              <CardTitle>Format Checking</CardTitle>
              <CardDescription>
                Verify that submissions meet your journal&apos;s formatting guidelines
                before entering review
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <BookOpen className="h-10 w-10 text-[#1a3a5c] mb-2" />
              <CardTitle>Multi-Journal</CardTitle>
              <CardDescription>
                Manage multiple journals from a single platform with role-based access
                control for your team
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-gray-50 py-16">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-center mb-12">How It Works</h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="bg-[#e8f0f5] rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl font-bold text-[#1a3a5c]">1</span>
              </div>
              <h3 className="text-xl font-semibold mb-2">Create Your Journal</h3>
              <p className="text-gray-600">
                Set up your journal with custom formatting guidelines and invite your
                editorial team
              </p>
            </div>
            <div className="text-center">
              <div className="bg-[#e8f0f5] rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl font-bold text-[#1a3a5c]">2</span>
              </div>
              <h3 className="text-xl font-semibold mb-2">Receive Submissions</h3>
              <p className="text-gray-600">
                Authors submit papers which are automatically checked for format
                compliance
              </p>
            </div>
            <div className="text-center">
              <div className="bg-[#e8f0f5] rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl font-bold text-[#1a3a5c]">3</span>
              </div>
              <h3 className="text-xl font-semibold mb-2">Manage Reviews</h3>
              <p className="text-gray-600">
                Find qualified reviewers, check for conflicts, and manage the entire
                review process
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="container mx-auto px-4 py-24 text-center">
        <Card className="bg-[#1a3a5c] text-white border-0 max-w-2xl mx-auto">
          <CardContent className="py-12">
            <h2 className="text-3xl font-bold mb-4">
              Ready to Streamline Your Editorial Workflow?
            </h2>
            <p className="text-blue-100 mb-8">
              Join thousands of journals using PubliMentor to manage their peer review process.
            </p>
            <Button size="lg" variant="secondary" asChild>
              <Link href="/register">
                Get Started for Free
                <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </section>

      {/* Footer */}
      <footer className="border-t bg-white py-8">
        <div className="container mx-auto px-4 text-center text-gray-500">
          <div className="flex items-center justify-center gap-3 mb-4">
            <Image
              src="/logo.png"
              alt="PubliMentor"
              width={32}
              height={32}
              className="h-8 w-8"
            />
            <span className="font-semibold text-[#1a3a5c]">PubliMentor</span>
          </div>
          <p className="text-sm">
            &copy; {new Date().getFullYear()} PubliMentor Publishing Consulting. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
