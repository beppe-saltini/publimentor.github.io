import { readFile } from "fs/promises";

export interface PDFContent {
  text: string;
  numPages: number;
  info: {
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string;
    creator?: string;
  };
  wordCount: number;
  characterCount: number;
}

interface PDFParseResult {
  text: string;
  numpages: number;
  info?: {
    Title?: string;
    Author?: string;
    Subject?: string;
    Keywords?: string;
    Creator?: string;
  };
}

type PDFParseFunction = (buffer: Buffer) => Promise<PDFParseResult>;

// Lazy-load pdf-parse to avoid SSR issues
let pdfParseLoaded: PDFParseFunction | null = null;

async function getPdfParse(): Promise<PDFParseFunction> {
  if (pdfParseLoaded) return pdfParseLoaded;
  
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  pdfParseLoaded = require("pdf-parse") as PDFParseFunction;
  return pdfParseLoaded;
}

/**
 * Parse a PDF file and extract its content
 */
export async function parsePDF(filePath: string): Promise<PDFContent> {
  const pdf = await getPdfParse();
  const dataBuffer = await readFile(filePath);
  const data = await pdf(dataBuffer);

  const text = data.text;
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  return {
    text,
    numPages: data.numpages,
    info: {
      title: data.info?.Title,
      author: data.info?.Author,
      subject: data.info?.Subject,
      keywords: data.info?.Keywords,
      creator: data.info?.Creator,
    },
    wordCount,
    characterCount: text.length,
  };
}

/**
 * Parse PDF from a buffer (for uploaded files)
 */
export async function parsePDFBuffer(buffer: Buffer): Promise<PDFContent> {
  const pdf = await getPdfParse();
  const data = await pdf(buffer);

  const text = data.text;
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  return {
    text,
    numPages: data.numpages,
    info: {
      title: data.info?.Title,
      author: data.info?.Author,
      subject: data.info?.Subject,
      keywords: data.info?.Keywords,
      creator: data.info?.Creator,
    },
    wordCount,
    characterCount: text.length,
  };
}

/**
 * Extract sections from academic paper text
 */
export function extractSections(text: string): Map<string, string> {
  const sections = new Map<string, string>();
  
  // Common academic paper sections
  const sectionPatterns = [
    /\b(abstract)\b/i,
    /\b(introduction)\b/i,
    /\b(background)\b/i,
    /\b(related work)\b/i,
    /\b(methodology|methods)\b/i,
    /\b(results)\b/i,
    /\b(discussion)\b/i,
    /\b(conclusion)\b/i,
    /\b(references|bibliography)\b/i,
    /\b(acknowledgements?)\b/i,
    /\b(appendix|appendices)\b/i,
  ];

  // Split by common section headers
  const lines = text.split("\n");
  let currentSection = "preamble";
  let currentContent: string[] = [];

  for (const line of lines) {
    let foundSection = false;
    for (const pattern of sectionPatterns) {
      if (pattern.test(line.trim()) && line.trim().length < 50) {
        // Save previous section
        if (currentContent.length > 0) {
          sections.set(currentSection, currentContent.join("\n").trim());
        }
        currentSection = line.trim().toLowerCase();
        currentContent = [];
        foundSection = true;
        break;
      }
    }
    if (!foundSection) {
      currentContent.push(line);
    }
  }

  // Save last section
  if (currentContent.length > 0) {
    sections.set(currentSection, currentContent.join("\n").trim());
  }

  return sections;
}

/**
 * Count references in the paper
 */
export function countReferences(text: string): number {
  // Find the references section
  const refMatch = text.match(/references|bibliography/i);
  if (!refMatch) return 0;

  const refIndex = text.toLowerCase().lastIndexOf("references");
  if (refIndex === -1) return 0;

  const refText = text.substring(refIndex);
  
  // Count numbered references [1], [2], etc. or 1., 2., etc.
  const numberedRefs = refText.match(/\[\d+\]|\n\d+\./g);
  if (numberedRefs) {
    return numberedRefs.length;
  }

  // Estimate based on line patterns (author-year format)
  const lines = refText.split("\n").filter((l) => l.trim().length > 20);
  return Math.max(0, lines.length - 1);
}
