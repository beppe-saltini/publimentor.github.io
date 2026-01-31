/**
 * Tortured Phrases Detection System
 * 
 * Based on research documenting "tortured phrases" in paper mill submissions.
 * These are unusual word substitutions created by synonym replacement tools.
 * 
 * IMPORTANT: This is a screening tool only. Results are indicators, not accusations.
 * All findings require editorial review before any action is taken.
 * 
 * References:
 * - Cabanac, G., Labbé, C., & Magazinov, A. (2021). "Tortured phrases: A dubious 
 *   writing style emerging in science"
 */

export interface TorturedPhrasePattern {
  id: string;
  torturedPhrase: string;
  originalPhrase: string;
  category: 
    | "ai_ml" 
    | "statistics" 
    | "methodology" 
    | "biology" 
    | "chemistry" 
    | "physics" 
    | "computing" 
    | "general_academic";
  severity: "high" | "medium" | "low";
  source?: string;
}

export interface TorturedPhraseMatch {
  pattern: TorturedPhrasePattern;
  matchedText: string;
  location: {
    startIndex: number;
    endIndex: number;
    context: string; // surrounding text for review
  };
}

export interface TorturedPhrasesResult {
  found: boolean;
  matchCount: number;
  matches: TorturedPhraseMatch[];
  summary: string;
  severity: "none" | "low" | "medium" | "high";
  disclaimer: string;
}

/**
 * Known tortured phrase patterns
 * Source: Problematic Paper Screener, Cabanac et al. research
 */
