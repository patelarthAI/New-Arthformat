export const cleanBullet = (text: any) => {
  if (!text) return text;
  if (typeof text !== 'string') text = String(text);
  // Remove common bullet characters and leading/trailing whitespace
  return text.replace(/^\s*([\u2022\u25E6\u2023\u25B8\u25AA\u25AB\-\*\u2013\u2014\u2043\u2219\u25C6\u27A2\uF0D8\u00B7]\s*)+/, '').trim();
};

export const processDescription = (items: any[]): string[] => {
  if (!items) return [];
  const processed: string[] = [];
  items.forEach(item => {
    const cleanedItem = cleanBullet(item);
    if (cleanedItem.length > 100 && cleanedItem.includes('.')) {
      // Split by period followed by space and capital letter, or end of string
      const sentences = cleanedItem.split(/\. (?=[A-Z])|\.$/g).filter(s => s.trim().length > 0);
      if (sentences.length > 1) {
        sentences.forEach(s => processed.push(s.trim() + (s.trim().endsWith('.') ? '' : '.')));
      } else {
        processed.push(cleanedItem);
      }
    } else {
      processed.push(cleanedItem);
    }
  });
  return processed;
};

export interface ProcessedBullet {
  text: string;
  originalIndex: number;
}

export const processDescriptionWithIndices = (items: any[]): ProcessedBullet[] => {
  if (!items) return [];
  const processed: ProcessedBullet[] = [];
  items.forEach((item, originalIndex) => {
    const cleanedItem = cleanBullet(item);
    if (cleanedItem.length > 100 && cleanedItem.includes('.')) {
      // Split by period followed by space and capital letter, or end of string
      const sentences = cleanedItem.split(/\. (?=[A-Z])|\.$/g).filter(s => s.trim().length > 0);
      if (sentences.length > 1) {
        sentences.forEach(s => {
          processed.push({
            text: s.trim() + (s.trim().endsWith('.') ? '' : '.'),
            originalIndex
          });
        });
      } else {
        processed.push({ text: cleanedItem, originalIndex });
      }
    } else {
      processed.push({ text: cleanedItem, originalIndex });
    }
  });
  return processed;
};

export interface GroupedItemValue {
  text: string;
  originalIndex: number;
}

export interface GroupedItem {
  key?: string;
  keyOriginalIndex?: number;
  values: GroupedItemValue[];
}

export const groupBulletPoints = (items: string[]): GroupedItem[] => {
  const grouped: GroupedItem[] = [];
  let currentGroup: GroupedItem | null = null;

  items.forEach((rawItem, idx) => {
    const item = cleanBullet(rawItem);
    const isKeyValue = item.includes(":");
    
    if (isKeyValue) {
      const parts = item.split(":");
      const key = parts[0].trim();
      const value = parts.slice(1).join(":").trim();
      
      currentGroup = { 
        key: key, 
        keyOriginalIndex: idx,
        values: value ? [{ text: value, originalIndex: idx }] : [] 
      };
      grouped.push(currentGroup);
    } else {
      if (currentGroup) {
        currentGroup.values.push({ text: item.trim(), originalIndex: idx });
      } else {
        currentGroup = { values: [{ text: item.trim(), originalIndex: idx }] };
        grouped.push(currentGroup);
      }
    }
  });

  return grouped;
};

