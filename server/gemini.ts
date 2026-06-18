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

const FALLBACK_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-3-flash-preview",
  "gemini-3.1-pro-preview",
  "gemini-flash-latest"
];

const PRO_MODELS = [
  "gemini-3.1-pro-preview",
  "gemini-3-flash-preview",
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite"
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

  // We try up to 12 times total across keys and models
  let totalAttempts = 0;
  const maxAttempts = 12;

  for (const modelId of models) {
    for (let i = 0; i < pool.length; i++) {
      if (totalAttempts >= maxAttempts) break;

      const apiKey = getNextApiKey();
      totalRequests++;
      try {
        return await operation(modelId, apiKey);
      } catch (error: any) {
        const errorString = error?.toString() || "";
        const errorStatus = error?.status;
        const isRateLimit = errorStatus === 429 || 
          error?.status === "RESOURCE_EXHAUSTED" || 
          errorString.includes("429") || 
          errorString.includes("Quota exceeded") ||
          errorString.includes("RESOURCE_EXHAUSTED");
          
        const isInvalidKey = errorStatus === 400 || 
          errorStatus === 403 || 
          errorStatus === 401 ||
          errorString.includes("API key not valid") || 
          errorString.includes("API_KEY_INVALID") ||
          errorString.includes("unauthorized") ||
          errorString.includes("Unauthorized");
          
        const isServerError = errorStatus === 500 || 
          errorStatus === 503 || 
          errorString.includes("500") || 
          errorString.includes("503") ||
          errorString.includes("Internal Server Error") ||
          errorString.includes("Service Unavailable") ||
          errorString.includes("UNAVAILABLE") ||
          errorString.includes("experiencing high demand");

        const isModelLevelIssue = isServerError || isRateLimit || 
          errorStatus === 404 || 
          errorString.includes("not found") || 
          errorString.includes("not supported");

        totalAttempts++;
        lastError = error;

        if (isModelLevelIssue) {
          if (isRateLimit) rateLimitHits++;
          console.warn(`[${operationName}] Model ${modelId} with Key index ${currentKeyIndex % pool.length} failed (${isRateLimit ? "Rate Limit" : "Model Overloaded/Unavailable"}). Retrying with next model as fallback.`);
          // Breaking out of inner loop to try the next model immediately
          break;
        }

        if (isInvalidKey) {
          console.warn(`[${operationName}] API Key failed (Invalid/Unauthorized) with Model ${modelId}. Rotating key.`);
          currentKeyIndex++; // Move to next key
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
        systemInstruction: `
ACT AS AN EXPERT RESUME EDITOR. Modify the JSON resume data strictly following the user's instructions. You must preserve the schema structure and use the 'save_resume_data' tool to return the modified data.
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

