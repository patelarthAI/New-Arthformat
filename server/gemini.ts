import { GoogleGenAI, Type, ThinkingLevel, FunctionDeclaration } from "@google/genai";
import { ResumeData, ResumeFormat, GrammarIssue } from "../src/types";

interface KeyHealth {
  consecutiveFailures: number;
  cooldownUntil: number; // epoch timestamp in ms
  isDailyExhausted: boolean;
  isInvalid: boolean;
  lastSuccess: number;
  totalHits: number;
  lastErrorSnippet?: string;
}

const keyHealthMap = new Map<string, KeyHealth>();
const disabledModels = new Set<string>();

const getKeyId = (key: string): string => {
  if (!key) return "empty";
  if (key.length <= 8) return key;
  return `...${key.slice(-6)}`;
};

const getMidnightUTCTimestamp = (): number => {
  const now = new Date();
  const nextMidnight = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 2, 0 // 00:02 UTC
  ));
  return nextMidnight.getTime();
};

const getKeyHealth = (key: string): KeyHealth => {
  let health = keyHealthMap.get(key);
  if (!health) {
    health = {
      consecutiveFailures: 0,
      cooldownUntil: 0,
      isDailyExhausted: false,
      isInvalid: false,
      lastSuccess: 0,
      totalHits: 0
    };
    keyHealthMap.set(key, health);
  }
  // Check if daily cooldown expired (resets automatically at midnight UTC)
  if (health.isDailyExhausted && Date.now() >= health.cooldownUntil) {
    health.isDailyExhausted = false;
    health.consecutiveFailures = 0;
    health.cooldownUntil = 0;
  }
  return health;
};

let currentKeyIndex = 0;
let totalRequests = 0;
let rateLimitHits = 0;

export const getUsageStatsBackend = (usePro: boolean = false) => {
  const pool = getKeyPool();
  const models = usePro ? PRO_MODELS : FALLBACK_MODELS;
  const now = Date.now();
  let healthyKeys = 0;
  let dailyExhaustedKeys = 0;
  let coolingKeys = 0;
  let invalidKeys = 0;

  for (const k of pool) {
    const h = getKeyHealth(k);
    if (h.isInvalid) invalidKeys++;
    else if (h.isDailyExhausted && now < h.cooldownUntil) dailyExhaustedKeys++;
    else if (now < h.cooldownUntil) coolingKeys++;
    else healthyKeys++;
  }

  return {
    activeKeyIndex: currentKeyIndex % (pool.length || 1),
    totalKeys: pool.length,
    healthyKeys,
    dailyExhaustedKeys,
    coolingKeys,
    invalidKeys,
    totalRequests,
    rateLimitHits,
    activeModel: models.find(m => !disabledModels.has(m)) || models[0],
    hasGroq: !!getGroqApiKey(),
    hasHuggingFace: !!getHuggingFaceApiKey()
  };
};

export const getKeyPool = (): string[] => {
  const rawSources = [
    process.env.GEMINI_API_KEYS,
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_KEY_1,
    process.env.GEMINI_KEY_2,
    process.env.GEMINI_KEY_3,
    process.env.GEMINI_KEY_4,
    process.env.GEMINI_KEY_5,
    process.env.VITE_GEMINI_KEY_1,
    process.env.VITE_GEMINI_KEY_2,
    process.env.VITE_GEMINI_KEY_3,
    process.env.VITE_GEMINI_KEY_4,
    process.env.VITE_GEMINI_KEY_5,
    process.env.VITE_GEMINI_API_KEY,
  ].filter(Boolean) as string[];
  
  const pool: string[] = [];
  for (const src of rawSources) {
    // Support comma or newline separated keys
    const parts = src.split(/[,\n]+/).map(k => k.trim()).filter(Boolean);
    for (const p of parts) {
      if (!pool.includes(p) && p.length > 5) pool.push(p);
    }
  }
  return pool;
};

// ──────────────────────────────────────────────────────────────────
// ACTIVE FREE-TIER MODELS (Live-verified against Google AI Studio Quotas)
//
// HIGHEST CAPACITY (500 Requests Per Day, 15 RPM / key):
// 1. gemini-3.5-flash-lite  → 🟢 PRIMARY (100% OK on all keys, 480+ left today)
// 2. gemini-3.6-flash       → 🟢 FULL-POWER FLASH (Verified healthy across keys)
// 3. gemini-3.1-flash-lite  → ⚡ ULTRA-FAST (~400ms, 470+ left today)
//
// LOW CAPACITY (Only 20 Requests Per Day - resets daily at 00:00 UTC):
// 4. gemini-3.8-flash       → 🟡 20 RPD cap (resets daily at 00:00 UTC)
// 5. gemini-3.5-flash       → 🟡 20 RPD cap (resets daily at 00:00 UTC)
// ──────────────────────────────────────────────────────────────────

// Standard (free-tier) model pool — tried in priority order
const FALLBACK_MODELS = [
  "gemini-3.5-flash-lite",  // 🟢 PRIMARY: 500 RPD, 15 RPM, 100% healthy on all keys
  "gemini-3.6-flash",       // 🟢 FULL FLASH: Verified healthy across keys
  "gemini-3.1-flash-lite",  // ⚡ ULTRA-FAST: 500 RPD, ~400ms latency
  "gemini-3.8-flash",       // 🟡 State-of-the-art: 20 RPD cap (resets daily)
  "gemini-3.5-flash",       // 🟡 20 RPD cap (resets daily)
];

// Pro model pool — enables deep reasoning when requested
const PRO_MODELS = [
  "gemini-3.5-flash-lite",  // 🟢 PRIMARY
  "gemini-3.6-flash",       // 🟢 FULL FLASH
  "gemini-3.1-flash-lite",  // ⚡ ULTRA-FAST
  "gemini-3.8-flash",       // 🟡 BACKUP
  "gemini-3.1-pro-preview", // 🧠 REASONING: Complex JD matching & restructuring
];

