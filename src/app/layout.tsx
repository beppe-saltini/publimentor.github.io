import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PubliMentor - AI-Powered Scientific Editorial Workflow",
  description: "Streamline your scientific publishing workflow with AI-powered reviewer discovery, conflict of interest detection, and research integrity validation.",
  keywords: ["scientific publishing", "peer review", "reviewer finder", "conflict of interest", "research integrity", "editorial workflow"],
  openGraph: {
    title: "PubliMentor - AI-Powered Scientific Editorial Workflow",
    description: "Find reviewers, check COI, and validate research integrity with AI.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
