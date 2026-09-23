import { GoogleGenAI, Type, ThinkingLevel, FunctionDeclaration } from "@google/genai";
import { ResumeData, ResumeFormat, GrammarIssue } from "../src/types";

let currentKeyIndex = 0;
let totalRequests = 0;
let rateLimitHits = 0;

export const getUsageStatsBackend = (usePro: boolean = false) => {
  const pool = getKeyPool();
  const models = usePro ? PRO_MODELS : FALLBACK_MODELS;
  return {
    activeKeyIndex: currentKeyIndex % (pool.length || 1),
    totalKeys: pool.length,
    totalRequests,
    rateLimitHits,
    activeModel: models[0]
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

const getNextApiKey = () => {
  const pool = getKeyPool();
  if (pool.length === 0) return "";
  const key = pool[currentKeyIndex % pool.length];
  // Rotate round-robin across requests to balance traffic evenly across free keys
  currentKeyIndex = (currentKeyIndex + 1) % pool.length;
  return key;
};

// ──────────────────────────────────────────────────────────────────
// ACTIVE FREE-TIER MODELS (as of 2026-09-23)
// Per Google AI Studio → all on 15 RPM / key, combined 60 RPM with 4 keys
//
// gemini-3.8-flash       → PRIMARY (state-of-the-art, full parsing, 8192 tokens)
// gemini-3.1-flash-lite  → LIGHTWEIGHT (near-instant ~400ms, grammar/bullets)
// gemini-3.5-flash       → BACKUP (reliable fallback for regional 503 spikes)
// gemini-3.1-pro-preview → REASONING (complex career restructuring + JD matching)
//
// Retired (404): gemini-1.5-flash, gemini-1.5-pro, gemini-2.0-flash, gemini-2.0-pro
// ──────────────────────────────────────────────────────────────────

// Standard (free-tier) model pool — tried in order, each key rotated round-robin
const FALLBACK_MODELS = [
  "gemini-3.8-flash",       // 🟢 PRIMARY: State-of-the-art, 15 RPM/key, 60 RPM combined
  "gemini-3.1-flash-lite",  // ⚡ LIGHTWEIGHT: ~400ms latency, high volume backup
  "gemini-3.5-flash",       // 🔵 BACKUP: Regional 503 fallback, proven reliable
];

// Pro model pool — enables gemini-3.1-pro-preview for deep reasoning tasks
const PRO_MODELS = [
  "gemini-3.8-flash",       // 🟢 PRIMARY
  "gemini-3.5-flash",       // 🔵 BACKUP
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
  let lastError: any;
  const pool = getKeyPool();
  
  if (pool.length === 0) {
    throw new Error("No API Keys found on the server. Please configure GEMINI_API_KEY in server secrets.");
  }

  const models = usePro ? PRO_MODELS : FALLBACK_MODELS;

  // We try up to 12 times total across keys and models
  let totalAttempts = 0;
  const maxAttempts = 12;
  let allRateLimited = true;

  for (const modelId of models) {
    let skipModelToNext = false;
    for (let i = 0; i < pool.length; i++) {
      if (skipModelToNext || totalAttempts >= maxAttempts) break;

      const apiKey = getNextApiKey();
      totalRequests++;
      totalAttempts++;

      try {
        // SDET Guard: 12-second per-call timeout (reduced from 20s to cut silent-hang lag on broken models)
        return await Promise.race([
          operation(modelId, apiKey),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error(`MODEL_TIMEOUT: ${modelId} exceeded 12s`)), 12000)
          )
        ]);
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

        if (isRateLimit) rateLimitHits++;
        if (!isRateLimit && !isServerError && !isModelNotFound) {
          allRateLimited = false;
        }

        const errType = isServerError 
          ? "SERVER_OVERLOAD(503)" 
          : isRateLimit 
            ? "RATE_LIMIT(429)" 
            : isModelNotFound 
              ? "NOT_FOUND(404)" 
              : isInvalidKey 
                ? "INVALID_KEY" 
                : "ERROR";

        console.warn(`[${operationName}] Model ${modelId} (Attempt ${totalAttempts}/${maxAttempts}) → ${errType}: ${errorString.substring(0, 100)}`);

        // If the model is retired (404) or experiencing high demand / 503 across Google's infrastructure,
        // trying more keys on the same overloaded model will also fail and cause unnecessary lag.
        // Skip remaining keys for this model and jump directly to the next healthy model.
        if (isModelNotFound || (isServerError && (lowerError.includes("high demand") || errorStatus === 503))) {
          console.warn(`[${operationName}] Model ${modelId} unavailable/overloaded (503/404). Fast-skipping to next model.`);
          skipModelToNext = true;
          break;
        }

        // If invalid key, rotate to next key in pool
        if (isInvalidKey) {
          continue;
        }

        // For rate limit (429) or transient 503, try next key in pool
        continue;
      }
    }
    if (totalAttempts >= maxAttempts) break;
  }

  console.error(`[${operationName}] All attempts exhausted. allRateLimited=${allRateLimited}`, lastError);

  const errorString = lastError?.toString() || "";
  const errorStatus = lastError?.status;
  const isActualRateLimit = 
    errorStatus === 429 || 
    errorStatus === 503 || 
    errorString.includes("429") || 
    errorString.includes("503") ||
    errorString.includes("RESOURCE_EXHAUSTED") ||
    errorString.includes("Quota exceeded") ||
    errorString.includes("experiencing high demand");

  const lowerLastError = errorString.toLowerCase();
  const isTimeout = errorString.includes("MODEL_TIMEOUT") || lowerLastError.includes("timeout");

  if (isActualRateLimit && allRateLimited) {
    // Distinguish: is this a Google-wide outage (503 on all models) or just our key quota?
    const isGoogleOutage = errorString.includes("503") || errorString.includes("experiencing high demand");
    if (isGoogleOutage) {
      throw new Error(
        "RATE_LIMITED: Google's AI servers are currently experiencing high demand across all regions. This is a temporary Google infrastructure issue — please retry in 30-60 seconds."
      );
    }
    throw new Error(
      "RATE_LIMITED: Our AI engines are currently at capacity (daily quota reached). Retrying automatically in 8 seconds..."
    );
  }

  if (isTimeout && allRateLimited) {
    throw new Error(
      "RATE_LIMITED: AI models are not responding right now (Google infrastructure load). Please retry in 30-60 seconds — this always self-resolves."
    );
  }

  if (errorString.includes("safety") || errorString.includes("blocked")) {
    throw new Error("Content Blocked: The AI model flagged this document for safety reasons. Please ensure the content is professional and try again.");
  }

  if (errorString.includes("API key not valid") || errorString.includes("API_KEY_INVALID")) {
    throw new Error("API Key Error: One or more Gemini API keys are invalid. Please check your Vercel environment variables.");
  }

  throw new Error("Processing Interrupted: We encountered an unexpected issue while analyzing your resume. This usually resolves with a quick retry.");
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
    required: ["fullName"],
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

  const result = await withModelFallback(async (modelId, apiKey) => {
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

        // Quality Assertion: If input had experience sections but extracted experience is empty, log warning
        const rawHasExperience = payload.text && /experience|employment|work history|career/i.test(payload.text);
        const hasCustomExp = data.customSections && data.customSections.some(s => /experience|projects|work|history/i.test(s.title || ""));
        if (rawHasExperience && (!data.experience || data.experience.length === 0) && (!data.internships || data.internships.length === 0) && !hasCustomExp) {
          console.warn("[Quality Notice] Raw text contained experience keywords but extracted experience was empty.");
        }

       return data;
    }
    
    throw new Error("The AI model did not trigger the extraction tool correctly.");
  }, "extractResumeData", usePro);

  extractionCache.set(cacheKey, { timestamp: Date.now(), data: result });
  return result;
};

export const analyzeGrammarBackend = async (data: ResumeData, format: ResumeFormat, usePro: boolean = false): Promise<GrammarIssue[]> => {
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
};

export const checkSpellingBackend = async (data: ResumeData, format: ResumeFormat, usePro: boolean = false): Promise<ResumeData> => {
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
  return withModelFallback(async (modelId, apiKey) => {
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
};

export const rewritePhraseBackend = async (
  text: string,
  instruction: string,
  usePro: boolean = false
): Promise<string[]> => {
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