// In-memory extraction cache to preserve free quota across repeated user clicks
const extractionCache = new Map<string, { data: ResumeData; timestamp: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

async function withModelFallback<T>(
  operation: (modelId: string, apiKey: string) => Promise<T>,
  operationName: string,
  usePro: boolean = false
): Promise<T> {
  const pool = getKeyPool();
  
  if (pool.length === 0) {
    throw new Error("No API Keys found on the server. Please configure GEMINI_API_KEY in server secrets.");
  }

  const now = Date.now();
  // Fast check: Are all Gemini keys daily exhausted?
  const allDailyExhausted = pool.length > 0 && pool.every(k => {
    const h = getKeyHealth(k);
    return h.isDailyExhausted && now < h.cooldownUntil;
  });

  if (allDailyExhausted) {
    console.warn(`[${operationName}] Circuit Breaker: All Gemini keys are DAILY_EXHAUSTED. Fast-failing to external failover...`);
    throw new Error("GEMINI_DAILY_EXHAUSTED: All Gemini API keys have reached their daily request limit.");
  }

  const models = usePro ? PRO_MODELS : FALLBACK_MODELS;
  let lastError: any;
  let totalAttempts = 0;
  const maxAttempts = 10;
  let allRateLimited = true;

  for (const modelId of models) {
    if (disabledModels.has(modelId)) continue;
    let skipModelToNext = false;

    // Filter keys into available candidates
    const availableKeys = pool.filter(k => {
      const h = getKeyHealth(k);
      return !h.isInvalid && (!h.isDailyExhausted || Date.now() >= h.cooldownUntil);
    });

    if (availableKeys.length === 0) continue;

    for (let i = 0; i < availableKeys.length; i++) {
      if (skipModelToNext || totalAttempts >= maxAttempts) break;

      const keyIndex = (currentKeyIndex + i) % availableKeys.length;
      const apiKey = availableKeys[keyIndex];
      const health = getKeyHealth(apiKey);

      // If key is temporarily in cooldown (e.g. RPM 60s or 503), check if another key is ready
      if (Date.now() < health.cooldownUntil) {
        const hasReadyKey = availableKeys.some(k => Date.now() >= getKeyHealth(k).cooldownUntil);
        if (hasReadyKey) {
          continue; // Pick a ready key first
        }
      }

      totalRequests++;
      totalAttempts++;

      try {
        const result = await Promise.race([
          operation(modelId, apiKey),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error(`MODEL_TIMEOUT: ${modelId} exceeded 12s`)), 12000)
          )
        ]);

        // SUCCESS: Reset circuit breaker for this key
        health.consecutiveFailures = 0;
        health.cooldownUntil = 0;
        health.lastSuccess = Date.now();
        health.totalHits++;
        currentKeyIndex = (keyIndex + 1) % availableKeys.length;
        return result;
      } catch (error: any) {
        lastError = error;
        const errorString = error?.toString() || "";
        const errorStatus = error?.status;
        const lowerError = errorString.toLowerCase();

        const isRateLimit =
          errorStatus === 429 ||
          error?.status === "RESOURCE_EXHAUSTED" ||
          errorString.includes("429") ||
          errorString.includes("Quota exceeded") ||
          errorString.includes("RESOURCE_EXHAUSTED");

        const isInvalidKey =
          errorStatus === 400 ||
          errorStatus === 403 ||
          errorStatus === 401 ||
          errorString.includes("API key not valid") ||
          errorString.includes("API_KEY_INVALID") ||
          lowerError.includes("unauthorized");

        const isServerError =
          errorStatus === 500 ||
          errorStatus === 503 ||
          errorString.includes("500") ||
          errorString.includes("503") ||
          errorString.includes("Internal Server Error") ||
          errorString.includes("Service Unavailable") ||
          errorString.includes("UNAVAILABLE") ||
          errorString.includes("experiencing high demand") ||
          lowerError.includes("model_timeout");

        const isModelNotFound =
          errorStatus === 404 ||
          lowerError.includes("not found") ||
          lowerError.includes("not supported") ||
          lowerError.includes("no longer available") ||
          errorString.includes("NOT_FOUND");

        health.consecutiveFailures++;
        health.lastErrorSnippet = errorString.slice(0, 100);

        if (isModelNotFound) {
          disabledModels.add(modelId);
          console.warn(`[${operationName}] Model ${modelId} not found (404). Disabled globally.`);
          skipModelToNext = true;
          break;
        }

        if (isInvalidKey) {
          health.isInvalid = true;
          health.cooldownUntil = Date.now() + 24 * 3600 * 1000;
          console.warn(`[${operationName}] Key ${getKeyId(apiKey)} is invalid. Cooldown 24h.`);
          continue;
        }

        if (isRateLimit) {
          rateLimitHits++;
          const isDaily =
            lowerError.includes("per day") ||
            lowerError.includes("daily") ||
            health.consecutiveFailures >= 3;

          if (isDaily) {
            health.isDailyExhausted = true;
            health.cooldownUntil = getMidnightUTCTimestamp();
            console.warn(`[${operationName}] Key ${getKeyId(apiKey)} hit DAILY cap. Cooldown until UTC midnight.`);
          } else {
            health.cooldownUntil = Date.now() + 65_000;
            console.warn(`[${operationName}] Key ${getKeyId(apiKey)} rate-limited (RPM). Cooldown 65s.`);
          }
          continue;
        }

        if (isServerError) {
          health.cooldownUntil = Date.now() + 35_000 + Math.floor(Math.random() * 15_000);
          console.warn(`[${operationName}] Key ${getKeyId(apiKey)} hit 503/timeout. Cooldown 35-50s.`);
          continue;
        }

        allRateLimited = false;
        continue;
      }
    }
    if (totalAttempts >= maxAttempts) break;
  }

  console.error(`[${operationName}] All Gemini keys/models exhausted. allRateLimited=${allRateLimited}`, lastError);

  const errorString = lastError?.toString() || "";
  const errorStatus = lastError?.status;
  const isActualRateLimit = 
    errorStatus === 429 || 
    errorStatus === 503 || 
    errorString.includes("429") || 
    errorString.includes("503") || 
    errorString.includes("RESOURCE_EXHAUSTED") ||
    errorString.includes("Quota exceeded") ||
    errorString.includes("GEMINI_DAILY_EXHAUSTED") ||
    errorString.includes("experiencing high demand");

  const lowerLastError = errorString.toLowerCase();
  const isTimeout = errorString.includes("MODEL_TIMEOUT") || lowerLastError.includes("timeout");

  if (isActualRateLimit && allRateLimited) {
    const isGoogleOutage = errorString.includes("503") || errorString.includes("experiencing high demand");
    if (isGoogleOutage) {
      throw new Error(
        "RATE_LIMITED: Google's AI servers are currently experiencing high demand across all regions. This is a temporary Google infrastructure issue — please retry in 30-60 seconds."
      );
    }
    throw new Error(
      "RATE_LIMITED: Our primary AI cluster is currently at capacity. Retrying automatically or failing over..."
    );
  }

  if (isTimeout && allRateLimited) {
    throw new Error(
      "RATE_LIMITED: AI models are not responding right now (Google infrastructure load). Please retry in 30-60 seconds."
    );
  }

  if (errorString.includes("safety") || errorString.includes("blocked")) {
    throw new Error("Content Blocked: The AI model flagged this document for safety reasons. Please ensure the content is professional and try again.");
  }

  if (errorString.includes("API key not valid") || errorString.includes("API_KEY_INVALID")) {
    throw new Error("API Key Error: One or more Gemini API keys are invalid. Please check your Vercel environment variables.");
  }

  throw new Error("Processing Interrupted: We encountered an unexpected issue while analyzing your resume. Retrying or failing over...");
}



const saveResumeTool: FunctionDeclaration = {
  name: "save_resume_data",
  description: "Saves the verbatim extracted resume data.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      fullName: { type: Type.STRING },
      contactInfo: {
        type: Type.OBJECT,
        properties: {
          email: { type: Type.STRING },
          phone: { type: Type.STRING },
          linkedin: { type: Type.STRING },
          website: { type: Type.STRING },
          location: { type: Type.STRING, description: "City, State, Zip Code" },
        }
      },
      
      summary: { type: Type.ARRAY, items: { type: Type.STRING } },
      sectionTitleSummary: { type: Type.STRING, description: "Exact title e.g. 'PROFILE SUMMARY'" },

      experience: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            company: { type: Type.STRING },
            title: { type: Type.STRING },
            dates: { type: Type.STRING },
            location: { type: Type.STRING },
            description: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
        },
      },
      sectionTitleExperience: { type: Type.STRING, description: "Exact title e.g. 'PROFESSIONAL EXPERIENCE'" },

      internships: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            company: { type: Type.STRING },
            title: { type: Type.STRING },
            dates: { type: Type.STRING },
            location: { type: Type.STRING },
            description: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
        },
      },
      sectionTitleInternships: { type: Type.STRING, description: "Exact title e.g. 'INTERNSHIPS'" },

      education: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            institution: { type: Type.STRING },
            degree: { type: Type.STRING },
            dates: { type: Type.STRING },
            location: { type: Type.STRING },
            details: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
        },
      },
      sectionTitleEducation: { type: Type.STRING, description: "Exact title e.g. 'EDUCATION'" },

      customSections: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { 
              type: Type.STRING, 
              description: "EXACT original title of ANY non-standard section header found in the resume. Examples: 'PUBLICATIONS', 'PATENTS', 'AWARDS & HONORS', 'KEY PROJECTS', 'VOLUNTEER EXPERIENCE', 'SPEAKING ENGAGEMENTS', 'LANGUAGES', 'TECHNICAL SKILLS', 'AFFILIATIONS', 'REFERENCES', or ANY OTHER section title." 
            },
            items: { 
              type: Type.ARRAY, 
              items: { type: Type.STRING }, 
              description: "Verbatim lines or bullet points under this custom section." 
            }
          },
          required: ["title", "items"]
        },
        description: "CRITICAL: EVERY single section header or title in the input document that is not mapped to summary, experience, internships, or education MUST be added here with its EXACT original title and all content lines. NEVER skip or drop ANY custom title or section."
      },
      
      extractionChanges: {
        type: Type.ARRAY,
        description: "List of changes made during extraction (e.g. removing phone numbers, formatting dates, adding missing titles)",
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            type: { type: Type.STRING, enum: ["REMOVAL", "ADDITION", "MODIFICATION"] },
            description: { type: Type.STRING, description: "What was changed (e.g. 'Removed phone number: +1-555-0100')" },
            reason: { type: Type.STRING, description: "Why it was changed (e.g. 'PII Removal Policy')" }
          },
          required: ["id", "type", "description", "reason"]
        }
      }
    },
    required: ["fullName", "experience", "education", "customSections"],
  },
};

