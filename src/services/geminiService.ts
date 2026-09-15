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

const RATE_LIMIT_PREFIX = "RATE_LIMITED:";

// Client-side retry with countdown — runs in browser, no timeout issues
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  onCountdown?: (secondsLeft: number) => void,
  maxRetries = 3,
  retryDelaySec = 30
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, init);

    if (response.ok) return response;

    const errorData = await response.clone().json().catch(() => ({}));
    const errorMsg: string = errorData.error || "";

    const isRateLimit =
      errorMsg.startsWith(RATE_LIMIT_PREFIX) ||
      response.status === 429 ||
      response.status === 503;

    // If not a rate limit error, or we've exhausted retries, give up
    if (!isRateLimit || attempt >= maxRetries) return response;

    // Rate limited — count down then retry
    console.log(`[geminiService] Rate limited. Waiting ${retryDelaySec}s before retry ${attempt + 1}/${maxRetries}...`);
    for (let s = retryDelaySec; s > 0; s--) {
      onCountdown?.(s);
      await new Promise(r => setTimeout(r, 1000));
    }
    onCountdown?.(0);
    console.log(`[geminiService] Retrying now (attempt ${attempt + 1}/${maxRetries})...`);
  }
  // Fallback — should never reach here
  return fetch(url, init);
}

export const extractResumeData = async (
  payload: ExtractionPayload,
  usePro: boolean = false,
  onCountdown?: (secondsLeft: number) => void
): Promise<ResumeData> => {
  const body = JSON.stringify({ payload, usePro });
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body
  };

  const response = await fetchWithRetry("/api/gemini/extract", init, onCountdown);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const msg: string = errorData.error || "Failed to extract resume data from server";
    // Strip the RATE_LIMITED: prefix from user-facing message
    throw new Error(msg.startsWith(RATE_LIMIT_PREFIX) ? msg.slice(RATE_LIMIT_PREFIX.length).trim() : msg);
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

