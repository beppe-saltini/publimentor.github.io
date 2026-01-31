/**
 * Fuzzy Name Matcher
 * Handles variations in names including:
 * - Nicknames (Jim/James, Bill/William)
 * - Chinese transliterations (different romanization systems)
 * - Spelling variations and typos
 * - Diacritics and special characters
 */

// Common English nickname mappings
const NICKNAME_MAP: Record<string, string[]> = {
  // Male names
  james: ["jim", "jimmy", "jamie", "jem"],
  william: ["will", "bill", "billy", "willy", "liam"],
  robert: ["rob", "bob", "bobby", "robbie", "bert"],
  richard: ["rick", "dick", "rich", "richie", "ricky"],
  michael: ["mike", "mikey", "mick", "mickey"],
  thomas: ["tom", "tommy", "thom"],
  charles: ["charlie", "chuck", "chas", "charley"],
  joseph: ["joe", "joey", "jo"],
  edward: ["ed", "eddie", "eddy", "ted", "teddy", "ned"],
  christopher: ["chris", "kit", "topher"],
  anthony: ["tony", "ant", "anton"],
  daniel: ["dan", "danny", "dani"],
  matthew: ["matt", "matty"],
  david: ["dave", "davey", "davy"],
  andrew: ["andy", "drew", "andi"],
  nicholas: ["nick", "nicky", "nico", "nicolas"],
  benjamin: ["ben", "benny", "benji"],
  alexander: ["alex", "xander", "al", "alec", "lex", "sasha"],
  jonathan: ["jon", "john", "johnny", "jonny", "nathan"],
  john: ["johnny", "jonny", "jack", "jock"],
  steven: ["steve", "stevie", "stephen", "steph"],
  stephen: ["steve", "stevie", "steven", "steph"],
  peter: ["pete", "petey"],
  gregory: ["greg", "gregg"],
  samuel: ["sam", "sammy", "sammi"],
  timothy: ["tim", "timmy"],
  patrick: ["pat", "paddy", "patty"],
  phillip: ["phil", "pip"],
  lawrence: ["larry", "laurie", "lars"],
  raymond: ["ray", "raymo"],
  gerald: ["gerry", "jerry", "ger"],
  jeffrey: ["jeff", "geoff", "geoffrey"],
  kenneth: ["ken", "kenny"],
  ronald: ["ron", "ronnie", "ronny"],
  donald: ["don", "donny", "donnie"],
  douglas: ["doug", "dougie"],
  eugene: ["gene"],
  henry: ["hank", "harry", "hal"],
  albert: ["al", "bert", "bertie"],
  arthur: ["art", "artie"],
  frederick: ["fred", "freddy", "freddie", "fritz"],
  leonard: ["leo", "len", "lenny"],
  walter: ["walt", "wally"],
  harold: ["hal", "harry"],
  // Female names
  elizabeth: ["liz", "lizzy", "lizzie", "beth", "betty", "bette", "eliza", "ellie", "ella", "libby"],
  katherine: ["kate", "kathy", "katie", "cathy", "catherine", "kat", "kitty", "kay"],
  catherine: ["kate", "kathy", "katie", "cathy", "katherine", "kat", "kitty", "kay"],
  margaret: ["maggie", "peggy", "marge", "margie", "meg", "rita", "greta"],
  patricia: ["pat", "patty", "tricia", "trish"],
  jennifer: ["jen", "jenny", "jenn"],
  jessica: ["jess", "jessie"],
  rebecca: ["becky", "becca", "beck", "reba"],
  stephanie: ["steph", "stephie", "steffi"],
  alexandra: ["alex", "alexa", "sandra", "sasha", "lexi"],
  victoria: ["vicky", "vicki", "tori"],
  samantha: ["sam", "sammi", "sammy"],
  christina: ["chris", "chrissy", "tina", "kristina"],
  christine: ["chris", "chrissy", "tina", "kristine"],
  nicole: ["nicki", "nikki", "nic"],
  natalie: ["nat", "natty"],
  deborah: ["deb", "debbie", "debby"],
  cynthia: ["cindy", "cyndi"],
  dorothy: ["dot", "dottie", "dolly"],
  theresa: ["terry", "terri", "tess", "tessie"],
  susanna: ["sue", "susie", "suzy", "susan", "suzanne"],
  susan: ["sue", "susie", "suzy", "susanna", "suzanne"],
  judith: ["judy", "judi"],
  jacqueline: ["jackie", "jacqui"],
  abigail: ["abby", "abbi", "gail"],
  madeline: ["maddy", "maddie"],
  caroline: ["carol", "carrie"],
  francesca: ["fran", "frankie", "frannie"],
};