const grammarAnalysisTool: FunctionDeclaration = {
  name: "save_grammar_issues",
  description: "Saves a list of grammar and spelling issues found in the resume.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      issues: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            path: { type: Type.STRING, description: "The JSON path to the field, e.g. 'summary.0', 'experience.0.description.2'" },
            original: { type: Type.STRING, description: "The full text content of the field" },
            errorText: { type: Type.STRING, description: "The EXACT substring that contains the error" },
            suggestions: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of 3 distinct improvement suggestions" },
            reason: { type: Type.STRING },
            type: { type: Type.STRING, enum: ["SPELLING", "GRAMMAR", "STYLE"], description: "The category of the issue" },
          },
          required: ["id", "path", "original", "errorText", "suggestions", "reason", "type"],
        },
      },
    },
    required: ["issues"],
  },
};

const cleanText = (text: string): string => {
  if (!text) return "";
  // Removes leading spaces, bullets (•, ·, -, *, ◆, ■, ●, etc)
  return text.replace(/^[\s\u2022\u00b7\-\*\u25c6\u25a0\u25cf\|]+/, "").trim();
};

const ACRONYMS = new Set([
  "IT", "AI", "ML", "PMO", "QA", "QC", "UI", "UX", "VP", "SVP", "EVP", "AVP",
  "CEO", "CTO", "CFO", "COO", "CIO", "CISO", "HR", "BI", "ETL", "SQL", "AWS",
  "GCP", "ERP", "CRM", "API", "PM", "BA", "DBA", "SRE", "DEVOPS", "II", "III", "IV", "V"
]);

