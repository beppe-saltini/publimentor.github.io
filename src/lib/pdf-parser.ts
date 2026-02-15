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

/**
 * Helper: extract text and metadata from a Uint8Array using unpdf
 */
async function extractWithUnpdf(data: Uint8Array): Promise<PDFContent> {
  const { getDocumentProxy, extractText } = await import("unpdf");
  const doc = await getDocumentProxy(data);
  const { totalPages, text } = await extractText(doc, { mergePages: true });

  // Try to get document metadata
  let info: PDFContent["info"] = {};
  try {
    const meta = await doc.getMetadata();
    const raw = (meta?.info ?? {}) as Record<string, string | undefined>;
    info = {
      title: raw.Title,
      author: raw.Author,
      subject: raw.Subject,
      keywords: raw.Keywords,
      creator: raw.Creator,
    };
  } catch {
    // Metadata may not be available in all PDFs
  }

  const wordCount = text.split(/\s+/).filter(Boolean).length;

  return {
    text,
    numPages: totalPages,
    info,
    wordCount,
    characterCount: text.length,
  };
}

/**
 * Parse a PDF file and extract its content
 */
export async function parsePDF(filePath: string): Promise<PDFContent> {
  const dataBuffer = await readFile(filePath);
  return extractWithUnpdf(new Uint8Array(dataBuffer));
}

/**
 * Parse PDF from a buffer (for uploaded files)
 */
export async function parsePDFBuffer(buffer: Buffer): Promise<PDFContent> {
  return extractWithUnpdf(new Uint8Array(buffer));
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