// Build reverse lookup for nicknames
const NICKNAME_REVERSE: Map<string, string> = new Map();
for (const [canonical, nicknames] of Object.entries(NICKNAME_MAP)) {
  for (const nickname of nicknames) {
    NICKNAME_REVERSE.set(nickname, canonical);
  }
}

// Chinese transliteration variations (common romanization differences)
const CHINESE_PINYIN_VARIANTS: Record<string, string[]> = {
  // Consonant variations
  zh: ["j", "z"],
  ch: ["c", "q"],
  sh: ["s", "x"],
  x: ["sh", "hs", "s"],
  q: ["ch", "c", "ts"],
  c: ["ts", "tz"],
  z: ["ts", "tz", "j"],
  r: ["j", "l"],
  // Vowel variations
  ü: ["u", "v", "yu"],
  ou: ["o", "ow"],
  ao: ["au", "ow"],
  iu: ["iou", "eu"],
  ui: ["uei", "wei"],
  ian: ["ien", "yan"],
  iang: ["yang"],
  iong: ["yong", "yung"],
  ong: ["ung", "oung"],
  eng: ["ing", "ung"],
  ang: ["ong"],
  an: ["en"],
  in: ["een", "yn"],
  un: ["uen", "wen"],
  // Common surname variations
  zhang: ["chang", "cheung", "jeong"],
  wang: ["wong", "huang"],
  li: ["lee", "lei", "ly"],
  liu: ["lau", "liew", "lu"],
  chen: ["chan", "tan", "chin", "chern"],
  yang: ["yeung", "young", "ieong"],
  huang: ["wong", "hwang", "wang"],
  zhao: ["chao", "chiu", "jao"],
  wu: ["ng", "woo", "ou"],
  zhou: ["chow", "chou", "jou"],
  xu: ["hsu", "shyu", "syu", "tsui"],
  sun: ["suen", "soon"],
  ma: ["mah"],
  zhu: ["chu", "ju"],
  hu: ["woo", "wu", "foo"],
  guo: ["kuo", "kwok", "gwok"],
  lin: ["lim", "lam"],
  he: ["ho", "hoe"],
  gao: ["kao", "ko"],
  luo: ["lo", "law"],
  zheng: ["cheng", "jung"],
  liang: ["leung", "leong"],
  xie: ["hsieh", "tse", "chia"],
  tang: ["tong", "deng"],
  feng: ["fung", "fong"],
  cheng: ["zheng", "ching"],
  cai: ["tsai", "choi", "choy"],
  peng: ["phang", "bong"],
  pan: ["poon", "pun"],
  yuan: ["yuen", "wan"],
  dong: ["tung", "tong"],
  yu: ["yue", "yee", "yeo"],
  xiao: ["hsiao", "siu", "shiu"],
  jin: ["kim", "chin", "king"],
  wei: ["wai", "ngai"],
  qian: ["chien", "chin"],
  qin: ["chin", "tsin"],
  jiang: ["chiang", "keung"],
  cui: ["tsui", "chui"],
  deng: ["tang", "teng"],
  han: ["hon", "hahn"],
  cao: ["tsao", "cho"],
  fan: ["faan"],
  shen: ["shum", "sim"],
  ye: ["yip", "yeh", "ip"],
  xue: ["hsueh", "sit"],
  lu: ["loo", "luk", "lo"],
  shi: ["shih", "sze", "si"],
  su: ["soo", "so"],
  // Given name variants
  wei: ["wai", "way"],
  ming: ["min", "meng"],
  hua: ["hwa", "wah"],
  jing: ["ching", "ging"],
  jun: ["chun", "joon"],
  lei: ["lay", "ray"],
  ping: ["bing"],
  qiang: ["chiang", "keung"],
  wen: ["man", "wun"],
  xin: ["sin", "hsin"],
  yan: ["yen", "yin"],
  yi: ["yee", "ee", "i"],
  ying: ["ing", "eng"],
  yong: ["wing", "young"],
  zhi: ["chi", "ji"],
};