const MINOR_WORDS = new Set(["and", "as", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to", "with"]);

const toTitleCaseIfAllCaps = (text: string): string => {
  if (!text) return "";
  const trimmed = text.trim();
  const hasLetters = /[A-Z]/.test(trimmed);
  const isAllCaps = trimmed === trimmed.toUpperCase() && hasLetters;

  if (!isAllCaps) return text; // If already mixed case, preserve verbatim!

  return trimmed
    .split(/\s+/)
    .map((word, idx) => {
      const pureAlpha = word.replace(/[^A-Za-z]/g, "");
      if (ACRONYMS.has(pureAlpha.toUpperCase())) {
        return word.replace(pureAlpha, pureAlpha.toUpperCase());
      }
      
      const lower = word.toLowerCase();
      if (idx > 0 && MINOR_WORDS.has(lower)) {
        return lower;
      }

      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
};

const normalizeDates = (dateStr: string): string => {
  if (!dateStr) return "";
  return dateStr
    .replace(/\s+to\s+/gi, " - ")
    .replace(/\s*[\u2013\u2014\-]\s*/g, " - ")
    .trim();
};

export interface FidelityAuditResult {
  passed: boolean;
  reason?: string;
  metrics?: {
    rawLength: number;
    extractedLength: number;
    rawBullets: number;
    extractedBullets: number;
    hasExperience: boolean;
  };
}

export const auditExtractedContentFidelity = (
  rawText: string | undefined,
  data: ResumeData
): FidelityAuditResult => {
  if (!rawText || rawText.trim().length < 80) {
    return { passed: true };
  }

  const cleanRaw = rawText.trim();
  const rawLength = cleanRaw.replace(/\s+/g, "").length;

  // 1. Candidate Full Name Guard
  if (!data.fullName || data.fullName.trim().length < 2) {
    return { passed: false, reason: "Candidate full name missing or empty in extracted output." };
  }

  // 2. Experience Presence Guard
  const rawMentionsExperience = /(?:experience|employment|work history|career history|professional background|positions held)/i.test(cleanRaw);
  const expCount = (data.experience?.length || 0) + (data.internships?.length || 0);
  const customHasExp = data.customSections?.some(s => /(?:experience|projects|work|history|employment)/i.test(s.title || ""));
  
  if (rawMentionsExperience && rawLength > 400 && expCount === 0 && !customHasExp) {
    return {
      passed: false,
      reason: "Document contains employment history, but extracted experience and internships are empty.",
      metrics: { rawLength, extractedLength: 0, rawBullets: 0, extractedBullets: 0, hasExperience: false }
    };
  }

  // 3. Bullet Count Retention Guard
  const bulletRegex = /^[\s]*[\u2022\u00b7\-\*\u25c6\u25a0\u25cf\u2713\u25aa\u25ba\u2192]\s+.+/gm;
  const rawBullets = (cleanRaw.match(bulletRegex) || []).length;

  let extractedBullets = 0;
  if (Array.isArray(data.summary)) extractedBullets += data.summary.length;
  data.experience?.forEach(exp => {
    if (Array.isArray(exp.description)) extractedBullets += exp.description.length;
  });
  data.internships?.forEach(exp => {
    if (Array.isArray(exp.description)) extractedBullets += exp.description.length;
  });
  data.education?.forEach(edu => {
    if (Array.isArray(edu.details)) extractedBullets += edu.details.length;
  });
  data.customSections?.forEach(sec => {
    if (Array.isArray(sec.items)) extractedBullets += sec.items.length;
  });

  if (rawBullets >= 8 && extractedBullets < Math.floor(rawBullets * 0.4)) {
    return {
      passed: false,
      reason: `Severe bullet loss detected: raw text had ${rawBullets} bullets, but model only extracted ${extractedBullets} (${Math.round((extractedBullets / rawBullets) * 100)}%).`,
      metrics: { rawLength, extractedLength: 0, rawBullets, extractedBullets, hasExperience: expCount > 0 }
    };
  }

  // 4. Character Volume Retention Guard
  let extractedLength = (data.fullName || "").length;
  data.summary?.forEach(s => extractedLength += s.length);
  data.experience?.forEach(exp => {
    extractedLength += (exp.company || "").length + (exp.title || "").length + (exp.location || "").length;
    exp.description?.forEach(d => extractedLength += d.length);
  });
  data.internships?.forEach(exp => {
    extractedLength += (exp.company || "").length + (exp.title || "").length + (exp.location || "").length;
    exp.description?.forEach(d => extractedLength += d.length);
  });
  data.education?.forEach(edu => {
    extractedLength += (edu.institution || "").length + (edu.degree || "").length;
    edu.details?.forEach(d => extractedLength += d.length);
  });
  data.customSections?.forEach(sec => {
    extractedLength += (sec.title || "").length;
    sec.items?.forEach(i => extractedLength += i.length);
  });

  if (rawLength > 1500 && extractedLength < rawLength * 0.20) {
    return {
      passed: false,
      reason: `Severe content shrinkage detected: raw document had ${rawLength} characters, but extracted content has only ${extractedLength} characters (${Math.round((extractedLength / rawLength) * 100)}%).`,
      metrics: { rawLength, extractedLength, rawBullets, extractedBullets, hasExperience: expCount > 0 }
    };
  }

  return { 
    passed: true, 
    metrics: { rawLength, extractedLength, rawBullets, extractedBullets, hasExperience: expCount > 0 } 
  };
};

export const getGroqApiKey = (): string | undefined => {
  return (
    process.env.GROQ_API_KEY ||
    process.env.GROK_API_KEY ||
    process.env.VITE_GROQ_API_KEY ||
    undefined
  );
};

export const extractWithGroq = async (
  text: string,
  format: ResumeFormat,
  apiKey: string
): Promise<ResumeData> => {
  const systemPrompt = `You are a professional verbatim resume data extraction engine.
CRITICAL MANDATORY RULES:
1. Extract the resume text into valid JSON matching this exact structure:
{
  "fullName": string,
  "contactInfo": {
    "email": string,
    "phone": string,
    "location": string,
    "linkedin": string,
    "website": string
  },
  "summary": string[],
  "experience": [
    {
      "company": string,
      "title": string,
      "dates": string,
      "location": string,
      "description": string[]
    }
  ],
  "education": [
    {
      "institution": string,
      "degree": string,
      "dates": string,
      "location": string,
      "details": string[]
    }
  ],
  "customSections": [
    {
      "title": string,
      "items": string[]
    }
  ]
}
2. ABSOLUTE ZERO LOSS & ZERO ALTERATION:
- Do NOT alter, summarize, or rephrase any text. Keep all words and bullet points 100% verbatim.
- Extract EVERY SINGLE experience role, bullet point, skill, education entry, and certification.
- If a section is not Summary, Experience, or Education (e.g. SKILLS, CERTIFICATIONS, PROJECTS, AWARDS), put it into customSections with its exact title.
3. Return ONLY valid JSON. No markdown backticks, no explanatory text.`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey.trim()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "qwen/qwen3.8-27b",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Extract this resume verbatim:\n\n${text}` }
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
        max_tokens: 8192
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Groq API returned HTTP ${res.status}: ${errText.slice(0, 150)}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Empty response from Groq engine.");
    }

    const parsed: ResumeData = JSON.parse(content);
    if (!parsed.contactInfo) parsed.contactInfo = {};
    if (!parsed.experience) parsed.experience = [];
    if (!parsed.education) parsed.education = [];
    if (!parsed.customSections) parsed.customSections = [];

    if (parsed.summary && typeof parsed.summary === "string") {
      parsed.summary = [(parsed as any).summary];
    }

    parsed.experience.forEach(exp => {
      if (typeof exp.description === "string") {
        exp.description = [(exp as any).description];
      }
      exp.dates = normalizeDates(exp.dates || "");
    });

    parsed.education.forEach(edu => {
      edu.dates = normalizeDates(edu.dates || "");
    });

    console.log(`[Groq Failover] Successfully extracted resume data for: ${parsed.fullName}`);
    return parsed;
  } finally {
    clearTimeout(timeoutId);
  }
};

export const updateResumeWithGroq = async (
  data: ResumeData,
  instruction: string,
  targetJobDescription: string | undefined,
  format: ResumeFormat,
  apiKey: string
): Promise<ResumeData> => {
  const jobContext = targetJobDescription 
    ? `\n\nTARGET JOB DESCRIPTION:\n${targetJobDescription}`
    : "";

  const systemPrompt = `You are an elite executive resume writer. Modify this JSON resume data strictly following the user's instructions.
CRITICAL RULES:
1. Preserve the exact structure of the resume.
2. Return ONLY valid JSON matching the exact schema. No markdown, no conversation.
3. Do NOT omit or truncate any section unless explicitly requested.
4. Keep all parts not affected by instructions 100% verbatim.`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey.trim()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "qwen/qwen3.8-27b",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `USER INSTRUCTIONS:\n${instruction}${jobContext}\n\nORIGINAL DATA:\n${JSON.stringify(data)}` }
        ],
        response_format: { type: "json_object" },
        temperature: 0.15,
        max_tokens: 8192
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`Groq API returned HTTP ${res.status}`);
    const resData = await res.json();
    const content = resData.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty response from Groq");
    const parsed: ResumeData = JSON.parse(content);
    return parsed;
  } finally {
    clearTimeout(timeoutId);
  }
};

export const checkSpellingWithGroq = async (
  data: ResumeData,
  format: ResumeFormat,
  apiKey: string
): Promise<ResumeData> => {
  const systemPrompt = `You are a strict proofreader. Fix spelling and grammar mistakes ONLY in this JSON resume data.
CRITICAL RULES:
1. Do NOT change technical terms, version numbers, or proper nouns.
2. Do NOT change dates, metrics, or factual information.
3. Do NOT shorten or delete any experiences or bullets.
4. Return ONLY valid JSON matching the exact input structure.`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey.trim()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "qwen/qwen3.8-27b",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Correct spelling and grammar in this JSON resume data:\n\n${JSON.stringify(data)}` }
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
        max_tokens: 8192
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`Groq API returned HTTP ${res.status}`);
    const resData = await res.json();
    const content = resData.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty response from Groq");
    return JSON.parse(content);
  } finally {
    clearTimeout(timeoutId);
  }
};

export const analyzeGrammarWithGroq = async (
  data: ResumeData,
  format: ResumeFormat,
  apiKey: string
): Promise<GrammarIssue[]> => {
  const systemPrompt = `You are a professional resume coach and proofreader.
Review the provided JSON resume data for spelling, grammar, and high-impact style improvements.
CRITICAL RULES:
1. Resumes must NEVER use first-person pronouns (I, me, my, we). Flag them as STYLE.
2. Flag weak verbs and suggest executive verbs (Spearheaded, Orchestrated, Engineered).
3. Return ONLY valid JSON with this exact structure:
{
  "issues": [
    {
      "id": string,
      "path": string,
      "original": string,
      "errorText": string,
      "suggestions": [string, string, string],
      "reason": string,
      "type": "SPELLING" | "GRAMMAR" | "STYLE"
    }
  ]
}
No markdown backticks, no conversation.`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey.trim()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "qwen/qwen3.8-27b",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Audit this resume data:\n\n${JSON.stringify(data)}` }
        ],
        response_format: { type: "json_object" },
        temperature: 0.15,
        max_tokens: 4096
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`Groq API returned HTTP ${res.status}`);
    const resData = await res.json();
    const content = resData.choices?.[0]?.message?.content;
    if (!content) return [];
    const parsed = JSON.parse(content);
    return parsed.issues || [];
  } catch (err: any) {
    console.warn("[Groq Grammar Failover] Warning:", err.message);
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
};

export const rewritePhraseWithGroq = async (
  text: string,
  instruction: string,
  apiKey: string
): Promise<string[]> => {
  const systemPrompt = `You are an executive resume coach. Provide exactly 3 distinct, high-impact improvements/rewrites for the provided text.
Return ONLY valid JSON with this format: { "suggestions": ["option 1", "option 2", "option 3"] }`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey.trim()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "qwen/qwen3.8-27b",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Instruction: "${instruction}"\n\nOriginal Text: "${text}"` }
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_tokens: 1024
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`Groq API returned HTTP ${res.status}`);
    const resData = await res.json();
    const content = resData.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty response from Groq");
    const parsed = JSON.parse(content);
    return parsed.suggestions || [text];
  } finally {
    clearTimeout(timeoutId);
  }
};

export const getHuggingFaceApiKey = (): string | undefined => {
  return (
    process.env.HF_TOKEN ||
    process.env.HUGGINGFACE_API_KEY ||
    process.env.VITE_HF_TOKEN ||
    undefined
  );
};