export const TORTURED_PHRASES: TorturedPhrasePattern[] = [
  // AI/ML phrases (HIGH severity - very indicative)
  { id: "ai001", torturedPhrase: "counterfeit consciousness", originalPhrase: "artificial intelligence", category: "ai_ml", severity: "high" },
  { id: "ai002", torturedPhrase: "profound learning", originalPhrase: "deep learning", category: "ai_ml", severity: "high" },
  { id: "180", torturedPhrase: "neural organization", originalPhrase: "neural network", category: "ai_ml", severity: "high" },
  { id: "ai003", torturedPhrase: "sham knowledge", originalPhrase: "artificial intelligence", category: "ai_ml", severity: "high" },
  { id: "ai004", torturedPhrase: "fake knowledge", originalPhrase: "artificial intelligence", category: "ai_ml", severity: "high" },
  { id: "ai005", torturedPhrase: "simulated brain", originalPhrase: "artificial neural network", category: "ai_ml", severity: "high" },
  { id: "ai006", torturedPhrase: "profound neural organization", originalPhrase: "deep neural network", category: "ai_ml", severity: "high" },
  { id: "ai007", torturedPhrase: "convolutional neural organization", originalPhrase: "convolutional neural network", category: "ai_ml", severity: "high" },
  { id: "ai008", torturedPhrase: "repetitive neural organization", originalPhrase: "recurrent neural network", category: "ai_ml", severity: "high" },
  { id: "ai009", torturedPhrase: "support vector machine learning", originalPhrase: "support vector machine", category: "ai_ml", severity: "medium" },
  { id: "ai010", torturedPhrase: "choice tree", originalPhrase: "decision tree", category: "ai_ml", severity: "high" },
  { id: "ai011", torturedPhrase: "irregular woodland", originalPhrase: "random forest", category: "ai_ml", severity: "high" },
  { id: "ai012", torturedPhrase: "arbitrary woodland", originalPhrase: "random forest", category: "ai_ml", severity: "high" },
  { id: "ai013", torturedPhrase: "angle boosting", originalPhrase: "gradient boosting", category: "ai_ml", severity: "high" },
  { id: "ai014", torturedPhrase: "inclination boosting", originalPhrase: "gradient boosting", category: "ai_ml", severity: "high" },
  
  // Statistics phrases
  { id: "stat001", torturedPhrase: "straight relapse", originalPhrase: "linear regression", category: "statistics", severity: "high" },
  { id: "stat002", torturedPhrase: "direct relapse", originalPhrase: "linear regression", category: "statistics", severity: "high" },
  { id: "stat003", torturedPhrase: "strategic relapse", originalPhrase: "logistic regression", category: "statistics", severity: "high" },
  { id: "stat004", torturedPhrase: "calculated relapse", originalPhrase: "logistic regression", category: "statistics", severity: "high" },
  { id: "stat005", torturedPhrase: "multi-layer relapse", originalPhrase: "multilayer regression", category: "statistics", severity: "high" },
  { id: "stat006", torturedPhrase: "calculated connection", originalPhrase: "statistical correlation", category: "statistics", severity: "medium" },
  { id: "stat007", torturedPhrase: "factual relationship", originalPhrase: "statistical correlation", category: "statistics", severity: "medium" },
  { id: "stat008", torturedPhrase: "change investigation", originalPhrase: "variance analysis", category: "statistics", severity: "high" },
  { id: "stat009", torturedPhrase: "difference examination", originalPhrase: "variance analysis", category: "statistics", severity: "medium" },
  { id: "stat010", torturedPhrase: "standard change", originalPhrase: "standard deviation", category: "statistics", severity: "medium" },
  { id: "stat011", torturedPhrase: "mean quality deviation", originalPhrase: "mean square error", category: "statistics", severity: "high" },
  
  // Methodology phrases
  { id: "meth001", torturedPhrase: "recondite technique", originalPhrase: "novel method", category: "methodology", severity: "high" },
  { id: "meth002", torturedPhrase: "crude examination", originalPhrase: "crude analysis", category: "methodology", severity: "medium" },
  { id: "meth003", torturedPhrase: "information mining", originalPhrase: "data mining", category: "methodology", severity: "low" },
  { id: "meth004", torturedPhrase: "characteristic determination", originalPhrase: "feature extraction", category: "methodology", severity: "high" },
  { id: "meth005", torturedPhrase: "trademark extraction", originalPhrase: "feature extraction", category: "methodology", severity: "high" },
  { id: "meth006", torturedPhrase: "ground truth reality", originalPhrase: "ground truth", category: "methodology", severity: "medium" },
  { id: "meth007", torturedPhrase: "benchmark informational collection", originalPhrase: "benchmark dataset", category: "methodology", severity: "high" },
  { id: "meth008", torturedPhrase: "enlightening examination", originalPhrase: "exploratory analysis", category: "methodology", severity: "medium" },
  { id: "meth009", torturedPhrase: "exact reenactment", originalPhrase: "exact simulation", category: "methodology", severity: "medium" },
  
  // Biology phrases
  { id: "bio001", torturedPhrase: "quality articulation", originalPhrase: "gene expression", category: "biology", severity: "high" },
  { id: "bio002", torturedPhrase: "quality level", originalPhrase: "gene level", category: "biology", severity: "high" },
  { id: "bio003", torturedPhrase: "protein grouping", originalPhrase: "protein sequence", category: "biology", severity: "high" },
  { id: "bio004", torturedPhrase: "nucleic corrosive", originalPhrase: "nucleic acid", category: "biology", severity: "high" },
  { id: "bio005", torturedPhrase: "amino corrosive", originalPhrase: "amino acid", category: "biology", severity: "high" },
  { id: "bio006", torturedPhrase: "cell passing", originalPhrase: "cell death", category: "biology", severity: "high" },
  { id: "bio007", torturedPhrase: "modified cell passing", originalPhrase: "apoptosis/programmed cell death", category: "biology", severity: "high" },
  { id: "bio008", torturedPhrase: "body telephone", originalPhrase: "somatic cell", category: "biology", severity: "high" },
  { id: "bio009", torturedPhrase: "undifferentiated organism", originalPhrase: "stem cell", category: "biology", severity: "high" },
  
  // Chemistry phrases  
  { id: "chem001", torturedPhrase: "synthetic response", originalPhrase: "chemical reaction", category: "chemistry", severity: "high" },
  { id: "chem002", torturedPhrase: "compound response", originalPhrase: "chemical reaction", category: "chemistry", severity: "medium" },
  { id: "chem003", torturedPhrase: "sub-atomic structure", originalPhrase: "molecular structure", category: "chemistry", severity: "high" },
  { id: "chem004", torturedPhrase: "nuclear holding", originalPhrase: "chemical bonding", category: "chemistry", severity: "high" },
  
  // Physics phrases
  { id: "phys001", torturedPhrase: "quantum mechanics physical science", originalPhrase: "quantum physics", category: "physics", severity: "high" },
  { id: "phys002", torturedPhrase: "attractive field", originalPhrase: "magnetic field", category: "physics", severity: "high" },
  { id: "phys003", torturedPhrase: "electric field quality", originalPhrase: "electric field strength", category: "physics", severity: "high" },
  
  // Computing phrases
  { id: "comp001", torturedPhrase: "enormous information", originalPhrase: "big data", category: "computing", severity: "high" },
  { id: "comp002", torturedPhrase: "huge information", originalPhrase: "big data", category: "computing", severity: "high" },
  { id: "comp003", torturedPhrase: "distributed figuring", originalPhrase: "cloud computing", category: "computing", severity: "high" },
  { id: "comp004", torturedPhrase: "mist registering", originalPhrase: "fog computing", category: "computing", severity: "high" },
  { id: "comp005", torturedPhrase: "edge figuring", originalPhrase: "edge computing", category: "computing", severity: "high" },
  { id: "comp006", torturedPhrase: "square chain", originalPhrase: "blockchain", category: "computing", severity: "high" },
  { id: "comp007", torturedPhrase: "web of things", originalPhrase: "internet of things", category: "computing", severity: "medium" },
  { id: "comp008", torturedPhrase: "advanced money", originalPhrase: "digital currency", category: "computing", severity: "medium" },
  { id: "comp009", torturedPhrase: "computerized cash", originalPhrase: "digital currency/cryptocurrency", category: "computing", severity: "high" },
  
  // General academic phrases
  { id: "gen001", torturedPhrase: "writing audit", originalPhrase: "literature review", category: "general_academic", severity: "high" },
  { id: "gen002", torturedPhrase: "writing survey", originalPhrase: "literature review", category: "general_academic", severity: "high" },
  { id: "gen003", torturedPhrase: "earlier work", originalPhrase: "prior work", category: "general_academic", severity: "low" },
  { id: "gen004", torturedPhrase: "past examination", originalPhrase: "previous study", category: "general_academic", severity: "low" },
  { id: "gen005", torturedPhrase: "analyst network", originalPhrase: "research network", category: "general_academic", severity: "medium" },
  { id: "gen006", torturedPhrase: "exploration paper", originalPhrase: "research paper", category: "general_academic", severity: "medium" },
  { id: "gen007", torturedPhrase: "composing style", originalPhrase: "writing style", category: "general_academic", severity: "medium" },
  { id: "gen008", torturedPhrase: "master assessment", originalPhrase: "expert evaluation", category: "general_academic", severity: "medium" },
  { id: "gen009", torturedPhrase: "friend audit", originalPhrase: "peer review", category: "general_academic", severity: "high" },
  { id: "gen010", torturedPhrase: "distributed examination", originalPhrase: "published study", category: "general_academic", severity: "medium" },
  { id: "gen011", torturedPhrase: "distributed work", originalPhrase: "published work", category: "general_academic", severity: "medium" },
  { id: "gen012", torturedPhrase: "new development", originalPhrase: "novel approach", category: "general_academic", severity: "low" },
  { id: "gen013", torturedPhrase: "proposed approach", originalPhrase: "proposed method", category: "general_academic", severity: "low" },
  { id: "gen014", torturedPhrase: "end segment", originalPhrase: "conclusion section", category: "general_academic", severity: "medium" },
  { id: "gen015", torturedPhrase: "reference list", originalPhrase: "reference list", category: "general_academic", severity: "low" },
];