// Diacritics mapping for normalization
const DIACRITICS_MAP: Record<string, string> = {
  à: "a", á: "a", â: "a", ã: "a", ä: "a", å: "a", ā: "a", ă: "a", ą: "a",
  è: "e", é: "e", ê: "e", ë: "e", ē: "e", ė: "e", ę: "e", ě: "e",
  ì: "i", í: "i", î: "i", ï: "i", ī: "i", į: "i", ı: "i",
  ò: "o", ó: "o", ô: "o", õ: "o", ö: "o", ø: "o", ō: "o", ő: "o",
  ù: "u", ú: "u", û: "u", ü: "u", ū: "u", ů: "u", ű: "u", ų: "u",
  ý: "y", ÿ: "y", ŷ: "y",
  ñ: "n", ń: "n", ň: "n", ņ: "n",
  ç: "c", ć: "c", č: "c", ċ: "c",
  ß: "ss",
  ğ: "g", ģ: "g",
  ş: "s", ś: "s", š: "s", ș: "s",
  ž: "z", ź: "z", ż: "z",
  ł: "l", ľ: "l", ļ: "l",
  đ: "d", ď: "d",
  ť: "t", ț: "t",
  ř: "r", ŕ: "r",
  ķ: "k",
  æ: "ae", œ: "oe",
};

/**
 * Normalize a string by removing diacritics and converting to lowercase
 */
export function normalizeString(str: string): string {
  let result = str.toLowerCase().trim();
  
  // Replace diacritics
  for (const [diacritic, replacement] of Object.entries(DIACRITICS_MAP)) {
    result = result.replace(new RegExp(diacritic, "g"), replacement);
  }
  
  // Remove punctuation except hyphens and apostrophes in names
  result = result.replace(/[^\w\s'-]/g, "");
  
  return result;
}

/**
 * Get the canonical form of a name (resolving nicknames)
 */
export function getCanonicalName(name: string): string {
  const normalized = normalizeString(name);
  return NICKNAME_REVERSE.get(normalized) || normalized;
}

/**
 * Get all variations of a given name (including nicknames)
 */
export function getNameVariations(name: string): string[] {
  const normalized = normalizeString(name);
  const variations = new Set<string>([normalized]);
  
  // Check if it's a canonical name with nicknames
  if (NICKNAME_MAP[normalized]) {
    NICKNAME_MAP[normalized].forEach(v => variations.add(v));
  }
  
  // Check if it's a nickname with a canonical form
  const canonical = NICKNAME_REVERSE.get(normalized);
  if (canonical) {
    variations.add(canonical);
    // Also add other nicknames of the same canonical name
    NICKNAME_MAP[canonical]?.forEach(v => variations.add(v));
  }
  
  return Array.from(variations);
}

/**
 * Get Chinese transliteration variations of a name
 */
export function getChineseVariations(name: string): string[] {
  const normalized = normalizeString(name);
  const variations = new Set<string>([normalized]);
  
  // Check direct matches in variant map
  if (CHINESE_PINYIN_VARIANTS[normalized]) {
    CHINESE_PINYIN_VARIANTS[normalized].forEach(v => variations.add(v));
  }
  
  // Check if current name is a variant of another
  for (const [base, variants] of Object.entries(CHINESE_PINYIN_VARIANTS)) {
    if (variants.includes(normalized)) {
      variations.add(base);
      variants.forEach(v => variations.add(v));
    }
  }
  
  // Apply phonetic transformations for unlisted names
  for (const [pattern, replacements] of Object.entries(CHINESE_PINYIN_VARIANTS)) {
    if (normalized.includes(pattern)) {
      for (const replacement of replacements) {
        variations.add(normalized.replace(pattern, replacement));
      }
    }
  }
  
  return Array.from(variations);
}

/**
 * Calculate Levenshtein distance between two strings
 */
export function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;
  
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  
  return dp[m][n];
}

/**
 * Calculate Jaro-Winkler similarity (0-1, higher is more similar)
 */
export function jaroWinklerSimilarity(str1: string, str2: string): number {
  if (str1 === str2) return 1;
  if (str1.length === 0 || str2.length === 0) return 0;
  
  const matchWindow = Math.floor(Math.max(str1.length, str2.length) / 2) - 1;
  const s1Matches = new Array(str1.length).fill(false);
  const s2Matches = new Array(str2.length).fill(false);
  
  let matches = 0;
  let transpositions = 0;
  
  // Find matches
  for (let i = 0; i < str1.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, str2.length);
    
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || str1[i] !== str2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }
  
  if (matches === 0) return 0;
  
  // Count transpositions
  let k = 0;
  for (let i = 0; i < str1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (str1[i] !== str2[k]) transpositions++;
    k++;
  }
  
  const jaro = (matches / str1.length + matches / str2.length + 
                (matches - transpositions / 2) / matches) / 3;
  
  // Winkler modification - boost for common prefix
  let prefixLength = 0;
  for (let i = 0; i < Math.min(str1.length, str2.length, 4); i++) {
    if (str1[i] === str2[i]) prefixLength++;
    else break;
  }
  
  return jaro + prefixLength * 0.1 * (1 - jaro);
}