export const extractWithHuggingFace = async (
  text: string,
  format: ResumeFormat,
  token: string
): Promise<ResumeData> => {
  const systemPrompt = `You are a professional verbatim resume data extraction engine.
CRITICAL MANDATORY RULES:
1. Extract the resume text into valid JSON matching this exact structure:
{
  "fullName": string,
  "contactInfo": {
    "email": string,
    "phone": string,
    "location": string,
    "linkedin": string,
    "website": string
  },
  "summary": string[],
  "experience": [
    {
      "company": string,
      "title": string,
      "dates": string,
      "location": string,
      "description": string[]
    }
  ],
  "education": [
    {
      "institution": string,
      "degree": string,
      "dates": string,
      "location": string,
      "details": string[]
    }
  ],
  "customSections": [
    {
      "title": string,
      "items": string[]
    }
  ]
}
2. ABSOLUTE ZERO LOSS & ZERO ALTERATION:
- Do NOT alter, summarize, or rephrase any text. Keep all words and bullet points 100% verbatim.
- Extract EVERY SINGLE experience role, bullet point, skill, education entry, and certification.
- If a section is not Summary, Experience, or Education, put it into customSections with its exact title.
3. Return ONLY valid JSON. No markdown backticks, no conversational text.`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000);

  try {
    const res = await fetch("https://router.huggingface.co/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token.trim()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "Qwen/Qwen2.5-72B-Instruct",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Extract this resume verbatim:\n\n${text}` }
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
        max_tokens: 4096
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Hugging Face API returned HTTP ${res.status}: ${errText.slice(0, 150)}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Empty response from Hugging Face engine.");
    }

    const cleaned = content.replace(/```json/g, "").replace(/```/g, "").trim();
    const parsed: ResumeData = JSON.parse(cleaned);
    if (!parsed.contactInfo) parsed.contactInfo = {};
    if (!parsed.experience) parsed.experience = [];
    if (!parsed.education) parsed.education = [];
    if (!parsed.customSections) parsed.customSections = [];

    if (parsed.summary && typeof parsed.summary === "string") {
      parsed.summary = [(parsed as any).summary];
    }

    parsed.experience.forEach(exp => {
      if (typeof exp.description === "string") {
        exp.description = [(exp as any).description];
      }
      exp.dates = normalizeDates(exp.dates || "");
    });

    parsed.education.forEach(edu => {
      edu.dates = normalizeDates(edu.dates || "");
    });

    console.log(`[HuggingFace Failover] Successfully extracted resume data for: ${parsed.fullName}`);
    return parsed;
  } finally {
    clearTimeout(timeoutId);
  }
};