/**
 * Build regex patterns for efficient matching
 */
function buildPatternRegex(phrase: string): RegExp {
  // Escape special regex characters and allow for flexible whitespace
  const escaped = phrase
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  return new RegExp(escaped, "gi");
}

/**
 * Get context around a match
 */
function getContext(text: string, startIndex: number, endIndex: number, contextLength = 100): string {
  const start = Math.max(0, startIndex - contextLength);
  const end = Math.min(text.length, endIndex + contextLength);
  
  let context = text.slice(start, end);
  
  // Add ellipsis if truncated
  if (start > 0) context = "..." + context;
  if (end < text.length) context = context + "...";
  
  return context;
}

/**
 * Scan text for tortured phrases
 */
export function detectTorturedPhrases(text: string): TorturedPhrasesResult {
  const matches: TorturedPhraseMatch[] = [];
  const normalizedText = text.toLowerCase();
  
  for (const pattern of TORTURED_PHRASES) {
    const regex = buildPatternRegex(pattern.torturedPhrase);
    let match: RegExpExecArray | null;
    
    // Reset regex lastIndex for each pattern
    regex.lastIndex = 0;
    
    while ((match = regex.exec(normalizedText)) !== null) {
      const startIndex = match.index;
      const endIndex = startIndex + match[0].length;
      
      matches.push({
        pattern,
        matchedText: text.slice(startIndex, endIndex),
        location: {
          startIndex,
          endIndex,
          context: getContext(text, startIndex, endIndex),
        },
      });
    }
  }
  
  // Sort by severity (high first) then by position
  matches.sort((a, b) => {
    const severityOrder = { high: 0, medium: 1, low: 2 };
    const severityDiff = severityOrder[a.pattern.severity] - severityOrder[b.pattern.severity];
    if (severityDiff !== 0) return severityDiff;
    return a.location.startIndex - b.location.startIndex;
  });
  
  // Determine overall severity
  let severity: TorturedPhrasesResult["severity"] = "none";
  const highCount = matches.filter(m => m.pattern.severity === "high").length;
  const mediumCount = matches.filter(m => m.pattern.severity === "medium").length;
  
  if (highCount >= 3 || (highCount >= 1 && mediumCount >= 3)) {
    severity = "high";
  } else if (highCount >= 1 || mediumCount >= 2) {
    severity = "medium";
  } else if (matches.length > 0) {
    severity = "low";
  }
  
  // Generate summary
  let summary: string;
  if (matches.length === 0) {
    summary = "No language anomalies detected in automated screening.";
  } else {
    const categoryBreakdown = matches.reduce((acc, m) => {
      acc[m.pattern.category] = (acc[m.pattern.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const categories = Object.entries(categoryBreakdown)
      .map(([cat, count]) => `${count} in ${cat.replace("_", " ")}`)
      .join(", ");
    
    summary = `${matches.length} potential language anomaly indicator(s) detected (${categories}). Editorial review recommended.`;
  }
  
  return {
    found: matches.length > 0,
    matchCount: matches.length,
    matches,
    summary,
    severity,
    disclaimer: "These results are automated indicators only. Unusual language may have legitimate explanations (e.g., translation from non-English source, specialized terminology). All findings require editorial review and human judgment. This is not a fraud determination.",
  };
}

/**
 * Get category display name
 */
export function getCategoryDisplayName(category: TorturedPhrasePattern["category"]): string {
  const names: Record<TorturedPhrasePattern["category"], string> = {
    ai_ml: "AI/Machine Learning",
    statistics: "Statistics",
    methodology: "Methodology",
    biology: "Biology",
    chemistry: "Chemistry",
    physics: "Physics",
    computing: "Computing",
    general_academic: "General Academic",
  };
  return names[category];
}

/**
 * Get severity color class
 */
export function getSeverityColor(severity: TorturedPhrasesResult["severity"]): string {
  const colors = {
    none: "text-green-600",
    low: "text-blue-600",
    medium: "text-amber-600",
    high: "text-orange-600",
  };
  return colors[severity];
}

/**
 * Get severity badge class
 */
export function getSeverityBadgeClass(severity: TorturedPhrasePattern["severity"]): string {
  const classes = {
    high: "bg-orange-100 text-orange-800 border-orange-200",
    medium: "bg-amber-100 text-amber-800 border-amber-200",
    low: "bg-blue-100 text-blue-800 border-blue-200",
  };
  return classes[severity];
}