export const formatSingleDate = (str: string, shortMonths: boolean = false): string => {
  const cleaned = str.trim();
  if (!cleaned) return "";

  if (/^(present|current|now|ongoing)$/i.test(cleaned)) {
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
  }

  const fullMonthNames = [
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  const shortMonthNames = [
    "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  ];

  const monthNames = shortMonths ? shortMonthNames : fullMonthNames;

  const monthNameMapFull: { [key: string]: string } = {
    "jan": "January", "january": "January",
    "feb": "February", "february": "February", "febuary": "February",
    "mar": "March", "march": "March",
    "apr": "April", "april": "April",
    "may": "May",
    "jun": "June", "june": "June",
    "jul": "July", "july": "July",
    "aug": "August", "august": "August",
    "sep": "September", "sept": "September", "september": "September",
    "oct": "October", "october": "October",
    "nov": "November", "november": "November",
    "dec": "December", "december": "December"
  };

  const monthNameMapShort: { [key: string]: string } = {
    "jan": "Jan", "january": "Jan",
    "feb": "Feb", "february": "Feb", "febuary": "Feb",
    "mar": "Mar", "march": "Mar",
    "apr": "Apr", "april": "Apr",
    "may": "May",
    "jun": "Jun", "june": "Jun",
    "jul": "Jul", "july": "Jul",
    "aug": "Aug", "august": "Aug",
    "sep": "Sep", "sept": "Sep", "september": "Sep",
    "oct": "Oct", "october": "Oct",
    "nov": "Nov", "november": "Nov",
    "dec": "Dec", "december": "Dec"
  };

  const monthNameMap = shortMonths ? monthNameMapShort : monthNameMapFull;

  // 1. Try ISO date format: YYYY-MM-DD
  const isoMatch = cleaned.match(/\b(\d{4})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])\b/);
  if (isoMatch) {
    const year = isoMatch[1];
    const monthNum = parseInt(isoMatch[2], 10);
    const monthName = monthNames[monthNum];
    return `${monthName} ${year}`;
  }

  // 2. Try 3-part numeric format: e.g. MM/DD/YYYY or DD/MM/YYYY or MM/DD/YY
  const threePartNumMatch = cleaned.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{4}|\d{2})\b/);
  if (threePartNumMatch) {
    const part1 = parseInt(threePartNumMatch[1], 10);
    const part2 = parseInt(threePartNumMatch[2], 10);
    let year = threePartNumMatch[3];
    if (year.length === 2) {
      const yNum = parseInt(year, 10);
      year = yNum > 50 ? `19${year}` : `20${year}`;
    }

    let monthNum = part1;
    // If part1 is > 12 and part2 is <= 12, it must be DD/MM/YYYY (part2 is month)
    if (part1 > 12 && part2 <= 12) {
      monthNum = part2;
    }
    // If part2 is > 12 and part1 is <= 12, it is MM/DD/YYYY (part1 is month)
    else if (part2 > 12 && part1 <= 12) {
      monthNum = part1;
    }
    // Default to first part as month (US standard) if both are <= 12
    else if (part1 <= 12) {
      monthNum = part1;
    }

    const monthName = monthNames[monthNum] || "";
    if (monthName) {
      return `${monthName} ${year}`;
    }
  }

  // 3. Try 2-part numeric format: e.g. MM/YYYY or MM/YY
  const twoPartNumMatch = cleaned.match(/\b(0?[1-9]|1[0-2])[-/](\d{4}|\d{2})\b/);
  if (twoPartNumMatch) {
    const monthNum = parseInt(twoPartNumMatch[1], 10);
    const monthName = monthNames[monthNum];
    let year = twoPartNumMatch[2];
    if (year.length === 2) {
      const yNum = parseInt(year, 10);
      year = yNum > 50 ? `19${year}` : `20${year}`;
    }
    return `${monthName} ${year}`;
  }

  // 4. Try alphabetic month names (e.g., "March 1, 2026", "1st March 2026", "Mar/2026")
  const alphaMonthMatch = cleaned.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i);
  const yearMatch = cleaned.match(/\b(\d{4}|\d{2})\b/);

  if (alphaMonthMatch && yearMatch) {
    const monthKey = alphaMonthMatch[1].toLowerCase();
    const monthName = monthNameMap[monthKey] || alphaMonthMatch[1];
    let year = yearMatch[1];
    if (year.length === 2) {
      const yNum = parseInt(year, 10);
      year = yNum > 50 ? `19${year}` : `20${year}`;
    }
    return `${monthName} ${year}`;
  }

  // Fallback: If it's just a 4-digit year
  if (/^\d{4}$/.test(cleaned)) {
    return cleaned;
  }

  return cleaned;
};

export const formatResumeDate = (dateStr: string, shortMonths: boolean = false): string => {
  if (!dateStr || dateStr === "undefined") return "";

  // Split by common separators: " - ", "-", "–", "—", " to "
  const parts = dateStr.split(/(\s*(?:-|–|—|to)\s*)/i);

  if (parts.length <= 1) {
    return formatSingleDate(dateStr, shortMonths);
  }

  return parts.map((part, index) => {
    if (index % 2 === 1) {
      // Normalize dash separators to " - " for premium look
      if (/^\s*(?:-|–|—)\s*$/.test(part)) {
        return " - ";
      }
      return part;
    }
    return formatSingleDate(part, shortMonths);
  }).join("");
};

const DATE_PATTERN_REGEX = /(?:\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b|\b\d{1,2}[-/]\d{2,4}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[-/ ]*(?:\d{1,2}[a-z]*[-/ ,]*)?\d{2,4}\b|\b\d{1,2}[a-z]*[-/ ]*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[-/ ]*\d{2,4}\b|\b(?:present|current|ongoing|now)\b)/i;

const DATE_RANGE_REGEX = new RegExp(
  `(?:${DATE_PATTERN_REGEX.source})` + 
  `\\s*(?:-|–|—|to)\\s*` + 
  `(?:${DATE_PATTERN_REGEX.source})?` + 
  `|` + 
  `(?:${DATE_PATTERN_REGEX.source})`, 
  'i'
);

const ACRONYMS = new Set([
  "IT", "AI", "ML", "PMO", "QA", "QC", "UI", "UX", "VP", "SVP", "EVP", "AVP",
  "CEO", "CTO", "CFO", "COO", "CIO", "CISO", "HR", "BI", "ETL", "SQL", "AWS",
  "GCP", "ERP", "CRM", "API", "PM", "BA", "DBA", "SRE", "DEVOPS", "II", "III", "IV", "V"
]);

const MINOR_WORDS = new Set(["and", "as", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to", "with"]);

export const toTitleCaseIfAllCaps = (text: string): string => {
  if (!text) return "";
  const trimmed = text.trim();
  const hasLetters = /[A-Z]/.test(trimmed);
  const isAllCaps = trimmed === trimmed.toUpperCase() && hasLetters;

  if (!isAllCaps) return text; // Already mixed case, preserve verbatim!

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

export const stripTrailingDate = (text: string): string => {
  if (!text) return "";
  let cleaned = text.trim();
  
  const trailingDateRegex = new RegExp(
    `(?:\\s*[,;\\-\\|()]\\s*)*(` + 
    DATE_RANGE_REGEX.source + 
    `)\\s*\\)?\\s*$`, 
    'i'
  );
  
  cleaned = cleaned.replace(trailingDateRegex, '').trim();
  cleaned = cleaned.replace(/[,;\-\\|(\s]+$/, '').trim();
  
  return toTitleCaseIfAllCaps(cleaned);
};