export const extractResumeDataBackend = async (
  payload: { base64?: string; text?: string; mimeType: string; format: ResumeFormat },
  usePro: boolean = false
): Promise<ResumeData> => {
  // Pre-flight Data Integrity Check: Ensure document has viable content before invoking AI
  const hasText = payload.text && payload.text.trim().length >= 10;
  const hasBase64 = payload.base64 && payload.base64.trim().length >= 50;
  if (!hasText && !hasBase64) {
    throw new Error("The uploaded file contains no readable text or content. Please upload a valid document.");
  }

  // Check in-memory extraction cache to preserve quota across repeated user requests
  const contentSnippet = payload.text 
    ? payload.text.slice(0, 100) + payload.text.length
    : (payload.base64 ? payload.base64.slice(0, 100) + payload.base64.length : "");
  const cacheKey = `${payload.format}_${payload.mimeType}_${contentSnippet}`;
  const cached = extractionCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log(`[extractResumeData] Returning cached extraction for key: ${cacheKey.substring(0, 40)}...`);
    return JSON.parse(JSON.stringify(cached.data));
  }

  let result: ResumeData;
  try {
    result = await withModelFallback(async (modelId, apiKey) => {
      const ai = new GoogleGenAI({ 
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
    const parts: any[] = [];
    
    // CRITICAL FIX: Prioritize full extracted raw text if available.
    // When base64 was sent alongside or before text, Gemini multimodal vision received the binary and truncated processing after Page 1.
    // Client-side text parsers (pdfjs/mammoth) extract text from ALL pages, so text MUST be passed as the primary input.
    const isSupportedMultimodal =
      payload.mimeType === 'application/pdf' ||
      (payload.mimeType && payload.mimeType.startsWith('image/'));

    if (payload.text && payload.text.trim().length > 0) {
      parts.push({
        text: `Here is the COMPLETE, FULL VERBATIM raw text content extracted from all pages of the multi-page resume:\n\n${payload.text}`
      });
    } else if (payload.base64 && isSupportedMultimodal) {
      parts.push({
        inlineData: {
          data: payload.base64,
          mimeType: payload.mimeType,
        },
      });
    }

    parts.push({
      text: `Extract resume data for the ${payload.format} style. 
      
      STYLE-SPECIFIC INSTRUCTIONS:
      ${payload.format === ResumeFormat.MODERN_EXECUTIVE 
        ? "- Ensure location (City, State, Zip) is clearly extracted. Abbreviate months to 3 letters (e.g., 'Jan') for internal normalization." 
        : "- Abbreviate months to 3 letters (e.g., 'Jan')."}
      
      MANDATORY MULTI-PAGE COMPLETION RULES:
      - NEVER CONDENSE TO 1 PAGE. If the input document contains 2, 3, 4, or 5 pages of history, YOU MUST EXTRACT EVERY SINGLE PAGE THROUGH TO THE VERY LAST PAGE.
      - Extract EVERY single historical role, job title, company name, employment dates, bullet point, project, skill, and certification from ALL pages.
      - ZERO BULLET LOSS: If a job has 5, 10, or 15 bullet points, YOU MUST EXTRACT EVERY SINGLE ONE. Never cut off, shorten, or omit any bullet points under any job.
      - ZERO EXPERIENCE DROPPED: Keep every job, role, and position (including early career, past positions, and internships) in 'experience' in their original chronological order. Only populate 'internships' if the resume has an explicit separate header specifically titled 'INTERNSHIPS'.
      - Map standard sections (Summary, Professional Experience, Education) to their respective fields.
      - ANY OTHER section header or title (e.g. 'PUBLICATIONS', 'PATENTS', 'AWARDS & HONORS', 'VOLUNTEER WORK', 'KEY PROJECTS', 'PROJECTS', 'LANGUAGES', 'AFFILIATIONS', 'REFERENCES', 'CERTIFICATIONS', 'COMPETENCIES', 'OTHER EXPERIENCE', or ANY custom header title) MUST be extracted into 'customSections' with its EXACT section title as written in the original resume.
      - Do NOT stop after the first section or page. Read through to the very end of the text and extract every job, title, company, bullet point, skill, certification, and education item.
      - If a work experience section contains bullet points without an explicit company name or job title header in the text, set company and title to empty strings "". DO NOT insert fake, duplicate, or redundant placeholder strings like 'Professional Experience' or 'Key Responsibilities'. Put all bullet points cleanly into 'description'.
      CRITICAL: For contactInfo.location, extract City, State, and Zip Code if available. 
      CRITICAL: For dates, if a month is present, abbreviate it to 3 letters (e.g., 'Jan'). If NO month is present, DO NOT add one (e.g., keep '2023' as '2023'). 
      CRITICAL: Remove ALL phone numbers and email addresses from the main content, but keep them in the contactInfo fields if found. 
      CRITICAL: Split inline lists separated by "◆", "•", or "|" into separate array items.
      
      ABSOLUTE STRICTEST RULE - ZERO ALTERATION & ZERO LOSS:
      1. ZERO REWRITING / ZERO REPHRASING: You are strictly FORBIDDEN from altering, polishing, rephrasing, rewriting, summarizing, or changing any wording. Every single word must be copied 100% verbatim.
      2. ZERO DATA LOSS: Extract EVERY SINGLE WORD, bullet point, job role, skill, and line from ALL pages of the input text. Loss of any data or section is completely unacceptable.`,
    });

    const response = await ai.models.generateContent({
      model: modelId,
      contents: {
        parts: parts,
      },
      config: {
        maxOutputTokens: 8192,
        temperature: 0.15,
        systemInstruction: `
STRICT DATA EXTRACTOR DIRECTIVE:
1. ZERO ALTERATION: You are strictly FORBIDDEN from changing, rephrasing, rewriting, polishing, summarizing, or modifying ANY words, bullet points, or sentences. Preserve 100% exact verbatim original text.
2. ZERO OMISSION - ALL PAGES & ALL EXPERIENCES MANDATORY: The input resume is a multi-page document. You MUST extract EVERY experience entry, job title, company name, education entry, custom section, bullet point, and line from Page 1, Page 2, Page 3, and all following pages. Never drop or skip any historical job, early role, or detail. Page limits DO NOT APPLY.
3. ZERO BULLET LOSS: Extract ALL bullet points for each company in full verbatim text. Do NOT truncate, shorten, or pick only the top 2-3 bullets.
4. VERBATIM SECTION MAPPING: Profile/Summary -> summary, Job History/Employment/Roles -> experience (keep ALL jobs in experience), Education -> education, Skills/Certifications/Projects -> customSections. Only use 'internships' if the resume has an explicit separate section titled 'INTERNSHIPS'.
5. Clean up artificial spacing/ligature splitting from PDF text extraction (e.g. convert 'fi eld' to 'field', 'sta ff' to 'staff'), but NEVER alter any words or content.
`,
        tools: [{ functionDeclarations: [saveResumeTool] }],
        toolConfig: { 
          functionCallingConfig: { 
            mode: "ANY" as any, 
            allowedFunctionNames: ["save_resume_data"]
          } 
        },
      },
    });

    let data: ResumeData | null = null;

    const functionCalls = response.functionCalls;
    if (functionCalls && functionCalls.length > 0) {
      const call = functionCalls[0];
      if (call.name === "save_resume_data") {
         data = call.args as unknown as ResumeData;
      }
    }

    if (!data && response.text) {
      try {
        const cleanedText = response.text.replace(/```json/g, "").replace(/```/g, "").trim();
        data = JSON.parse(cleanedText);
      } catch (e) {
        console.warn("Failed to parse response.text as JSON:", e);
      }
    }

    if (data) {
       if (!data.contactInfo) data.contactInfo = {};

       // Clean bullets
       if (data.summary) {
          if (typeof data.summary === 'string') {
              data.summary = [(data as any).summary];
          }
          data.summary = data.summary
            .map(cleanText)
            .filter(item => 
              item.trim().toLowerCase() !== "summary" && 
              item.trim().toLowerCase() !== "core technical expertise" &&
              item.trim().toLowerCase() !== "profile summary"
            );
          if (data.summary.length === 0) delete (data as any).summary;
       }
       if (data.experience) {
         data.experience.forEach(exp => {
           if (exp.description) exp.description = exp.description.map(cleanText);
           if (exp.dates) exp.dates = normalizeDates(exp.dates);
           if (exp.company && (exp.company.toLowerCase() === 'professional experience' || exp.company.toLowerCase() === 'work history')) {
             exp.company = "";
           }
           if (exp.title && (exp.title.toLowerCase() === 'key responsibilities / achievements' || exp.title.toLowerCase() === 'responsibilities')) {
             exp.title = "";
           }
           if (exp.title) exp.title = toTitleCaseIfAllCaps(exp.title);
           if (exp.company) exp.company = toTitleCaseIfAllCaps(exp.company);
         });
       }
       if (data.internships) {
          data.internships.forEach(exp => {
            if (exp.description) exp.description = exp.description.map(cleanText);
            if (exp.dates) exp.dates = normalizeDates(exp.dates);
            if (exp.title) exp.title = toTitleCaseIfAllCaps(exp.title);
            if (exp.company) exp.company = toTitleCaseIfAllCaps(exp.company);
          });
       }
       if (data.education) {
          data.education = data.education.filter(edu => {
             if (edu.details) {
                 edu.details = edu.details.map(cleanText).filter(item => 
                   item.trim().toLowerCase() !== (edu.institution || "").trim().toLowerCase() &&
                   item.trim().toLowerCase() !== "education"
                 );
             }
             const inst = (edu.institution || "").trim().toLowerCase();
             const deg = (edu.degree || "").trim().toLowerCase();
             const hasInst = inst !== "" && inst !== "education";
             const hasDeg = deg !== "" && deg !== "education";
             const hasDetails = edu.details && edu.details.length > 0;
             return hasInst || hasDeg || hasDetails;
          });
       }
       if (data.customSections) {
           data.customSections = data.customSections.filter(sec => {
               if (!sec.title || sec.title.trim() === "") {
                   sec.title = "TECHNICAL SKILLS & DETAILS";
               }
               if (sec.items) {
                   sec.items = sec.items.map(cleanText).filter(item => item.trim().toLowerCase() !== sec.title.trim().toLowerCase());
               }
               return sec.items && sec.items.length > 0;
           });
       }

        // SDET Quality Assertion: Validate Candidate Name
        if (!data.fullName || data.fullName.trim() === "") {
          if (payload.text) {
            const firstLine = payload.text.trim().split('\n').map(l => l.trim()).find(l => l.length > 2 && l.length < 50 && !l.toLowerCase().includes('page'));
            if (firstLine) {
              data.fullName = toTitleCaseIfAllCaps(firstLine.replace(/[^a-zA-Z\s.-]/g, '').trim());
            }
          }
        }

        // Strict SDET Quality Assertion: Never accept an empty experience array if raw text has employment history
        const rawHasExperience = payload.text && /experience|employment|work history|career/i.test(payload.text);
        const hasCustomExp = data.customSections && data.customSections.some(s => /experience|projects|work|history/i.test(s.title || ""));
        if (rawHasExperience && (!data.experience || data.experience.length === 0) && (!data.internships || data.internships.length === 0) && !hasCustomExp) {
          throw new Error("MODEL_DEFECT: Model returned empty experience despite raw document containing employment history.");
        }

        // Strict SDET Quality Assertion: Validate content fidelity to prevent shrinkage/truncation
        const fidelityAudit = auditExtractedContentFidelity(payload.text, data);
        if (!fidelityAudit.passed) {
          console.warn(`[extractResumeData] Gemini output failed fidelity audit: ${fidelityAudit.reason}`);
          throw new Error(`MODEL_FIDELITY_FAILURE: ${fidelityAudit.reason}`);
        }

       return data;
    }
    
    throw new Error("The AI model did not trigger the extraction tool correctly.");
  }, "extractResumeData", usePro);
  } catch (geminiError: any) {
    // Failover Tier 2: Groq Cloud Engine
    const groqKey = getGroqApiKey();
    if (groqKey && payload.text && payload.text.trim().length >= 10) {
      console.warn(`[extractResumeData] Gemini unavailable or lossy (${geminiError.message}). Initiating Tier 2 Groq failover...`);
      try {
        result = await extractWithGroq(payload.text, payload.format, groqKey);
        const groqAudit = auditExtractedContentFidelity(payload.text, result);
        if (groqAudit.passed) {
          console.log(`[extractResumeData] Groq output passed fidelity audit. Successfully processed.`);
          extractionCache.set(cacheKey, { timestamp: Date.now(), data: result });
          return result;
        }
        console.warn(`[extractResumeData] Groq output failed fidelity audit: ${groqAudit.reason}`);
      } catch (groqErr: any) {
        console.error("[extractResumeData] Tier 2 Groq failover error:", groqErr.message);
      }
    }

    // Failover Tier 3: Hugging Face Serverless Router
    const hfToken = getHuggingFaceApiKey();
    if (hfToken && payload.text && payload.text.trim().length >= 10) {
      console.warn(`[extractResumeData] Initiating Tier 3 Hugging Face failover...`);
      try {
        result = await extractWithHuggingFace(payload.text, payload.format, hfToken);
        const hfAudit = auditExtractedContentFidelity(payload.text, result);
        if (hfAudit.passed) {
          console.log(`[extractResumeData] Hugging Face output passed fidelity audit. Successfully processed.`);
          extractionCache.set(cacheKey, { timestamp: Date.now(), data: result });
          return result;
        }
        console.warn(`[extractResumeData] Hugging Face output failed fidelity audit: ${hfAudit.reason}`);
      } catch (hfErr: any) {
        console.error("[extractResumeData] Tier 3 Hugging Face failover error:", hfErr.message);
      }
    }

    throw geminiError;
  }

  extractionCache.set(cacheKey, { timestamp: Date.now(), data: result });
  return result;
};

export const analyzeGrammarBackend = async (data: ResumeData, format: ResumeFormat, usePro: boolean = false): Promise<GrammarIssue[]> => {
  try {
    return await withModelFallback(async (modelId, apiKey) => {
      const ai = new GoogleGenAI({ 
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });
      
      const response = await ai.models.generateContent({
        model: modelId,
        contents: {
          parts: [
            {
              text: `Review the following resume data for spelling, grammar, and smart stylistic improvements. 
              
              CRITICAL INSTRUCTIONS:
              1. **Spelling**: Identify and fix ANY spelling mistakes, typos, or extra spaces (e.g., "follow-the- sun" -> "follow-the-sun"). Categorize as 'SPELLING'.
              2. **Grammar & Verb Tense**: Identify grammatical errors, incorrect verb tenses, or punctuation issues. Categorize as 'GRAMMAR'.
              3. **First-Person Pronouns**: Resumes should NEVER use first-person pronouns (I, me, my, mine, we, us, our). Flag ANY instance of these words. Provide suggestions that rewrite the sentence to remove them (e.g., change "I led a team" to "Led a team"). Categorize as 'STYLE'.
              4. **Smart Resume Coach (Style)**: 
                 - **Weak Action Verbs**: Audit for lazy, overused action verbs like "helped with", "handled", "worked on", "responsible for", "made sure", "managed". Suggest strong dynamic verbs like "Orchestrated", "Spearheaded", "Architected", "Engineered", "Synthesized", "Pioneered".
                 - **Passive Voice Restructuring**: Flag passive phrasing (e.g., "A new platform was developed by me") and suggest active phrasing ("Pioneered the development of a new platform").
                 - **Buzzword & Cliché Auditing**: Flag weak clichés ("synergy", "think outside the box", "team player", "hard worker", "results-driven") and suggest concrete, professional, or metric-oriented replacements.
                 - **Impact & Metrics Positioning**: Identify descriptions that describe duties without outcomes. Recommend restructures that highlight achievements and placeholders for metrics (e.g., restructured sentences ending with "...resulting in a [X]% increase in throughput").
                 - **Exclusions**: DO NOT flag technical terms, version numbers, framework names, dates, or proper nouns.
                 - Ensure suggestions make logical sense for the specific line, industry, and context.
                 - DO NOT just swap single words if it makes the sentence read awkwardly. Instead, select the entire phrase or sentence as the 'errorText' and provide a fully rewritten, polished version as the 'suggestions'.
                 - Categorize all of these as 'STYLE'.
              5. **Precision & Safety**: DO NOT change dates, numbers, metrics, factual information, or proper nouns. DO NOT hallucinate new skills or experiences.
              6. **Context**: For each issue, explain WHY the change is recommended (e.g., "Using 'Spearheaded' instead of 'Led' adds more executive impact, and restructuring the sentence highlights the 30% metric better.").
              7. **Replacement Integrity**: 
                 - 'errorText' MUST be the EXACT substring from the 'original' text. It must match character-for-character, including spaces and punctuation.
                 - 'suggestions' MUST be drop-in replacements for 'errorText'. 
                 - If 'errorText' is a whole sentence, 'suggestions' should be whole sentences.
                 - NEVER return a suggestion that is a partial correction of the 'errorText' if 'errorText' is a whole sentence.
              8. Return a list of issues using the 'save_grammar_issues' tool. You MUST find at least 2-3 stylistic improvements to make the resume read like it was polished by an executive coach.
              9. For each issue, provide:
                 - 'path': The exact JSON path (dot notation).
                 - 'original': The FULL text content of that field.
                 - 'errorText': The EXACT substring within 'original' that is incorrect or could be improved.
                 - 'suggestions': Provide exactly 3 distinct options to fix or improve the text.
                 - 'reason': A detailed explanation of the error or improvement opportunity.
                 - 'type': One of 'SPELLING', 'GRAMMAR', or 'STYLE'.
              
              DATA:
              ${JSON.stringify(data)}`
            }
          ],
        },
        config: {
          maxOutputTokens: 8192,
          temperature: 0.15,
          systemInstruction: `
  ACT AS A SMART RESUME COACH. You are allowed to fix objective spelling and grammar errors, and provide high-impact stylistic improvements. You MUST strictly enforce the rule against using first-person pronouns (I, me, my, we, etc.) in resumes. You are forbidden from hallucinating facts, changing metrics, or altering dates.
  `,
          tools: [{ functionDeclarations: [grammarAnalysisTool] }],
          toolConfig: { 
            functionCallingConfig: { 
              mode: "ANY" as any, 
              allowedFunctionNames: ["save_grammar_issues"]
            } 
          },
        },
      });

      const functionCalls = response.functionCalls;
      if (functionCalls && functionCalls.length > 0) {
        const call = functionCalls[0];
        if (call.name === "save_grammar_issues") {
           const args = call.args as unknown as { issues: GrammarIssue[] };
           return args.issues || [];
        }
      }
      
      return []; // No issues found or model didn't call tool
    }, "analyzeGrammar", usePro);
  } catch (geminiError: any) {
    const groqKey = getGroqApiKey();
    if (groqKey) {
      console.warn(`[analyzeGrammar] Gemini unavailable (${geminiError.message}). Initiating Groq failover...`);
      try {
        return await analyzeGrammarWithGroq(data, format, groqKey);
      } catch (groqErr: any) {
        console.error("[analyzeGrammar] Groq failover error:", groqErr.message);
      }
    }
    throw geminiError;
  }
};

export const checkSpellingBackend = async (data: ResumeData, format: ResumeFormat, usePro: boolean = false): Promise<ResumeData> => {
  try {
    return await withModelFallback(async (modelId, apiKey) => {
      const ai = new GoogleGenAI({ 
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });
      
      const response = await ai.models.generateContent({
        model: modelId,
        contents: {
          parts: [
            {
              text: `Review the following resume data STRICTLY for spelling and grammar errors.
              
              CRITICAL INSTRUCTIONS:
              1. Fix standard English spelling and grammar mistakes ONLY.
              2. DO NOT change any technical terms, version numbers, framework names, or proper nouns (e.g., 'React', 'v14.2', 'K8s', 'Kubernetes', 'SQL', 'NoSQL').
              3. DO NOT change dates, numbers, or factual information.
              4. DO NOT make stylistic changes, change vocabulary, or alter the tone.
              5. DO NOT change the structure of the data.
              6. Return the corrected JSON using the 'save_resume_data' tool.
              
              DATA:
              ${JSON.stringify(data)}`
            }
          ],
        },
        config: {
          maxOutputTokens: 8192,
          temperature: 0.15,
          systemInstruction: `
  ACT AS A STRICT PROOFREADER. You are only allowed to fix clear, objective spelling and grammar errors. 
  - You are strictly forbidden from summarizing, rephrasing, shortening, or deleting any experiences, bullet points, or sections. 
  - Do not make any stylistic changes, vocabulary alterations, or tone modifications. Keep every word identical to the input unless correcting a spelling mistake.
  - You must preserve the schema structure and use the 'save_resume_data' tool to return the modified data.
  `,
          tools: [{ functionDeclarations: [saveResumeTool] }],
          toolConfig: { 
            functionCallingConfig: { 
              mode: "ANY" as any, 
              allowedFunctionNames: ["save_resume_data"]
            } 
          },
        },
      });

      const functionCalls = response.functionCalls;
      if (functionCalls && functionCalls.length > 0) {
        const call = functionCalls[0];
        if (call.name === "save_resume_data") {
           const correctedData = call.args as unknown as ResumeData;
           
           if (correctedData.summary) {
              if (typeof correctedData.summary === 'string') {
                  correctedData.summary = [correctedData.summary];
              }
           }

           return correctedData;
        }
      }
      
      throw new Error("The AI model did not return corrected data.");
    }, "checkSpelling", usePro);
  } catch (geminiError: any) {
    const groqKey = getGroqApiKey();
    if (groqKey) {
      console.warn(`[checkSpelling] Gemini unavailable (${geminiError.message}). Initiating Groq failover...`);
      try {
        return await checkSpellingWithGroq(data, format, groqKey);
      } catch (groqErr: any) {
        console.error("[checkSpelling] Groq failover error:", groqErr.message);
      }
    }
    throw geminiError;
  }
};

const rewritePhraseTool: FunctionDeclaration = {
  name: "save_rewrite_suggestions",
  description: "Saves list of 3 distinct rewrite suggestions.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      suggestions: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "Exactly 3 high-impact rewrite suggestions matching the instruction"
      }
    },
    required: ["suggestions"]
  }
};

