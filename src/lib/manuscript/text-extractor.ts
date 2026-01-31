/**
 * Document Text Extraction Service
 * 
 * Extracts plain text from various document formats:
 * - PDF (using pdf-parse)
 * - DOCX (using mammoth)
 * - LaTeX (custom parser) - Phase 2
 */

export interface ExtractionResult {
  text: string;
  pageCount?: number;
  wordCount: number;
  method: string;
  metadata?: Record<string, unknown>;
}

/**
 * Extract text from a document buffer
 */
export async function extractText(
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<ExtractionResult> {
  const fileExtension = fileName.split(".").pop()?.toLowerCase();

  // Determine extraction method
  if (mimeType === "application/pdf" || fileExtension === "pdf") {
    return extractFromPDF(buffer);
  }

  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    fileExtension === "docx"
  ) {
    return extractFromDOCX(buffer);
  }

  if (mimeType === "application/msword" || fileExtension === "doc") {
    throw new Error("Legacy .doc format not supported. Please convert to .docx");
  }

  if (mimeType === "application/x-tex" || fileExtension === "tex") {
    return extractFromLaTeX(buffer);
  }

  throw new Error(`Unsupported file type: ${mimeType || fileExtension}`);
}

/**
 * Extract text from PDF using pdf-parse v2.x
 */
async function extractFromPDF(buffer: Buffer): Promise<ExtractionResult> {
  const { PDFParse } = await import("pdf-parse");

  // Create parser instance with buffer data
  const parser = new PDFParse({ data: buffer });
  
  // Get text from all pages - returns { text: string, pages: [...], total: number }
  // Note: load() is called internally by getText() in pdf-parse v2
  const result = await parser.getText();
  const text = typeof result === "string" ? result : result.text || "";
  const pageCount = typeof result === "object" ? result.total : undefined;
  const wordCount = countWords(text);
  
  // Get document info
  let info: Record<string, unknown> = {};
  
  try {
    const infoResult = await parser.getInfo();
    info = infoResult as unknown as Record<string, unknown>;
  } catch {
    // Info may not be available for all PDFs
  }

  // Cleanup
  parser.destroy();

  return {
    text,
    pageCount,
    wordCount,
    method: "pdf-parse",
    metadata: { info },
  };
}

/**
 * Extract text from DOCX using mammoth
 */
async function extractFromDOCX(buffer: Buffer): Promise<ExtractionResult> {
  const mammoth = await import("mammoth");

  // Extract raw text (no formatting)
  const result = await mammoth.extractRawText({ buffer });

  const text = result.value;
  const wordCount = countWords(text);

  // Also get any messages/warnings
  const warnings = result.messages
    .filter((m) => m.type === "warning")
    .map((m) => m.message);

  return {
    text,
    wordCount,
    method: "mammoth",
    metadata: {
      warnings: warnings.length > 0 ? warnings : undefined,
    },
  };
}

/**
 * Extract text from LaTeX - Basic implementation
 * Full implementation in Phase 2
 */
async function extractFromLaTeX(buffer: Buffer): Promise<ExtractionResult> {
  const content = buffer.toString("utf-8");

  // Basic LaTeX cleaning - remove common commands
  let text = content
    // Remove comments
    .replace(/%.*$/gm, "")
    // Remove common preamble commands
    .replace(/\\documentclass\[?[^\]]*\]?\{[^}]*\}/g, "")
    .replace(/\\usepackage\[?[^\]]*\]?\{[^}]*\}/g, "")
    .replace(/\\(begin|end)\{document\}/g, "")
    // Remove common formatting commands
    .replace(/\\(textbf|textit|emph|underline)\{([^}]*)\}/g, "$2")
    .replace(/\\(section|subsection|subsubsection)\*?\{([^}]*)\}/g, "\n\n$2\n\n")
    .replace(/\\(title|author|date)\{([^}]*)\}/g, "$2")
    // Remove references and labels
    .replace(/\\(label|ref|cite|citep|citet)\{[^}]*\}/g, "")
    // Remove environments but keep content
    .replace(/\\begin\{(equation|align|figure|table)\*?\}[\s\S]*?\\end\{\1\*?\}/g, "[EQUATION/FIGURE/TABLE]")
    // Remove remaining backslash commands
    .replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?(\{[^}]*\})?/g, " ")
    // Clean up braces
    .replace(/[{}]/g, "")
    // Clean up whitespace
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const wordCount = countWords(text);

  return {
    text,
    wordCount,
    method: "latex-basic",
    metadata: {
      note: "Basic LaTeX extraction. Full support in Phase 2.",
    },
  };
}

/**
 * Count words in text
 */
function countWords(text: string): number {
  return text
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .length;
}

/**
 * Detect document sections
 */
export function detectSections(text: string): { name: string; start: number; end: number }[] {
  const sections: { name: string; start: number; end: number }[] = [];

  // Common section headers in scientific papers
  const sectionPatterns = [
    /\b(Abstract)\b/gi,
    /\b(Introduction)\b/gi,
    /\b(Background)\b/gi,
    /\b(Methods?|Materials?\s+and\s+Methods?|Methodology)\b/gi,
    /\b(Results?)\b/gi,
    /\b(Discussion)\b/gi,
    /\b(Conclusions?)\b/gi,
    /\b(References?|Bibliography)\b/gi,
    /\b(Acknowledgements?)\b/gi,
    /\b(Supplementary|Supporting\s+Information)\b/gi,
  ];

  for (const pattern of sectionPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      sections.push({
        name: match[1],
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }

  // Sort by position
  sections.sort((a, b) => a.start - b.start);

  // Set end positions to next section start
  for (let i = 0; i < sections.length - 1; i++) {
    sections[i].end = sections[i + 1].start;
  }

  // Last section goes to end
  if (sections.length > 0) {
    sections[sections.length - 1].end = text.length;
  }

  return sections;
}
