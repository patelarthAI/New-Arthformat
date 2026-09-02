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

const getKeyPool = (): string[] => {
  const keys = [
    process.env.VITE_GEMINI_KEY_1,
    process.env.VITE_GEMINI_KEY_2,
    process.env.VITE_GEMINI_KEY_3,
    process.env.VITE_GEMINI_API_KEY,
    process.env.GEMINI_API_KEY,
  ].filter(Boolean) as string[];
  
  return keys;
};

const getNextApiKey = () => {
  const pool = getKeyPool();
  if (pool.length === 0) return "";
  const key = pool[currentKeyIndex % pool.length];
  return key;
};

// Model priority: Full Flash first (1M context, high output capacity for multi-page extraction),
// then Pro (deep reasoning), then Flash-Lite & 8B lightweight models, then proven 1.5 endpoints and auto aliases.
// Guaranteed compatibility across all free-tier and paid Google API keys.
const FALLBACK_MODELS = [
  "gemini-2.5-flash",       // Primary: 2.5 Flash 1M context
  "gemini-1.5-flash",       // Proven stable 1.5 Flash 1M context
  "gemini-1.5-flash-8b",    // Fast lightweight 8B free tier model
  "gemini-3.5-flash",       // 3.5 Flash
  "gemini-3.7-flash",       // 3.7 Flash flagship
  "gemini-2.0-flash",       // 2.0 Flash
  "gemini-1.5-pro",         // 1.5 Pro deep reasoning
  "gemini-2.5-pro",         // 2.5 Pro deep reasoning
  "gemini-3.5-flash-lite",  // High-throughput Flash-Lite
  "gemini-3.1-flash-lite",  // High-throughput Flash-Lite
  "gemini-2.5-flash-lite",  // High-throughput Flash-Lite
  "gemini-flash-latest",    // Auto-updating Flash alias
  "gemini-pro-latest"       // Auto-updating Pro alias
];