export const updateResumeBackend = async (
  data: ResumeData,
  instruction: string,
  targetJobDescription: string | undefined,
  format: ResumeFormat,
  usePro: boolean = false
): Promise<ResumeData> => {
  try {
    return await withModelFallback(async (modelId, apiKey) => {
      const ai = new GoogleGenAI({ 
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      const jobContext = targetJobDescription 
        ? `\n\nTARGET JOB DESCRIPTION:\n${targetJobDescription}`
        : "";

      const response = await ai.models.generateContent({
        model: modelId,
        contents: {
          parts: [
            {
              text: `You are an elite executive resume writer. Your task is to update this resume according to the user's instructions.
              
              USER INSTRUCTIONS:
              ${instruction}${jobContext}
              
              CRITICAL RULES:
              1. Preserve the exact structure of the resume.
              2. Do not omit or truncate any section unless explicitly requested.
              3. Do not invent new details (jobs, degrees, certifications) that the user did not specify.
              4. Make the formatting matches the ${format} style.
              5. Return the fully updated resume data using the 'save_resume_data' tool.
              
              ORIGINAL DATA:
              ${JSON.stringify(data)}`
            }
          ],
        },
        config: {
          maxOutputTokens: 8192,
          temperature: 0.15,
          systemInstruction: `
  ACT AS AN EXPERT RESUME EDITOR. Modify the JSON resume data strictly following the user's instructions. 
  - You are forbidden from summarizing, shortening, deleting, or omitting any experiences, custom sections, or bullet points unless the user explicitly instructs you to do so.
  - Keep all parts of the resume that are not affected by the user's instruction 100% identical to the original, verbatim.
  - You must preserve the schema structure and use the 'save_resume_data' tool to return the modified data.
  `,
          tools: [{ functionDeclarations: [saveResumeTool] }],
          toolConfig: { 
            functionCallingConfig: { 
              mode: "ANY" as any, 
              allowedFunctionNames: ["save_resume_data"]
            } 
          },
        },
      });

      const functionCalls = response.functionCalls;
      if (functionCalls && functionCalls.length > 0) {
        const call = functionCalls[0];
        if (call.name === "save_resume_data") {
           const updatedData = call.args as unknown as ResumeData;
           
           if (updatedData.summary) {
              if (typeof updatedData.summary === 'string') {
                  updatedData.summary = [updatedData.summary];
              }
           }
           return updatedData;
        }
      }
      
      throw new Error("The AI model did not return updated resume data.");
    }, "updateResume", usePro);
  } catch (geminiError: any) {
    const groqKey = getGroqApiKey();
    if (groqKey) {
      console.warn(`[updateResume] Gemini unavailable (${geminiError.message}). Initiating Groq failover...`);
      try {
        return await updateResumeWithGroq(data, instruction, targetJobDescription, format, groqKey);
      } catch (groqErr: any) {
        console.error("[updateResume] Groq failover error:", groqErr.message);
      }
    }
    throw geminiError;
  }
};

export const rewritePhraseBackend = async (
  text: string,
  instruction: string,
  usePro: boolean = false
): Promise<string[]> => {
  try {
    return await withModelFallback(async (modelId, apiKey) => {
      const ai = new GoogleGenAI({ 
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      const response = await ai.models.generateContent({
        model: modelId,
        contents: {
          parts: [
            {
              text: `Provide exactly 3 distinct, high-impact improvements/rewrites for this text.
              
              TEXT:
              "${text}"
              
              INSTRUCTION / TONE TO APPLY:
              "${instruction}"
              
              Ensure suggestions make logical sense for a professional resume and are direct replacements for the text.`
            }
          ],
        },
        config: {
          maxOutputTokens: 8192,
          temperature: 0.3,
          systemInstruction: `
  ACT AS AN EXECUTIVE RESUME COACH. Provide 3 high-impact direct replacement options matching the style instruction. Use the 'save_rewrite_suggestions' tool.
  `,
          tools: [{ functionDeclarations: [rewritePhraseTool] }],
          toolConfig: { 
            functionCallingConfig: { 
              mode: "ANY" as any, 
              allowedFunctionNames: ["save_rewrite_suggestions"]
            } 
          },
        },
      });

      const functionCalls = response.functionCalls;
      if (functionCalls && functionCalls.length > 0) {
        const call = functionCalls[0];
        if (call.name === "save_rewrite_suggestions") {
           const args = call.args as unknown as { suggestions: string[] };
           return args.suggestions || [];
        }
      }
      
      return [text];
    }, "rewritePhrase", usePro);
  } catch (geminiError: any) {
    const groqKey = getGroqApiKey();
    if (groqKey) {
      console.warn(`[rewritePhrase] Gemini unavailable (${geminiError.message}). Initiating Groq failover...`);
      try {
        return await rewritePhraseWithGroq(text, instruction, groqKey);
      } catch (groqErr: any) {
        console.error("[rewritePhrase] Groq failover error:", groqErr.message);
      }
    }
    throw geminiError;
  }
};

export const performOcrBackend = async (
  base64: string,
  mimeType: string,
  usePro: boolean = false
): Promise<string> => {
  return withModelFallback(async (modelId, apiKey) => {
    const ai = new GoogleGenAI({ 
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });

    const response = await ai.models.generateContent({
      model: modelId,
      contents: {
        parts: [
          {
            inlineData: {
              data: base64,
              mimeType: mimeType,
            },
          },
          {
            text: "Perform high-fidelity OCR on this resume or document image. Extract all text content verbatim, preserving the order, layout, headings, and bullet points. Do not omit, summarize, or alter any details. Do not add any introductory or concluding remarks, just return the extracted text.",
          }
        ]
      },
      config: {
        maxOutputTokens: 8192,
        temperature: 0.1,
      }
    });

    return response.text || "";
  }, "OCR", usePro);
};

