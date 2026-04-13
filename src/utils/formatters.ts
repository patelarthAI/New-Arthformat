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