/**
 * Calculate Soundex code for phonetic matching
 */
export function soundex(str: string): string {
  const s = str.toUpperCase().replace(/[^A-Z]/g, "");
  if (s.length === 0) return "";
  
  const codes: Record<string, string> = {
    B: "1", F: "1", P: "1", V: "1",
    C: "2", G: "2", J: "2", K: "2", Q: "2", S: "2", X: "2", Z: "2",
    D: "3", T: "3",
    L: "4",
    M: "5", N: "5",
    R: "6",
  };
  
  let result = s[0];
  let prevCode = codes[s[0]] || "";
  
  for (let i = 1; i < s.length && result.length < 4; i++) {
    const code = codes[s[i]] || "";
    if (code && code !== prevCode) {
      result += code;
    }
    prevCode = code || prevCode;
  }
  
  return (result + "000").substring(0, 4);
}

export interface NameMatchResult {
  isMatch: boolean;
  confidence: number; // 0-1
  matchType: "exact" | "nickname" | "transliteration" | "phonetic" | "fuzzy" | "none";
  explanation: string;
}

/**
 * Compare two names with fuzzy matching
 */
export function matchNames(name1: string, name2: string): NameMatchResult {
  const n1 = normalizeString(name1);
  const n2 = normalizeString(name2);
  
  // Exact match
  if (n1 === n2) {
    return {
      isMatch: true,
      confidence: 1.0,
      matchType: "exact",
      explanation: "Exact match",
    };
  }
  
  // Nickname match
  const canonical1 = getCanonicalName(n1);
  const canonical2 = getCanonicalName(n2);
  
  if (canonical1 === canonical2) {
    return {
      isMatch: true,
      confidence: 0.95,
      matchType: "nickname",
      explanation: `Nickname match: ${name1} and ${name2} are variations of ${canonical1}`,
    };
  }
  
  // Check if one is a nickname of the other
  const variations1 = getNameVariations(n1);
  const variations2 = getNameVariations(n2);
  
  if (variations1.includes(n2) || variations2.includes(n1)) {
    return {
      isMatch: true,
      confidence: 0.95,
      matchType: "nickname",
      explanation: `Nickname match: ${name1} is a variation of ${name2}`,
    };
  }
  
  // Chinese transliteration match
  const chineseVars1 = getChineseVariations(n1);
  const chineseVars2 = getChineseVariations(n2);
  
  for (const v1 of chineseVars1) {
    if (chineseVars2.includes(v1)) {
      return {
        isMatch: true,
        confidence: 0.90,
        matchType: "transliteration",
        explanation: `Chinese transliteration match: ${name1} and ${name2} are variants`,
      };
    }
  }
  
  // Phonetic match (Soundex)
  if (soundex(n1) === soundex(n2)) {
    return {
      isMatch: true,
      confidence: 0.80,
      matchType: "phonetic",
      explanation: `Phonetic match: ${name1} and ${name2} sound similar`,
    };
  }
  
  // Jaro-Winkler similarity
  const similarity = jaroWinklerSimilarity(n1, n2);
  
  if (similarity >= 0.92) {
    return {
      isMatch: true,
      confidence: similarity,
      matchType: "fuzzy",
      explanation: `High similarity (${(similarity * 100).toFixed(0)}%): likely the same name with minor spelling differences`,
    };
  }
  
  if (similarity >= 0.85) {
    return {
      isMatch: true,
      confidence: similarity * 0.9, // Slightly discount lower similarities
      matchType: "fuzzy",
      explanation: `Moderate similarity (${(similarity * 100).toFixed(0)}%): possibly the same name`,
    };
  }
  
  return {
    isMatch: false,
    confidence: similarity,
    matchType: "none",
    explanation: `Low similarity (${(similarity * 100).toFixed(0)}%): likely different names`,
  };
}

