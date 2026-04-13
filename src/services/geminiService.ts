import { GoogleGenAI, Type, ThinkingLevel, FunctionDeclaration } from "@google/genai";
import { ResumeData, ResumeFormat, GrammarIssue } from "@/types";

// Types for internal use

let currentKeyIndex = 0;
let totalRequests = 0;
let rateLimitHits = 0;

export const getUsageStats = (usePro: boolean = false) => {
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
    // @ts-ignore
    import.meta.env.VITE_GEMINI_KEY_1,
    // @ts-ignore
    import.meta.env.VITE_GEMINI_KEY_2,
    // @ts-ignore
    import.meta.env.VITE_GEMINI_KEY_3,
    // @ts-ignore
    import.meta.env.VITE_GEMINI_API_KEY,
  ].filter(Boolean);
  
  // Also check process.env for server-side or other environments
  if (keys.length === 0 && typeof process !== 'undefined' && process.env.GEMINI_API_KEY) {
    keys.push(process.env.GEMINI_API_KEY);
  }
  
  console.log("Loaded API keys count:", keys.length);
  
  return keys;
};

const getNextApiKey = () => {
  const pool = getKeyPool();
  if (pool.length === 0) return "";
  const key = pool[currentKeyIndex % pool.length];
  return key;
};

const FALLBACK_MODELS = [
  "gemini-3-flash-preview",
  "gemini-3.1-pro-preview",
  "gemini-flash-latest"
];

const PRO_MODELS = [
  "gemini-3.1-pro-preview",
  "gemini-3-flash-preview"
];

