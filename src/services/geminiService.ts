import { ResumeData, ResumeFormat, GrammarIssue } from "@/types";

export interface ExtractionPayload {
  base64?: string;
  text?: string;
  mimeType: string;
  format: ResumeFormat;
}

export const getUsageStats = (usePro: boolean = false) => {
  return {
    activeKeyIndex: 0,
    totalKeys: 1,
    totalRequests: 0,
    rateLimitHits: 0,
    activeModel: usePro ? 'gemini-3.1-pro-preview' : 'gemini-3.5-flash'
  };
};

export const extractResumeData = async (
  payload: ExtractionPayload,
  usePro: boolean = false
): Promise<ResumeData> => {
  const response = await fetch("/api/gemini/extract", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ payload, usePro })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to extract resume data from server");
  }

  return response.json();
};

export const analyzeGrammar = async (
  data: ResumeData,
  format: ResumeFormat,
  usePro: boolean = false
): Promise<GrammarIssue[]> => {
  const response = await fetch("/api/gemini/analyze-grammar", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ data, format, usePro })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to analyze grammar from server");
  }

  return response.json();
};

export const checkSpelling = async (
  data: ResumeData,
  format: ResumeFormat,
  usePro: boolean = false
): Promise<ResumeData> => {
  const response = await fetch("/api/gemini/check-spelling", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ data, format, usePro })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to check spelling from server");
  }

  return response.json();
};

export const updateResume = async (
  data: ResumeData,
  instruction: string,
  targetJobDescription: string | undefined,
  format: ResumeFormat,
  usePro: boolean = false
): Promise<ResumeData> => {
  const response = await fetch("/api/gemini/update-resume", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ data, instruction, targetJobDescription, format, usePro })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to update resume from server");
  }

  return response.json();
};

export const rewritePhrase = async (
  text: string,
  instruction: string,
  usePro: boolean = false
): Promise<string[]> => {
  const response = await fetch("/api/gemini/rewrite-phrase", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ text, instruction, usePro })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to rewrite phrase from server");
  }

  return response.json();
};