/**
 * Compare full names (first + last) with fuzzy matching
 */
export function matchFullNames(
  firstName1: string,
  lastName1: string,
  firstName2: string,
  lastName2: string
): NameMatchResult {
  // Match surnames first (must match for positive result)
  const surnameMatch = matchNames(lastName1, lastName2);
  
  if (!surnameMatch.isMatch) {
    return {
      isMatch: false,
      confidence: surnameMatch.confidence * 0.5,
      matchType: "none",
      explanation: `Surnames don't match: ${lastName1} vs ${lastName2}`,
    };
  }
  
  // Match first names
  const firstNameMatch = matchNames(firstName1, firstName2);
  
  // Combine confidences
  const combinedConfidence = (surnameMatch.confidence * 0.6 + firstNameMatch.confidence * 0.4);
  
  if (firstNameMatch.isMatch) {
    return {
      isMatch: true,
      confidence: combinedConfidence,
      matchType: firstNameMatch.matchType === "exact" && surnameMatch.matchType === "exact" 
        ? "exact" 
        : firstNameMatch.matchType,
      explanation: `Full name match: ${firstName1} ${lastName1} ≈ ${firstName2} ${lastName2}`,
    };
  }
  
  // Surname matches but first name doesn't - still might be a match with low confidence
  if (combinedConfidence >= 0.7) {
    return {
      isMatch: true,
      confidence: combinedConfidence * 0.8,
      matchType: "fuzzy",
      explanation: `Possible match: surnames match (${surnameMatch.matchType}), first names differ`,
    };
  }
  
  return {
    isMatch: false,
    confidence: combinedConfidence,
    matchType: "none",
    explanation: `Names differ: ${firstName1} ${lastName1} vs ${firstName2} ${lastName2}`,
  };
}

/**
 * Find best matches for a name in a list of candidates
 */
export function findBestMatches(
  targetName: string,
  candidates: string[],
  threshold: number = 0.8
): { name: string; result: NameMatchResult }[] {
  const matches: { name: string; result: NameMatchResult }[] = [];
  
  for (const candidate of candidates) {
    const result = matchNames(targetName, candidate);
    if (result.confidence >= threshold) {
      matches.push({ name: candidate, result });
    }
  }
  
  return matches.sort((a, b) => b.result.confidence - a.result.confidence);
}