async function withModelFallback<T>(
  operation: (modelId: string, apiKey: string) => Promise<T>,
  operationName: string,
  usePro: boolean = false
): Promise<T> {
  let lastError: any;
  const pool = getKeyPool();
  
  if (pool.length === 0) {
    throw new Error("No API Keys found. Please configure VITE_GEMINI_KEY_1, 2, or 3.");
  }

  const models = usePro ? PRO_MODELS : FALLBACK_MODELS;

  // We try up to 5 times total across keys/models
  let totalAttempts = 0;
  const maxAttempts = 5;

  for (const modelId of models) {
    for (let i = 0; i < pool.length; i++) {
      if (totalAttempts >= maxAttempts) break;

      const apiKey = getNextApiKey();
      totalRequests++;
      try {
        return await operation(modelId, apiKey);
      } catch (error: any) {
        const errorString = error?.toString() || "";
        const isRateLimit = error?.status === 429 || 
          error?.status === "RESOURCE_EXHAUSTED" || 
          errorString.includes("429") || 
          errorString.includes("Quota exceeded") ||
          errorString.includes("RESOURCE_EXHAUSTED");
          
        const isInvalidKey = error?.status === 400 || 
          error?.status === 403 || 
          errorString.includes("API key not valid") || 
          errorString.includes("API_KEY_INVALID");
          
        const isServerError = error?.status === 500 || 
          error?.status === 503 || 
          errorString.includes("500") || 
          errorString.includes("503") ||
          errorString.includes("Internal Server Error") ||
          errorString.includes("Service Unavailable");
          
        if (isRateLimit || isInvalidKey || isServerError) {
          if (isRateLimit) rateLimitHits++;
          console.warn(`[${operationName}] Model ${modelId} with Key ${currentKeyIndex % pool.length} failed (${isRateLimit ? 'Rate Limit' : isInvalidKey ? 'Invalid Key' : 'Server Error'}). Retrying...`);
          currentKeyIndex++; // Move to next key
          totalAttempts++;
          lastError = error;
          continue; 
        }
        
        console.error(`[${operationName}] Fatal error with model ${modelId}:`, error);
        throw error;
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

  throw new Error("Processing Interrupted: We encountered an unexpected issue while analyzing your resume. This usually resolves with a quick retry.");
}

const SYSTEM_INSTRUCTION = `
ACT AS A SECURE RESUME ARCHITECT. Provide expert-level resume formatting, focusing on ATS-optimization, high-impact action verbs, and clean structural hierarchy.

You are a Resume Parser that extracts content VERBATIM. 
Your goal is to STRUCTURE the data exactly as seen in the document without losing ANY section.

CRITICAL RULES:
1. **NO REWRITING**: Keep text exactly as is.
2. **CAPTURE EVERYTHING**: Do not skip "Soft Skills", "Tools", "Languages", "Internships", or "Digital Skills".
3. **MAPPING**:
   - **Work History/Professional Experience** -> 'experience' array.
   - **Internships** -> 'internships' array.
   - **Education** -> 'education' array.
   - **Summary/Profile** -> 'summary' array. Split into multiple items if it is a list. If it is a paragraph, return a single item.
   - **EVERYTHING ELSE** -> 'customSections' array.
     - Example: If you see "RECRUITMENT PLATFORMS & TOOLS", create a customSection with title "RECRUITMENT PLATFORMS & TOOLS" and the items.
     - Example: If you see "SOFT SKILLS", create a customSection with title "SOFT SKILLS".
4. **FORMATTING**:
   - For 'experience' and 'internships': Extract Company, Title, Dates, Location, and Bullets.
   - **DATES**: STRICTLY format all dates as "Mmm YYYY" (e.g., "Jan 2024", "Feb 2023", "Mar 2022"). 
     - Use ONLY the first 3 letters for the month (Jan, Feb, Mar, Apr, May, Jun, Jul, Aug, Sep, Oct, Nov, Dec).
     - If a date range is present, use " - " separator (e.g., "Jan 2020 - Feb 2022").
     - If "Present" or "Current", keep as "Present".
5. **LOCATION**: STRICTLY format all locations as "City, ST" (e.g., "San Francisco, CA", "New York, NY").
   - **CITY**: Ensure city names are in Title Case (e.g., "san francisco" -> "San Francisco").
   - **STATE**: Use ONLY the 2-letter postal abbreviation for US states (e.g., "California" -> "CA", "Texas" -> "TX").
6. **TITLES**: Capture the EXACT section titles used in the resume.
7. **PRIVACY**: Do NOT include any phone numbers or email addresses in ANY field (including summary, custom sections, or title). If found, remove them completely.
8. **INLINE LISTS**: If you encounter a single line that contains multiple items separated by symbols like "◆", "•", "|", or "-", you MUST split that line into individual items in the array. For example, "◆ SolidWorks ◆ AutoCAD" should become two items: "SolidWorks" and "AutoCAD".
9. **CLEAN BULLETS**: Remove all bullet characters (e.g., "•", "-", "*", "◆") from the beginning of ANY extracted item (in experience bullets, custom sections, summary, etc.). The array items should just be the text.

Call 'save_resume_data' with the extracted data.
`;

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
            title: { type: Type.STRING, description: "Exact Section Header, e.g. 'SOFT SKILLS', 'TECHNICAL SKILLS'" },
            items: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of items or lines in this section" }
          }
        },
        description: "All other sections not covered above. MUST NOT BE EMPTY if other sections exist."
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

export const analyzeGrammar = async (data: ResumeData, format: ResumeFormat, usePro: boolean = false): Promise<GrammarIssue[]> => {
  return withModelFallback(async (modelId, apiKey) => {
    const ai = new GoogleGenAI({ apiKey });
    
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
               - Suggest high-impact, context-aware improvements to phrasing.
               - DO NOT just swap single words if it makes the sentence read awkwardly. Instead, select the entire phrase or sentence as the 'errorText' and provide a fully rewritten, polished version as the 'suggestion'.
               - Ensure suggestions make logical sense for the specific line, industry, and context.
               - Categorize these as 'STYLE'.
            5. **Precision & Safety**: DO NOT change dates, numbers, metrics, factual information, or proper nouns. DO NOT hallucinate new skills or experiences.
            6. **Context**: For each issue, explain WHY the change is recommended (e.g., "Using 'Spearheaded' instead of 'Led' adds more executive impact, and restructuring the sentence highlights the 30% metric better.").
            7. **Exclusions**: DO NOT flag technical terms, version numbers, framework names, dates, or proper nouns.
            8. **Replacement Integrity**: 
               - 'errorText' MUST be the EXACT substring from the 'original' text. It must match character-for-character, including spaces and punctuation.
               - 'suggestions' MUST be drop-in replacements for 'errorText'. 
               - If 'errorText' is a whole sentence, 'suggestions' should be whole sentences.
               - NEVER return a suggestion that is a partial correction of the 'errorText' if 'errorText' is a whole sentence.
            9. Return a list of issues using the 'save_grammar_issues' tool. You MUST find at least 1-2 stylistic improvements if there are no spelling/grammar errors.
            10. For each issue, provide:
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

const cleanText = (text: string): string => {
  if (!text) return "";
  // Removes leading spaces, bullets (•, ·, -, *, ◆, ■, ●, etc)
  return text.replace(/^[\s\u2022\u00b7\-\*\u25c6\u25a0\u25cf\|]+/, "").trim();
};

const normalizeDates = (dateStr: string): string => {
  if (!dateStr) return "";
  // Replace " to " with " - " (case insensitive)
  // Replace multiple spaces around hyphens with a single space
  // Also handle en-dash and em-dash
  return dateStr
    .replace(/\s+to\s+/gi, " - ")
    .replace(/\s*[\u2013\u2014\-]\s*/g, " - ")
    .trim();
};

export interface ExtractionPayload {
  base64?: string;
  text?: string;
  mimeType: string;
  format: ResumeFormat;
}

export const extractResumeData = async (
  payload: ExtractionPayload,
  usePro: boolean = false
): Promise<ResumeData> => {
  return withModelFallback(async (modelId, apiKey) => {
    const ai = new GoogleGenAI({ apiKey });
    const parts: any[] = [];
    
    if (payload.base64) {
      parts.push({
        inlineData: {
          data: payload.base64,
          mimeType: payload.mimeType,
        },
      });
    } else if (payload.text) {
      parts.push({
        text: `Here is the raw text content of a resume:\n\n${payload.text}`
      });
    }

    parts.push({
      text: `Extract resume data for the ${payload.format} style. 
      
      STYLE-SPECIFIC INSTRUCTIONS:
      ${payload.format === ResumeFormat.MODERN_EXECUTIVE 
        ? "- Ensure location (City, State, Zip) is clearly extracted. Abbreviate months to 3 letters (e.g., 'Jan') for internal normalization." 
        : "- Abbreviate months to 3 letters (e.g., 'Jan')."}
      
      GENERAL INSTRUCTIONS:
      Do not miss ANY sections. Map Work to Experience, Internships to Internships, Education to Education. Put 'Soft Skills', 'Technical Skills', 'Languages', 'Tools', 'Projects' into customSections. 
      CRITICAL: For contactInfo.location, extract City, State, and Zip Code if available. 
      CRITICAL: For dates, if a month is present, abbreviate it to 3 letters (e.g., 'Jan'). If NO month is present, DO NOT add one (e.g., keep '2023' as '2023'). 
      CRITICAL: Remove ALL phone numbers and email addresses from the main content, but keep them in the contactInfo fields if found. 
      CRITICAL: Split inline lists separated by "◆", "•", or "|" into separate array items.
      
      ABSOLUTE MOST IMPORTANT RULE:
      DO NOT SUMMARIZE, TRUNCATE, OR OMIT ANY INFORMATION. You must extract EVERY SINGLE WORD from the original text. If a bullet point is long, keep it long. If there are many skills, extract all of them exactly as written. Do not rewrite or shorten anything. Loss of data is unacceptable.`,
    });

    const response = await ai.models.generateContent({
      model: modelId,
      contents: {
        parts: parts,
      },
      config: {
        systemInstruction: `
ACT AS A STRICT DATA EXTRACTOR. Your ONLY job is to map the provided text into the JSON schema. You are FORBIDDEN from summarizing, shortening, rewriting, or omitting any information from the original text. Every word must be preserved.
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
         const data = call.args as unknown as ResumeData;
         
         if (!data.contactInfo) data.contactInfo = {};

         // Clean bullets
         if (data.summary) {
            if (typeof data.summary === 'string') {
                data.summary = [data.summary];
            }
            data.summary = data.summary.map(cleanText);
         }
         if (data.experience) {
           data.experience.forEach(exp => {
             if (exp.description) exp.description = exp.description.map(cleanText);
             if (exp.dates) exp.dates = normalizeDates(exp.dates);
           });
         }
         if (data.internships) {
            data.internships.forEach(exp => {
              if (exp.description) exp.description = exp.description.map(cleanText);
              if (exp.dates) exp.dates = normalizeDates(exp.dates);
            });
         }
         if (data.education) {
            data.education.forEach(edu => {
                if (edu.details) edu.details = edu.details.map(cleanText);
                if (edu.dates) edu.dates = normalizeDates(edu.dates);
            });
         }
         if (data.customSections) {
             data.customSections.forEach(sec => {
                 if (sec.items) sec.items = sec.items.map(cleanText);
             });
         }

         return data;
      }
    }
    
    throw new Error("The AI model did not trigger the extraction tool correctly.");
  }, "extractResumeData", usePro);
};

export const checkSpelling = async (data: ResumeData, format: ResumeFormat, usePro: boolean = false): Promise<ResumeData> => {
  return withModelFallback(async (modelId, apiKey) => {
    const ai = new GoogleGenAI({ apiKey });
    
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
        systemInstruction: `
ACT AS A STRICT PROOFREADER. You are only allowed to fix objective spelling and grammar errors. You are forbidden from making stylistic changes, changing vocabulary, or altering the tone.
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
         
         // Ensure summary is array if string comes back
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