export interface ContactInfo {
  email?: string;
  phone?: string;
  linkedin?: string;
  website?: string;
  location?: string;
}

export interface ExperienceItem {
  company: string;
  title: string;
  dates: string;
  location?: string;
  description: string[]; // Bullet points
}

export interface EducationItem {
  institution: string;
  degree: string;
  dates: string;
  location?: string;
  details?: string[];
}

export interface CustomSection {
  title: string; // e.g. "TECHNICAL & DIGITAL SKILLS", "SOFT SKILLS", "RECRUITMENT PLATFORMS"
  items: string[]; // The content lines verbatim
}

export interface GrammarIssue {
  id: string;
  path: string; // e.g. "summary.0", "experience.0.description.2"
  original: string; // The full text context
  errorText: string; // The specific substring that is wrong
  suggestions: string[]; // List of 3 suggestions
  reason: string;
  type: 'SPELLING' | 'GRAMMAR' | 'STYLE';
}

export interface ChangeLogItem {
  id: string;
  timestamp: number;
  path: string;
  original: string;
  new: string;
  reason: string;
}

export interface ExtractionChange {
  id: string;
  type: 'REMOVAL' | 'ADDITION' | 'MODIFICATION';
  description: string;
  reason: string;
}

export interface ResumeData {
  fullName: string;
  contactInfo: ContactInfo;
  
  // Dynamic Content
  summary?: string[];
  sectionTitleSummary?: string; // exact title from doc

  // Work History
  experience: ExperienceItem[];
  sectionTitleExperience?: string;

  // Internships (Same format as experience but separate section)
  internships?: ExperienceItem[];
  sectionTitleInternships?: string;

  // Education
  education: EducationItem[];
  sectionTitleEducation?: string;

  // ALL other sections (Skills, Tools, Languages, etc.) go here to ensure nothing is missed
  customSections: CustomSection[]; 
  
  // Log of changes made during extraction (PII removal, formatting fixes, etc.)
  extractionChanges?: ExtractionChange[];
}

export enum AppState {
  IDLE = 'IDLE',
  STAGING = 'STAGING',
  WAITING_APPROVAL = 'WAITING_APPROVAL',
  PROCESSING = 'PROCESSING',
  REVIEW = 'REVIEW',
  ERROR = 'ERROR',
}

export enum ResumeFormat {
  CLASSIC_PROFESSIONAL = 'CLASSIC_PROFESSIONAL',
  MODERN_EXECUTIVE = 'MODERN_EXECUTIVE',
}