const PRO_MODELS = [
  "gemini-2.5-pro",         // Primary 2.5 Pro
  "gemini-1.5-pro",         // Proven 1.5 Pro
  "gemini-2.5-flash",       // 2.5 Flash
  "gemini-1.5-flash",       // 1.5 Flash
  "gemini-1.5-flash-8b",    // Fast 8B free tier model
  "gemini-3.5-flash",       // 3.5 Flash
  "gemini-3.7-flash",       // 3.7 Flash
  "gemini-2.0-flash",       // 2.0 Flash
  "gemini-3.5-flash-lite",  // High-throughput Flash-Lite
  "gemini-flash-latest",    // Auto-updating Flash alias
  "gemini-pro-latest"       // Auto-updating Pro alias
];

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

  // We try up to 15 attempts total across active models and keys
  let totalAttempts = 0;
  const maxAttempts = 15;

  for (const modelId of models) {
    for (let i = 0; i < pool.length; i++) {
      if (totalAttempts >= maxAttempts) break;

      const apiKey = getNextApiKey();
      totalRequests++;
      try {
        return await operation(modelId, apiKey);
      } catch (error: any) {
        totalAttempts++;
        lastError = error;
        const errorString = error?.toString() || "";
        const errorStatus = error?.status;
        
        const isRateLimit = errorStatus === 429 || 
          error?.status === "RESOURCE_EXHAUSTED" || 
          errorString.includes("429") || 
          errorString.includes("Quota exceeded") ||
          errorString.includes("RESOURCE_EXHAUSTED");
          
        if (isRateLimit) rateLimitHits++;

        console.warn(`[${operationName}] Model ${modelId} with Key index ${currentKeyIndex % pool.length} returned error (${errorStatus || "API Error"}: ${errorString.substring(0, 120)}). Cascading to next fallback model.`);
        
        // Key rotation for key-specific errors
        if (errorStatus === 400 || errorStatus === 403 || errorStatus === 401 || errorString.includes("API key not valid")) {
          currentKeyIndex++;
        }

        // Break to try the next model immediately
        break;
      }
    }
    if (totalAttempts >= maxAttempts) break;
  }
  
  console.error(`[${operationName}] All attempts exhausted.`, lastError);
  
  const errorString = lastError?.toString() || "";
  if (errorString.includes("429") || errorString.includes("Quota exceeded") || errorString.includes("RESOURCE_EXHAUSTED")) {
    throw new Error("High Traffic Detected: Our AI engines are currently at capacity. Please wait 30-60 seconds and try again.");
  }
  
  if (errorString.includes("safety") || errorString.includes("blocked")) {
    throw new Error("Content Blocked: The AI model flagged this document for safety reasons. Please ensure the content is professional and try again.");
  }

  const detail = lastError?.message || errorString.substring(0, 150) || "Unknown API error";
  throw new Error(`Processing Interrupted: ${detail}`);
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
  return withModelFallback(async (modelId, apiKey) => {
    const ai = new GoogleGenAI({ 
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
    const parts: any[] = [];
    
    // Gemini API only supports inlineData for PDF and Images.
    // DOCX/DOC files must be passed as raw text to avoid 400 Unsupported MIME Type errors.
    const isSupportedMultimodal = 
      payload.mimeType === 'application/pdf' || 
      (payload.mimeType && payload.mimeType.startsWith('image/'));

    if (payload.base64 && isSupportedMultimodal) {
      parts.push({
        inlineData: {
          data: payload.base64,
          mimeType: payload.mimeType,
        },
      });
    }

    // Include extracted raw text (for complete multi-page verbatim text accuracy)
    if (payload.text && payload.text.trim().length > 0) {
      parts.push({
        text: `Here is the COMPLETE, FULL VERBATIM raw text content extracted from all pages of the multi-page resume:\n\n${payload.text}`
      });
    }

    parts.push({
      text: `Extract resume data for the ${payload.format} style. 
      
      STYLE-SPECIFIC INSTRUCTIONS:
      ${payload.format === ResumeFormat.MODERN_EXECUTIVE 
        ? "- Ensure location (City, State, Zip) is clearly extracted. Abbreviate months to 3 letters (e.g., 'Jan') for internal normalization." 
        : "- Abbreviate months to 3 letters (e.g., 'Jan')."}
      
      GENERAL INSTRUCTIONS:
      - ZERO DATA LOSS GUARANTEE: Extract 100% of ALL sections, headers, titles, and content present in the document.
      - Map standard sections (Summary, Professional Experience, Internships, Education) to their respective fields.
      - ANY OTHER section header or title (e.g. 'PUBLICATIONS', 'PATENTS', 'AWARDS & HONORS', 'VOLUNTEER WORK', 'KEY PROJECTS', 'PROJECTS', 'LANGUAGES', 'AFFILIATIONS', 'REFERENCES', 'CERTIFICATIONS', 'COMPETENCIES', 'OTHER EXPERIENCE', or ANY custom header title) MUST be extracted into 'customSections' with its EXACT section title as written in the original resume.
      - Do NOT stop after the first section or page. Read through to the very end of the text and extract every job, title, company, bullet point, skill, certification, and education item.
      - If a work experience section contains bullet points without an explicit company name or job title header in the text, set company and title to empty strings "". DO NOT insert fake, duplicate, or redundant placeholder strings like 'Professional Experience' or 'Key Responsibilities'. Put all bullet points cleanly into 'description'.
      CRITICAL: For contactInfo.location, extract City, State, and Zip Code if available. 
      CRITICAL: For dates, if a month is present, abbreviate it to 3 letters (e.g., 'Jan'). If NO month is present, DO NOT add one (e.g., keep '2023' as '2023'). 
      CRITICAL: Remove ALL phone numbers and email addresses from the main content, but keep them in the contactInfo fields if found. 
      CRITICAL: Split inline lists separated by "◆", "•", or "|" into separate array items.
      
      ABSOLUTE STRICTEST RULE - ZERO ALTERATION & ZERO LOSS:
      1. ZERO REWRITING / ZERO REPHRASING: You are strictly FORBIDDEN from altering, polishing, rephrasing, rewriting, summarizing, or changing any wording. Every single word must be copied 100% verbatim.
      2. ZERO DATA LOSS: Extract EVERY SINGLE WORD, bullet point, job role, skill, and line from ALL pages of the input text. Loss of any data or section is unacceptable.`,
    });

    const response = await ai.models.generateContent({
      model: modelId,
      contents: {
        parts: parts,
      },
      config: {
        maxOutputTokens: 16384,
        systemInstruction: `
STRICT DATA EXTRACTOR DIRECTIVE:
1. ZERO ALTERATION: You are strictly FORBIDDEN from changing, rephrasing, rewriting, polishing, summarizing, or modifying ANY words, bullet points, or sentences. Preserve 100% exact verbatim original text.
2. ZERO OMISSION: Extract EVERY experience entry, job title, company name, education entry, custom section, bullet point, and line from ALL pages. Never drop or skip any historical job or detail regardless of length or number of pages.
3. VERBATIM SECTION MAPPING: Profile/Summary -> summary, Job History/Roles -> experience, Internships -> internships, Education -> education, Skills/Certifications/Projects -> customSections.
4. Clean up artificial spacing/ligature splitting from PDF text extraction (e.g. convert 'fi eld' to 'field', 'sta ff' to 'staff'), but NEVER alter any words or content.
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
         });
       }
       if (data.internships) {
          data.internships.forEach(exp => {
            if (exp.description) exp.description = exp.description.map(cleanText);
            if (exp.dates) exp.dates = normalizeDates(exp.dates);
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

       return data;
    }
    
    throw new Error("The AI model did not trigger the extraction tool correctly.");
  }, "extractResumeData", usePro);
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
        maxOutputTokens: 16384,
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
        maxOutputTokens: 16384,
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
      }
    });

    return response.text || "";
  }, "OCR", usePro);
};

