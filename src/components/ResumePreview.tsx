import React, { useState, useEffect } from "react";
import { ResumeData, GrammarIssue, ChangeLogItem, ResumeFormat } from "@/types";
import { 
  Download, FileText, Loader2, History, ArrowRight, LayoutTemplate, Undo2, 
  ShieldCheck, Lock, AlertCircle, Sparkles, Check, X, Eye, EyeOff, MapPin, 
  Phone, Mail, Unlock, RotateCcw, PanelRight, Settings, Award, Split, Layers, Info
} from "lucide-react";
import { analyzeGrammar } from "@/services/geminiService";
import { generateResumePDF } from "@/services/pdfService";
import { generateResumeDoc } from "@/services/docxService";
import { saveAs } from "file-saver";
import GrammarHighlighter from "./GrammarHighlighter";
import get from "lodash/get";
import set from "lodash/set";
import { motion, AnimatePresence } from "framer-motion";
import { cleanBullet, groupBulletPoints, processDescription, processDescriptionWithIndices, formatResumeDate as formatModernDate, stripTrailingDate } from "@/utils/formatters";
import { InteractiveLogo } from "./InteractiveLogo";

interface ResumePreviewProps {
  data: ResumeData;
  onDownload: () => void;
  onReset: () => void;
  onUpdate: (data: ResumeData) => void;
  selectedFormat: ResumeFormat;
  usePro?: boolean;
  retainedFields: { location: boolean; phone: boolean; email: boolean };
  setRetainedFields: React.Dispatch<React.SetStateAction<{ location: boolean; phone: boolean; email: boolean }>>;
  originalText?: string;
}

const ResumePreview: React.FC<ResumePreviewProps> = ({ 
  data, 
  onDownload, 
  onReset, 
  onUpdate, 
  selectedFormat, 
  usePro = false,
  retainedFields,
  setRetainedFields,
  originalText = ""
}) => {
  console.log("ResumePreview mounting with data:", data);
  
  // Layout States
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [comparisonMode, setComparisonMode] = useState(false);
  const [activeTab, setActiveTab] = useState<'insights' | 'signals' | 'logs' | 'settings'>('insights');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving'>('saved');
  const [isChecking, setIsChecking] = useState(false);
  const [issues, setIssues] = useState<GrammarIssue[]>([]);
  
  // Revision Snapshot states for Version History
  const [historyStack, setHistoryStack] = useState<{ id: string; timestamp: number; data: ResumeData; description: string }[]>([]);
  const [currentHistoryIndex, setCurrentHistoryIndex] = useState(-1);

  // Initialize history once on load
  useEffect(() => {
    if (historyStack.length === 0 && data) {
      const initialRev = {
        id: "initial",
        timestamp: Date.now(),
        data: JSON.parse(JSON.stringify(data)),
        description: "Initial Formatted Version"
      };
      setHistoryStack([initialRev]);
      setCurrentHistoryIndex(0);
    }
  }, [data]);

  const [changeLog, setChangeLog] = useState<ChangeLogItem[]>(() => {
    if (data.extractionChanges) {
        return data.extractionChanges.map(c => ({
            id: c.id || Math.random().toString(),
            timestamp: Date.now(),
            path: "Extraction",
            original: c.type, // e.g. "REMOVAL"
            new: c.description,
            reason: c.reason
        }));
    }
    return [];
  });

  // Centralized Data Update & Auto-Save Simulation
  const updateData = (newData: ResumeData, changeDescription: string) => {
    setSaveStatus('saving');
    
    // Save to history stack
    const newRevision = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: Date.now(),
      data: JSON.parse(JSON.stringify(newData)),
      description: changeDescription
    };
    
    const cleanStack = historyStack.slice(0, currentHistoryIndex + 1);
    setHistoryStack([...cleanStack, newRevision]);
    setCurrentHistoryIndex(cleanStack.length);
    
    // Call parent update
    onUpdate(newData);
    
    setTimeout(() => {
      setSaveStatus('saved');
    }, 600);
  };

  const handleRestoreRevision = (revIndex: number) => {
    const rev = historyStack[revIndex];
    if (!rev) return;
    
    setSaveStatus('saving');
    setCurrentHistoryIndex(revIndex);
    
    onUpdate(JSON.parse(JSON.stringify(rev.data)));
    
    setTimeout(() => {
      setSaveStatus('saved');
    }, 400);
  };
  
  // Styles based on format
  const getStyles = (format: ResumeFormat) => {
    if (format === ResumeFormat.MODERN_EXECUTIVE) {
        return {
            fontFamily: "Arial, sans-serif",
            fontSizeBody: "11pt",
            fontSizeName: "12pt",
            headingTransform: "uppercase" as const,
            headingBorder: "none",
            headingColor: "#000000",
            nameAlign: "left" as const,
            lineHeight: "1.0",
            marginBottom: "11pt",
            showContactInfo: false,
            jobLayout: 'modern' as const,
            headingMarginTop: "11pt",
            headingMarginBottom: "11pt"
        };
    }
    // Default Classic
    return {
        fontFamily: "Calibri, sans-serif",
        fontSizeBody: "11pt",
        fontSizeName: "14pt",
        headingTransform: "uppercase" as const,
        headingBorder: "none",
        headingColor: "#000000",
        nameAlign: "center" as const,
        lineHeight: "1.2",
        marginBottom: "1rem",
        showContactInfo: false,
        jobLayout: 'classic' as const,
        headingMarginTop: "0px",
        headingMarginBottom: "4px"
    };
  };

  const styles = getStyles(selectedFormat);
  const black = "#000000";

  const formatTitle = (title: string) => {
    if (!title) return "";
    let cleaned = title.trim();
    cleaned = cleaned.replace(/[:\-–—_*\s~▪•·|]+$/, "");
    cleaned = cleaned.replace(/^[:\-–—_*\s~▪•·|]+/, "");
    return `${cleaned}:`;
  };
  
  const formatLocation = (loc: string) => {
    if (!loc) return "";
    
    const stateMap: { [key: string]: string } = {
        "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA",
        "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE", "Florida": "FL", "Georgia": "GA",
        "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL", "Indiana": "IN", "Iowa": "IA",
        "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD",
        "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN", "Mississippi": "MS", "Missouri": "MO",
        "Montana": "MT", "Nebraska": "NE", "Nevada": "NV", "New Hampshire": "NH", "New Jersey": "NJ",
        "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH",
        "Oklahoma": "OK", "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC",
        "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX", "Utah": "UT", "Vermont": "VT",
        "Virginia": "VA", "Washington": "WA", "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY"
    };

    let cleanedLoc = loc.replace(/\b\d{5}(-\d{4})?\b/g, '').trim();

    const parts = cleanedLoc.split(',').map(p => p.trim()).filter(Boolean);
    if (parts.length >= 1) {
        parts[0] = parts[0].split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
        
        if (parts.length >= 2) {
            const state = parts[1];
            const foundState = Object.keys(stateMap).find(s => s.toLowerCase() === state.toLowerCase());
            if (foundState) {
                parts[1] = stateMap[foundState];
            } else if (state.length > 2) {
                parts[1] = state.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
            } else {
                parts[1] = state.toUpperCase();
            }
        }
        return parts.slice(0, 2).join(', ');
    }
    
    return cleanedLoc;
  };

  const handleCheckGrammar = async () => {
    setIsChecking(true);
    try {
      const foundIssues = await analyzeGrammar(data, selectedFormat, usePro);
      setIssues(foundIssues);
      if (foundIssues.length === 0) {
        alert("No grammar issues found!");
      }
    } catch (error) {
      console.error("Grammar check failed", error);
      alert("Failed to check grammar. Please try again.");
    } finally {
      setIsChecking(false);
    }
  };

  const handleAcceptIssue = (issue: GrammarIssue) => {
    const newData = JSON.parse(JSON.stringify(data));
    const currentValue = get(newData, issue.path);
    
    if (typeof currentValue === 'string' && issue.errorText && issue.suggestions && issue.suggestions.length > 0) {
        const selectedSuggestion = issue.suggestions[0];
        
        let newValue = currentValue;
        if (currentValue.includes(issue.errorText)) {
            newValue = currentValue.replace(issue.errorText, selectedSuggestion);
        } else if (issue.original === currentValue) {
            newValue = selectedSuggestion;
        } else {
            const cleanError = issue.errorText.trim();
            if (currentValue.includes(cleanError)) {
                newValue = currentValue.replace(cleanError, selectedSuggestion);
            }
        }

        if (newValue !== currentValue) {
            set(newData, issue.path, newValue);
            
            // Add to Change Log
            const newLogItem: ChangeLogItem = {
                id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
                timestamp: Date.now(),
                path: issue.path,
                original: issue.errorText,
                new: selectedSuggestion,
                reason: issue.reason
            };
            setChangeLog(prev => [newLogItem, ...prev]);
            updateData(newData, `Fixed grammar: "${issue.errorText}" → "${selectedSuggestion}"`);
        }
    }
    
    setIssues(prev => prev.filter(i => i.id !== issue.id));
  };

  const handleFixAll = () => {
    if (issues.length === 0) return;
    
    let newData = JSON.parse(JSON.stringify(data));
    const newLogs: ChangeLogItem[] = [];
    
    const issuesByPath: Record<string, GrammarIssue[]> = {};
    issues.forEach(issue => {
        if (!issuesByPath[issue.path]) issuesByPath[issue.path] = [];
        issuesByPath[issue.path].push(issue);
    });

    Object.entries(issuesByPath).forEach(([path, pathIssues]) => {
        let currentValue = get(newData, path);
        if (typeof currentValue !== 'string') return;

        const sortedIssues = [...pathIssues].sort((a, b) => {
            return currentValue.lastIndexOf(b.errorText) - currentValue.lastIndexOf(a.errorText);
        });

        sortedIssues.forEach(issue => {
            const selectedSuggestion = issue.suggestions[0];
            if (currentValue.includes(issue.errorText)) {
                const nextValue = currentValue.replace(issue.errorText, selectedSuggestion);
                if (nextValue !== currentValue) {
                    currentValue = nextValue;
                    newLogs.push({
                        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
                        timestamp: Date.now(),
                        path: issue.path,
                        original: issue.errorText,
                        new: selectedSuggestion,
                        reason: issue.reason
                    });
                }
            }
        });
        
        set(newData, path, currentValue);
    });

    if (newLogs.length > 0) {
        setChangeLog(prev => [...newLogs, ...prev]);
        updateData(newData, `Auto-fixed all (${issues.length}) grammar issues`);
    }
    setIssues([]);
  };

  const handleIgnoreIssue = (issue: GrammarIssue) => {
    setIssues(prev => prev.filter(i => i.id !== issue.id));
  };

  const handleUndoChange = (log: ChangeLogItem) => {
    if (log.path === "Extraction") return;

    const newData = JSON.parse(JSON.stringify(data));
    const currentValue = get(newData, log.path);

    if (typeof currentValue === 'string') {
        const newValue = currentValue.replace(log.new, log.original);
        set(newData, log.path, newValue);
        
        updateData(newData, `Undid changes for "${log.new}"`);
        setChangeLog(prev => prev.filter(item => item.id !== log.id));
    }
  };

  const handleDownloadPDF = async () => {
    try {
      await generateResumePDF(data, selectedFormat, retainedFields);
    } catch (err) {
      console.error("PDF generation failed", err);
      alert("Failed to generate PDF.");
    }
  };

  const handleDownloadDOCX = async () => {
    try {
      const blob = await generateResumeDoc(data, selectedFormat, retainedFields);
      const fileName = `${data.fullName.trim().replace(/\s+/g, '.')}.Formatted.docx`;
      saveAs(blob, fileName);
    } catch (err) {
      console.error("DOCX generation failed", err);
      alert("Failed to generate DOCX.");
    }
  };

  // Real-time AI scoring and suggestion engine
  const calculateScore = () => {
    const suggestions: { id: string; type: 'info' | 'warning' | 'success'; text: string; category: string }[] = [];
    let score = 75; // base score

    // 1. Contact Info completeness
    const missingContact: string[] = [];
    if (!data.contactInfo?.email) {
      missingContact.push("Email");
      score -= 5;
    }
    if (!data.contactInfo?.phone) {
      missingContact.push("Phone");
      score -= 5;
    }
    if (!data.contactInfo?.location) {
      missingContact.push("Location");
      score -= 5;
    }
    if (!data.contactInfo?.linkedin) {
      missingContact.push("LinkedIn");
      score -= 3;
    } else {
      score += 3;
    }

    if (missingContact.length > 0) {
      suggestions.push({
        id: "missing-contact",
        type: "warning",
        category: "Contact Details",
        text: `Add your missing ${missingContact.join(", ")} details to raise recruiter callback rates.`
      });
    } else {
      suggestions.push({
        id: "contact-complete",
        type: "success",
        category: "Contact Details",
        text: "Contact details are complete and well-formatted."
      });
    }

    // 2. Professional Summary
    if (!data.summary || data.summary.length === 0) {
      suggestions.push({
        id: "missing-summary",
        type: "warning",
        category: "Executive Summary",
        text: "Add a professional profile summary to immediately capture hiring interest."
      });
      score -= 5;
    } else {
      const summaryLength = data.summary.join(" ").length;
      if (summaryLength > 600) {
        suggestions.push({
          id: "long-summary",
          type: "info",
          category: "Executive Summary",
          text: "Your summary is slightly long. Condense to under 400 characters for high readability."
        });
        score -= 2;
      } else {
        suggestions.push({
          id: "good-summary",
          type: "success",
          category: "Executive Summary",
          text: "Profile summary is highly focused and reader-friendly."
        });
        score += 5;
      }
    }

    // 3. Work Experience details
    if (!data.experience || data.experience.length === 0) {
      suggestions.push({
        id: "missing-exp",
        type: "warning",
        category: "Experience",
        text: "No experience records found. Include work history to demonstrate competency."
      });
      score -= 15;
    } else {
      score += Math.min(15, data.experience.length * 5);
      
      const metricRegex = /\d+%|\$\d+|\b\d+\s*(?:percent|million|billion|K)\b/i;
      let rolesWithMetrics = 0;
      let weakVerbCount = 0;
      const weakVerbsList = ["helped", "assisted", "worked", "did", "responsible", "managed", "led", "support", "supported"];
      let hasTooManyBullets = false;
      let hasTooFewBullets = false;

      data.experience.forEach(exp => {
        let hasMetric = false;
        let bulletCount = exp.description?.length || 0;

        if (bulletCount > 6) hasTooManyBullets = true;
        if (bulletCount > 0 && bulletCount < 3) hasTooFewBullets = true;

        exp.description?.forEach(bullet => {
          if (metricRegex.test(bullet)) hasMetric = true;
          
          const firstWord = bullet.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, "");
          if (firstWord && weakVerbsList.includes(firstWord)) {
            weakVerbCount++;
          }
        });

        if (hasMetric) rolesWithMetrics++;
      });

      const metricRatio = rolesWithMetrics / data.experience.length;
      if (metricRatio < 0.5) {
        suggestions.push({
          id: "low-metrics",
          type: "warning",
          category: "Performance Metrics",
          text: "Integrate more key results (e.g., %, $) under experience items to prove impact."
        });
        score -= 5;
      } else {
        suggestions.push({
          id: "good-metrics",
          type: "success",
          category: "Performance Metrics",
          text: "Great work! Quantitative results strongly back up your achievements."
        });
        score += 5;
      }

      if (weakVerbCount > 0) {
        suggestions.push({
          id: "weak-verbs",
          type: "info",
          category: "Action Verbs",
          text: `Found ${weakVerbCount} passive words (like 'helped'). Replace with action-oriented alternatives (e.g., 'Spearheaded').`
        });
        score -= 2;
      }

      if (hasTooManyBullets) {
        suggestions.push({
          id: "too-many-bullets",
          type: "info",
          category: "Bullet Density",
          text: "Some positions list more than 6 bullets. Try grouping details to make it readable."
        });
        score -= 2;
      }
    }

    score -= issues.length * 2.5;

    return {
      score: Math.min(100, Math.max(0, Math.round(score))),
      suggestions
    };
  };

  const scoreData = calculateScore();

  // Inline edit handlers
  const handleEditFullName = (text: string) => {
    if (text.trim() && text !== data.fullName) {
      const newData = { ...data, fullName: text };
      updateData(newData, `Changed Full Name to "${text}"`);
    }
  };

  const handleEditSummaryBullet = (idx: number, text: string) => {
    if (data.summary && text !== data.summary[idx]) {
      const newData = JSON.parse(JSON.stringify(data));
      newData.summary[idx] = text;
      updateData(newData, `Updated summary bullet point`);
    }
  };

  const handleEditExpCompany = (idx: number, text: string) => {
    if (text !== data.experience[idx].company) {
      const newData = JSON.parse(JSON.stringify(data));
      newData.experience[idx].company = text;
      updateData(newData, `Updated experience company to "${text}"`);
    }
  };

  const handleEditExpTitle = (idx: number, text: string) => {
    if (text !== data.experience[idx].title) {
      const newData = JSON.parse(JSON.stringify(data));
      newData.experience[idx].title = text;
      updateData(newData, `Updated experience title to "${text}"`);
    }
  };

  const handleEditExpDates = (idx: number, text: string) => {
    if (text !== data.experience[idx].dates) {
      const newData = JSON.parse(JSON.stringify(data));
      newData.experience[idx].dates = text;
      updateData(newData, `Updated experience dates to "${text}"`);
    }
  };

  const handleEditExpLocation = (idx: number, text: string) => {
    if (text !== data.experience[idx].location) {
      const newData = JSON.parse(JSON.stringify(data));
      newData.experience[idx].location = text;
      updateData(newData, `Updated experience location to "${text}"`);
    }
  };

  const handleEditExpBullet = (jobIdx: number, bulletIdx: number, text: string) => {
    if (text !== data.experience[jobIdx].description[bulletIdx]) {
      const newData = JSON.parse(JSON.stringify(data));
      newData.experience[jobIdx].description[bulletIdx] = text;
      updateData(newData, `Edited bullet point under ${data.experience[jobIdx].company}`);
    }
  };

  const handleEditInternCompany = (idx: number, text: string) => {
    if (data.internships && text !== data.internships[idx].company) {
      const newData = JSON.parse(JSON.stringify(data));
      newData.internships[idx].company = text;
      updateData(newData, `Updated internship company to "${text}"`);
    }
  };

  const handleEditInternTitle = (idx: number, text: string) => {
    if (data.internships && text !== data.internships[idx].title) {
      const newData = JSON.parse(JSON.stringify(data));
      newData.internships[idx].title = text;
      updateData(newData, `Updated internship title to "${text}"`);
    }
  };

  const handleEditInternDates = (idx: number, text: string) => {
    if (data.internships && text !== data.internships[idx].dates) {
      const newData = JSON.parse(JSON.stringify(data));
      newData.internships[idx].dates = text;
      updateData(newData, `Updated internship dates to "${text}"`);
    }
  };

  const handleEditInternLocation = (idx: number, text: string) => {
    if (data.internships && text !== data.internships[idx].location) {
      const newData = JSON.parse(JSON.stringify(data));
      newData.internships[idx].location = text;
      updateData(newData, `Updated internship location to "${text}"`);
    }
  };

  const handleEditInternBullet = (internIdx: number, bulletIdx: number, text: string) => {
    if (data.internships && text !== data.internships[internIdx].description[bulletIdx]) {
      const newData = JSON.parse(JSON.stringify(data));
      newData.internships[internIdx].description[bulletIdx] = text;
      updateData(newData, `Edited bullet point under internship ${data.internships[internIdx].company}`);
    }
  };

  const handleEditEduInstitution = (idx: number, text: string) => {
    if (text !== data.education[idx].institution) {
      const newData = JSON.parse(JSON.stringify(data));
      newData.education[idx].institution = text;
      updateData(newData, `Updated institution to "${text}"`);
    }
  };

  const handleEditEduDegree = (idx: number, text: string) => {
    if (text !== data.education[idx].degree) {
      const newData = JSON.parse(JSON.stringify(data));
      newData.education[idx].degree = text;
      updateData(newData, `Updated degree to "${text}"`);
    }
  };

  const handleEditEduDates = (idx: number, text: string) => {
    if (text !== data.education[idx].dates) {
      const newData = JSON.parse(JSON.stringify(data));
      newData.education[idx].dates = text;
      updateData(newData, `Updated education dates to "${text}"`);
    }
  };

  const handleEditEduLocation = (idx: number, text: string) => {
    if (text !== data.education[idx].location) {
      const newData = JSON.parse(JSON.stringify(data));
      newData.education[idx].location = text;
      updateData(newData, `Updated education location to "${text}"`);
    }
  };

  const handleEditEduDetail = (eduIdx: number, detailIdx: number, text: string) => {
    if (data.education[eduIdx].details && text !== data.education[eduIdx].details[detailIdx]) {
      const newData = JSON.parse(JSON.stringify(data));
      newData.education[eduIdx].details[detailIdx] = text;
      updateData(newData, `Edited education details under ${data.education[eduIdx].institution}`);
    }
  };

  const handleEditCustomSectionTitle = (idx: number, text: string) => {
    const cleanedTitle = text.replace(/:$/, "").trim();
    if (cleanedTitle !== data.customSections[idx].title) {
      const newData = JSON.parse(JSON.stringify(data));
      newData.customSections[idx].title = cleanedTitle;
      updateData(newData, `Updated section title to "${cleanedTitle}"`);
    }
  };

  const handleEditCustomSectionItem = (secIdx: number, itemIdx: number, text: string) => {
    if (text !== data.customSections[secIdx].items[itemIdx]) {
      const newData = JSON.parse(JSON.stringify(data));
      newData.customSections[secIdx].items[itemIdx] = text;
      updateData(newData, `Edited item in custom section ${data.customSections[secIdx].title}`);
    }
  };

  return (
    <div className="flex flex-col h-screen w-full lg:overflow-hidden select-none bg-[#04060f]">
      <style>{`
        #resume-preview-content ul li::marker {
          font-size: 13px;
        }
      `}</style>
      
      {/* 1. Header toolbar - Vercel / Linear inspired */}
      <header className="h-[64px] border-b border-white/[0.06] bg-[#070b19] px-6 flex items-center justify-between flex-shrink-0 z-20">
        <div className="flex items-center gap-4">
          <div 
            onClick={onReset}
            className="flex items-center gap-2.5 cursor-pointer group hover:opacity-90 transition-opacity"
          >
            <InteractiveLogo size="sm" />
            <div className="flex flex-col text-left">
              <span className="text-sm font-bold tracking-tight text-white leading-tight">
                Arth<span className="text-gradient-rainbow font-extrabold">Format</span>
              </span>
              <span className="text-[10px] text-slate-500 font-mono tracking-widest font-bold uppercase">Workspace</span>
            </div>
          </div>
          
          <div className="h-4 w-[1px] bg-white/10" />
          
          {/* Auto-Save Indicator */}
          <div className="flex items-center gap-2 text-xs">
            {saveStatus === 'saving' ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                <span className="text-slate-400 font-medium font-sans">Syncing...</span>
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)]" />
                <span className="text-slate-500 font-medium font-sans">Saved to cloud</span>
              </>
            )}
          </div>
        </div>

        {/* View Controls & Action Controls */}
        <div className="flex items-center gap-4">
          
          {/* Comparison Split Mode Toggle */}
          {originalText && (
            <div className="flex items-center p-0.5 bg-white/[0.02] border border-white/[0.06] rounded-lg h-9">
              <button
                onClick={() => setComparisonMode(false)}
                className={`px-3 h-full rounded-md text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer ${
                  !comparisonMode 
                    ? 'bg-indigo-500/10 text-white border border-indigo-500/30' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Single Document Focus View"
              >
                <Eye className="w-3.5 h-3.5" />
                Focus
              </button>
              
              <button
                onClick={() => setComparisonMode(true)}
                className={`px-3 h-full rounded-md text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer ${
                  comparisonMode 
                    ? 'bg-indigo-500/10 text-white border border-indigo-500/30' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Side-by-Side Comparison"
              >
                <Split className="w-3.5 h-3.5" />
                Split Diff
              </button>
            </div>
          )}
          
          {/* Action Operations */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleCheckGrammar}
              disabled={isChecking}
              className="btn-2026-primary px-4 h-9 text-[10px] font-bold uppercase tracking-wider rounded-lg flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              {isChecking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-indigo-400" />}
              Check Grammar
            </button>
            
            <button
              onClick={handleDownloadDOCX}
              className="btn-2026-neon px-4 h-9 text-[10px] font-bold uppercase tracking-wider rounded-lg flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Download DOCX
            </button>

            <button
              onClick={handleDownloadPDF}
              className="btn-2026-secondary px-4 h-9 text-[10px] font-bold uppercase tracking-wider rounded-lg flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              PDF
            </button>
          </div>

          <div className="h-4 w-[1px] bg-white/10" />

          {/* Collapsible Utility Sidebar Button */}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className={`p-2 rounded-lg border transition-colors cursor-pointer ${
              sidebarOpen 
                ? 'border-indigo-500/30 text-white bg-indigo-500/10' 
                : 'border-white/5 text-slate-400 hover:text-white hover:bg-white/5'
            }`}
            title="Toggle Sidebar"
          >
            <PanelRight className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* 2. Main content area */}
      <div className="flex-1 min-h-0 flex w-full relative">
        
        {/* Editor Wrapper (Splits into 2 screens if comparisonMode is true) */}
        <div className="flex-1 min-w-0 flex h-full bg-[#04060f] overflow-hidden">
          
          {/* Left panel: Original Raw Text (Only when Comparison Mode is enabled) */}
          {comparisonMode && originalText && (
            <div className="flex-1 h-full border-r border-white/5 flex flex-col min-w-0 bg-[#080d24]/40">
              <div className="h-10 px-5 flex items-center justify-between border-b border-white/5 bg-[#080d24]/60 flex-shrink-0">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">Original Text Input</span>
                <span className="text-[9px] text-slate-500 font-mono">Read-Only</span>
              </div>
              <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                <pre className="text-xs text-slate-400 font-mono leading-relaxed text-left whitespace-pre-wrap select-text selection:bg-indigo-500/25">
                  {originalText}
                </pre>
              </div>
            </div>
          )}

          {/* Right panel: A4 Format Preview Editor */}
          <div className="flex-1 h-full flex flex-col min-w-0 overflow-y-auto custom-scrollbar p-8 items-center bg-[#050714]">
            
            {/* The Document page (A4 style white sheet) floating on dark slate desk */}
            <div 
              id="resume-preview-content"
              className="w-full max-w-[820px] bg-white text-black p-12 rounded-lg shadow-[0_24px_64px_rgba(0,0,0,0.6),0_2px_4px_rgba(255,255,255,0.03)] text-left flex-shrink-0 my-4 select-text"
              style={{ 
                fontFamily: styles.fontFamily, 
                color: black, 
                lineHeight: styles.lineHeight
              }}
            >
              
              {/* 1. Name */}
              <div style={{ textAlign: styles.nameAlign, marginBottom: styles.marginBottom }}>
                <h1 
                  contentEditable
                  suppressContentEditableWarning
                  onBlur={(e) => handleEditFullName(e.currentTarget.textContent || "")}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                  style={{ fontWeight: 'bold', textTransform: 'uppercase', fontSize: styles.fontSizeName, color: styles.headingColor === "#000000" ? black : styles.headingColor, margin: 0, outline: 'none' }}
                  className="hover:bg-slate-100 focus:bg-slate-100 transition-colors px-1 rounded cursor-text"
                >
                  {data.fullName}
                </h1>
                
                {/* Custom Contact Info row for Classic Professional based on Selection Panel */}
                {selectedFormat === ResumeFormat.CLASSIC_PROFESSIONAL && (retainedFields.location || retainedFields.phone || retainedFields.email) && (
                  <div style={{ 
                      fontSize: styles.fontSizeBody, 
                      color: black, 
                      marginTop: '4px', 
                      fontWeight: 'normal' 
                  }}>
                      {[
                          retainedFields.phone && data.contactInfo?.phone,
                          retainedFields.email && data.contactInfo?.email,
                          retainedFields.location && data.contactInfo?.location ? formatLocation(data.contactInfo.location) : null
                      ].filter(Boolean).join(" | ")}
                  </div>
                )}

                {/* Existing block for Modern Executive structure */}
                {selectedFormat === ResumeFormat.MODERN_EXECUTIVE && (
                  <div style={{ 
                      fontSize: styles.fontSizeName, 
                      color: black, 
                      marginTop: '4px', 
                      fontWeight: 'bold' 
                  }}>
                      {retainedFields.location || (!retainedFields.phone && !retainedFields.email) ? (
                          formatLocation(data.contactInfo?.location || "")
                      ) : ""}
                      {(retainedFields.phone || retainedFields.email) ? (
                          [
                              retainedFields.location && formatLocation(data.contactInfo?.location || ""),
                              retainedFields.phone && data.contactInfo?.phone,
                              retainedFields.email && data.contactInfo?.email
                          ].filter(Boolean).join(" | ")
                      ) : ""}
                  </div>
                )}
              </div>

              {/* 2. Summary */}
              {data.summary && (
                <div style={{ marginBottom: styles.marginBottom }}>
                  <h3 style={{ 
                      fontWeight: 'bold', 
                      textTransform: styles.headingTransform, 
                      marginTop: styles.headingMarginTop,
                      marginBottom: styles.headingMarginBottom, 
                      fontSize: styles.fontSizeBody, 
                      color: styles.headingColor,
                      borderBottom: styles.headingBorder,
                      paddingBottom: styles.headingBorder !== 'none' ? '2px' : '0'
                  }}>
                    {formatTitle(data.sectionTitleSummary || "SUMMARY")}
                  </h3>
                  {Array.isArray(data.summary) ? (
                      data.summary.length === 1 ? (
                         <ul style={{ listStyleType: 'disc', paddingLeft: '1.25rem', marginTop: 0 }}>
                            {processDescriptionWithIndices(data.summary).map((bulletObj, idx) => {
                              return (
                                <li key={idx} style={{ fontSize: styles.fontSizeBody, lineHeight: styles.lineHeight, marginBottom: '2px', paddingLeft: '2px' }}>
                                  <GrammarHighlighter 
                                    text={bulletObj.text} 
                                    path={`summary.${bulletObj.originalIndex}`} 
                                    issues={issues} 
                                    onAccept={handleAcceptIssue} 
                                    onIgnore={handleIgnoreIssue} 
                                    onEdit={(newVal) => handleEditSummaryBullet(bulletObj.originalIndex, newVal)}
                                  />
                                </li>
                              );
                            })}
                         </ul>
                      ) : (
                         <ul style={{ listStyleType: 'disc', paddingLeft: '1.25rem', marginTop: 0 }}>
                            {data.summary.map((rawItem, idx) => {
                              const item = cleanBullet(rawItem);
                              return (
                              <li key={idx} style={{ fontSize: styles.fontSizeBody, lineHeight: styles.lineHeight, marginBottom: '2px', paddingLeft: '2px' }}>
                                <GrammarHighlighter 
                                  text={item} 
                                  path={`summary.${idx}`} 
                                  issues={issues} 
                                  onAccept={handleAcceptIssue} 
                                  onIgnore={handleIgnoreIssue} 
                                  onEdit={(newVal) => handleEditSummaryBullet(idx, newVal)}
                                />
                              </li>
                            )})}
                         </ul>
                      )
                  ) : (
                      <ul style={{ listStyleType: 'disc', paddingLeft: '1.25rem', marginTop: 0 }}>
                        {processDescription([data.summary]).map((rawItem, idx) => {
                          const item = cleanBullet(rawItem);
                          return (
                            <li key={idx} style={{ fontSize: styles.fontSizeBody, lineHeight: styles.lineHeight, marginBottom: '2px', paddingLeft: '2px' }}>
                              <GrammarHighlighter 
                                text={item} 
                                path={`summary`} 
                                issues={issues} 
                                onAccept={handleAcceptIssue} 
                                onIgnore={handleIgnoreIssue} 
                                onEdit={(newVal) => {
                                  if (newVal !== item) {
                                    const newData = { ...data, summary: [newVal] };
                                    updateData(newData, "Edited summary bullet");
                                  }
                                }}
                              />
                            </li>
                          );
                        })}
                      </ul>
                  )}
                </div>
              )}

              {/* 3. Experience */}
              {data.experience && data.experience.length > 0 && (
                <div style={{ marginBottom: styles.marginBottom }}>
                  <h3 style={{ 
                      fontWeight: 'bold', 
                      textTransform: styles.headingTransform, 
                      marginTop: styles.headingMarginTop,
                      marginBottom: styles.headingMarginBottom, 
                      fontSize: styles.fontSizeBody, 
                      color: styles.headingColor,
                      borderBottom: styles.headingBorder,
                      paddingBottom: styles.headingBorder !== 'none' ? '2px' : '0'
                  }}>
                    {formatTitle(data.sectionTitleExperience || "PROFESSIONAL EXPERIENCE")}
                  </h3>
                  
                  <div style={{ paddingTop: '0.25rem' }}>
                    {data.experience.map((exp, idx) => (
                      <div key={idx} style={{ marginBottom: '1rem' }}>
                        {styles.jobLayout === 'modern' ? (
                            <>
                                {exp.dates && exp.dates !== "undefined" && (
                                  <div style={{ fontWeight: 'bold', fontSize: styles.fontSizeBody, color: black, marginBottom: '2px' }}>
                                    <span
                                      contentEditable
                                      suppressContentEditableWarning
                                      onBlur={(e) => handleEditExpDates(idx, e.currentTarget.textContent || "")}
                                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                                      className="hover:bg-slate-100 focus:bg-slate-100 transition-colors px-1 rounded cursor-text outline-none"
                                    >
                                      {formatModernDate(exp.dates)}
                                    </span>
                                  </div>
                                )}
                                <div style={{ fontWeight: 'bold', fontSize: styles.fontSizeBody, color: black, marginBottom: '2px' }}>
                                    <span
                                      contentEditable
                                      suppressContentEditableWarning
                                      onBlur={(e) => handleEditExpCompany(idx, e.currentTarget.textContent || "")}
                                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                                      className="hover:bg-slate-100 focus:bg-slate-100 transition-colors px-1 rounded cursor-text outline-none"
                                    >
                                      {stripTrailingDate(exp.company)}
                                    </span>
                                    {exp.location && (
                                      <>
                                        {", "}
                                        <span
                                          contentEditable
                                          suppressContentEditableWarning
                                          onBlur={(e) => handleEditExpLocation(idx, e.currentTarget.textContent || "")}
                                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                                          className="hover:bg-slate-100 focus:bg-slate-100 transition-colors px-1 rounded cursor-text outline-none"
                                        >
                                          {formatLocation(exp.location)}
                                        </span>
                                      </>
                                    )}
                                </div>
                                <div style={{ fontWeight: 'bold', fontSize: styles.fontSizeBody, color: black, marginBottom: '4px' }}>
                                    <span
                                      contentEditable
                                      suppressContentEditableWarning
                                      onBlur={(e) => handleEditExpTitle(idx, e.currentTarget.textContent || "")}
                                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                                      className="hover:bg-slate-100 focus:bg-slate-100 transition-colors px-1 rounded cursor-text outline-none"
                                    >
                                      {stripTrailingDate(exp.title)}
                                    </span>
                                </div>
                            </>
                        ) : (
                            <>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                  <span style={{ fontWeight: 'bold', fontSize: styles.fontSizeBody, color: black }}>
                                    <span
                                      contentEditable
                                      suppressContentEditableWarning
                                      onBlur={(e) => handleEditExpCompany(idx, e.currentTarget.textContent || "")}
                                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                                      className="hover:bg-slate-100 focus:bg-slate-100 transition-colors px-1 rounded cursor-text outline-none"
                                    >
                                      {stripTrailingDate(exp.company)}
                                    </span>
                                    {exp.location && (
                                      <>
                                        {", "}
                                        <span
                                          contentEditable
                                          suppressContentEditableWarning
                                          onBlur={(e) => handleEditExpLocation(idx, e.currentTarget.textContent || "")}
                                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                                          className="hover:bg-slate-100 focus:bg-slate-100 transition-colors px-1 rounded cursor-text outline-none"
                                        >
                                          {formatLocation(exp.location)}
                                        </span>
                                      </>
                                    )}
                                  </span>
                                  {exp.dates && exp.dates !== "undefined" && (
                                    <span style={{ fontWeight: 'bold', textAlign: 'right', fontSize: styles.fontSizeBody, color: black }}>
                                      <span
                                        contentEditable
                                        suppressContentEditableWarning
                                        onBlur={(e) => handleEditExpDates(idx, e.currentTarget.textContent || "")}
                                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                                        className="hover:bg-slate-100 focus:bg-slate-100 transition-colors px-1 rounded cursor-text outline-none"
                                      >
                                        {formatModernDate(exp.dates)}
                                      </span>
                                    </span>
                                  )}
                                </div>
                                <div style={{ fontWeight: 'bold', marginBottom: 0, fontSize: styles.fontSizeBody, color: black }}>
                                  <span
                                    contentEditable
                                    suppressContentEditableWarning
                                    onBlur={(e) => handleEditExpTitle(idx, e.currentTarget.textContent || "")}
                                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                                    className="hover:bg-slate-100 focus:bg-slate-100 transition-colors px-1 rounded cursor-text outline-none"
                                  >
                                    {stripTrailingDate(exp.title)}
                                  </span>
                                </div>
                            </>
                        )}
                        <ul style={{ listStyleType: 'disc', paddingLeft: '1.25rem', marginTop: 0 }}>
                          {exp.description && processDescriptionWithIndices(exp.description).map((bulletObj, bIdx) => (
                            <li key={bIdx} style={{ fontSize: styles.fontSizeBody, lineHeight: styles.lineHeight, marginBottom: '2px', paddingLeft: '2px' }}>
                                <GrammarHighlighter 
                                  text={bulletObj.text} 
                                  path={`experience.${idx}.description.${bulletObj.originalIndex}`}
                                  issues={issues} 
                                  onAccept={handleAcceptIssue} 
                                  onIgnore={handleIgnoreIssue} 
                                  onEdit={(newVal) => handleEditExpBullet(idx, bulletObj.originalIndex, newVal)}
                                />
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 4. Internships */}
              {data.internships && data.internships.length > 0 && (
                <div style={{ marginBottom: styles.marginBottom }}>
                  <h3 style={{ 
                      fontWeight: 'bold', 
                      textTransform: styles.headingTransform, 
                      marginTop: styles.headingMarginTop,
                      marginBottom: styles.headingMarginBottom, 
                      fontSize: styles.fontSizeBody, 
                      color: styles.headingColor,
                      borderBottom: styles.headingBorder,
                      paddingBottom: styles.headingBorder !== 'none' ? '2px' : '0'
                  }}>
                    {formatTitle(data.sectionTitleInternships || "INTERNSHIPS")}
                  </h3>
                  
                  <div style={{ paddingTop: '0.25rem' }}>
                    {data.internships.map((exp, idx) => (
                      <div key={idx} style={{ marginBottom: '1rem' }}>
                        {styles.jobLayout === 'modern' ? (
                            <>
                                {exp.dates && exp.dates !== "undefined" && (
                                  <div style={{ fontWeight: 'bold', fontSize: styles.fontSizeBody, color: black, marginBottom: '2px' }}>
                                    <span
                                      contentEditable
                                      suppressContentEditableWarning
                                      onBlur={(e) => handleEditInternDates(idx, e.currentTarget.textContent || "")}
                                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                                      className="hover:bg-slate-100 focus:bg-slate-100 transition-colors px-1 rounded cursor-text outline-none"
                                    >
                                      {formatModernDate(exp.dates)}
                                    </span>
                                  </div>
                                )}
                                <div style={{ fontWeight: 'bold', fontSize: styles.fontSizeBody, color: black, marginBottom: '2px' }}>
                                    <span
                                      contentEditable
                                      suppressContentEditableWarning
                                      onBlur={(e) => handleEditInternCompany(idx, e.currentTarget.textContent || "")}
                                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                                      className="hover:bg-slate-100 focus:bg-slate-100 transition-colors px-1 rounded cursor-text outline-none"
                                    >
                                      {stripTrailingDate(exp.company)}
                                    </span>
                                    {exp.location && (
                                      <>
                                        {", "}
                                        <span
                                          contentEditable
                                          suppressContentEditableWarning
                                          onBlur={(e) => handleEditInternLocation(idx, e.currentTarget.textContent || "")}
                                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                                          className="hover:bg-slate-100 focus:bg-slate-100 transition-colors px-1 rounded cursor-text outline-none"
                                        >
                                          {formatLocation(exp.location)}
                                        </span>
                                      </>
                                    )}
                                </div>
                                <div style={{ fontWeight: 'bold', fontSize: styles.fontSizeBody, color: black, marginBottom: '4px' }}>
                                    <span
                                      contentEditable
                                      suppressContentEditableWarning
                                      onBlur={(e) => handleEditInternTitle(idx, e.currentTarget.textContent || "")}
                                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                                      className="hover:bg-slate-100 focus:bg-slate-100 transition-colors px-1 rounded cursor-text outline-none"
                                    >
                                      {stripTrailingDate(exp.title)}
                                    </span>
                                </div>
                            </>
                        ) : (
                            <>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                  <span style={{ fontWeight: 'bold', fontSize: styles.fontSizeBody, color: black }}>
                                    <span
                                      contentEditable
                                      suppressContentEditableWarning
                                      onBlur={(e) => handleEditInternCompany(idx, e.currentTarget.textContent || "")}
                                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                                      className="hover:bg-slate-100 focus:bg-slate-100 transition-colors px-1 rounded cursor-text outline-none"
                                    >
                                      {stripTrailingDate(exp.company)}
                                    </span>
                                    {exp.location && (
                                      <>
                                        {", "}
                                        <span
                                          contentEditable
                                          suppressContentEditableWarning
                                          onBlur={(e) => handleEditInternLocation(idx, e.currentTarget.textContent || "")}
                                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                                          className="hover:bg-slate-100 focus:bg-slate-100 transition-colors px-1 rounded cursor-text outline-none"
                                        >
                                          {formatLocation(exp.location)}
                                        </span>
                                      </>
                                    )}
                                  </span>
                                  {exp.dates && exp.dates !== "undefined" && (
                                    <span style={{ fontWeight: 'bold', textAlign: 'right', fontSize: styles.fontSizeBody, color: black }}>
                                      <span
                                        contentEditable
                                        suppressContentEditableWarning
                                        onBlur={(e) => handleEditInternDates(idx, e.currentTarget.textContent || "")}
                                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                                        className="hover:bg-slate-100 focus:bg-slate-100 transition-colors px-1 rounded cursor-text outline-none"
                                      >
                                        {formatModernDate(exp.dates)}
                                      </span>
                                    </span>
                                  )}
                                </div>
                                <div style={{ fontWeight: 'bold', marginBottom: 0, fontSize: styles.fontSizeBody, color: black }}>
                                  <span
                                    contentEditable
                                    suppressContentEditableWarning
                                    onBlur={(e) => handleEditInternTitle(idx, e.currentTarget.textContent || "")}
                                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                                    className="hover:bg-slate-100 focus:bg-slate-100 transition-colors px-1 rounded cursor-text outline-none"
                                  >
                                    {stripTrailingDate(exp.title)}
                                  </span>
                                </div>
                            </>
                        )}
                        <ul style={{ listStyleType: 'disc', paddingLeft: '1.25rem', marginTop: 0 }}>
                          {exp.description && processDescriptionWithIndices(exp.description).map((bulletObj, bIdx) => (
                            <li key={bIdx} style={{ fontSize: styles.fontSizeBody, lineHeight: styles.lineHeight, marginBottom: '2px', paddingLeft: '2px' }}>
                                <GrammarHighlighter 
                                  text={bulletObj.text} 
                                  path={`internships.${idx}.description.${bulletObj.originalIndex}`} 
                                  issues={issues} 
                                  onAccept={handleAcceptIssue} 
                                  onIgnore={handleIgnoreIssue} 
                                  onEdit={(newVal) => handleEditInternBullet(idx, bulletObj.originalIndex, newVal)}
                                />
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 5. Education */}
              {data.education && data.education.length > 0 && (
                <div style={{ marginBottom: styles.marginBottom }}>
                  <h3 style={{ 
                      fontWeight: 'bold', 
                      textTransform: styles.headingTransform, 
                      marginTop: styles.headingMarginTop,
                      marginBottom: styles.headingMarginBottom, 
                      fontSize: styles.fontSizeBody, 
                      color: styles.headingColor,
                      borderBottom: styles.headingBorder,
                      paddingBottom: styles.headingBorder !== 'none' ? '2px' : '0'
                  }}>
                    {formatTitle(data.sectionTitleEducation || "EDUCATION")}
                  </h3>
                  <div style={{ paddingTop: '0.25rem' }}>
                     {data.education.map((edu, idx) => (
                      <div key={idx} style={{ marginBottom: '0.5rem' }}>
                        <div style={{ display: 'flex', justifySelf: 'stretch', justifyContent: 'space-between', alignItems: 'baseline' }}>
                          <span style={{ fontWeight: 'bold', fontSize: styles.fontSizeBody, color: black }}>
                            <span
                              contentEditable
                              suppressContentEditableWarning
                              onBlur={(e) => handleEditEduInstitution(idx, e.currentTarget.textContent || "")}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                              className="hover:bg-slate-100 focus:bg-slate-100 transition-colors px-1 rounded cursor-text outline-none"
                            >
                              {stripTrailingDate(edu.institution)}
                            </span>
                            {edu.location && (
                              <>
                                {", "}
                                <span
                                  contentEditable
                                  suppressContentEditableWarning
                                  onBlur={(e) => handleEditEduLocation(idx, e.currentTarget.textContent || "")}
                                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                                  className="hover:bg-slate-100 focus:bg-slate-100 transition-colors px-1 rounded cursor-text outline-none"
                                >
                                  {formatLocation(edu.location)}
                                </span>
                              </>
                            )}
                          </span>
                          {edu.dates && edu.dates !== "undefined" && (
                            <span style={{ fontWeight: 'bold', textAlign: 'right', fontSize: styles.fontSizeBody, color: black }}>
                              <span
                                contentEditable
                                suppressContentEditableWarning
                                onBlur={(e) => handleEditEduDates(idx, e.currentTarget.textContent || "")}
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                                className="hover:bg-slate-100 focus:bg-slate-100 transition-colors px-1 rounded cursor-text outline-none"
                              >
                                {formatModernDate(edu.dates)}
                              </span>
                            </span>
                          )}
                        </div>
                        <div style={{ fontWeight: 'bold', fontSize: styles.fontSizeBody, color: black }}>
                          <span
                            contentEditable
                            suppressContentEditableWarning
                            onBlur={(e) => handleEditEduDegree(idx, e.currentTarget.textContent || "")}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                            className="hover:bg-slate-100 focus:bg-slate-100 transition-colors px-1 rounded cursor-text outline-none"
                          >
                            {stripTrailingDate(edu.degree)}
                          </span>
                        </div>
                        {edu.details && edu.details.length > 0 && (
                           <ul style={{ listStyleType: 'disc', paddingLeft: '1.25rem', marginTop: 0 }}>
                             {processDescriptionWithIndices(edu.details).map((bulletObj, dIdx) => (
                               <li key={dIdx} style={{ fontSize: styles.fontSizeBody, lineHeight: styles.lineHeight, marginBottom: '2px', paddingLeft: '2px' }}>
                                  <GrammarHighlighter 
                                    text={bulletObj.text} 
                                    path={`education.${idx}.details.${bulletObj.originalIndex}`} 
                                    issues={issues} 
                                    onAccept={handleAcceptIssue} 
                                    onIgnore={handleIgnoreIssue} 
                                    onEdit={(newVal) => handleEditEduDetail(idx, bulletObj.originalIndex, newVal)}
                                  />
                                </li>
                             ))}
                           </ul>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 6. Custom Sections (Skills, Tools, etc.) */}
              {data.customSections && data.customSections.map((section, idx) => {
                   const titleUpper = section.title.toUpperCase();
                   const isGridCandidate = titleUpper.includes("SKILLS") || titleUpper.includes("COMPETENCIES") || titleUpper.includes("LANGUAGES");
                   const hasLongItems = section.items && section.items.some(item => item.length > 60);
                   const useColumns = isGridCandidate && !hasLongItems && section.items && section.items.length > 2;

                   return (
                     <div key={idx} style={{ marginBottom: styles.marginBottom }}>
                       <h3 
                         contentEditable
                         suppressContentEditableWarning
                         onBlur={(e) => handleEditCustomSectionTitle(idx, e.currentTarget.textContent || "")}
                         onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                         style={{ 
                             fontWeight: 'bold', 
                             textTransform: styles.headingTransform, 
                             marginTop: styles.headingMarginTop,
                             marginBottom: styles.headingMarginBottom, 
                             fontSize: styles.fontSizeBody, 
                             color: styles.headingColor,
                             borderBottom: styles.headingBorder,
                             paddingBottom: styles.headingBorder !== 'none' ? '2px' : '0',
                             outline: 'none'
                         }}
                         className="hover:bg-slate-100 focus:bg-slate-100 transition-colors px-1 rounded cursor-text inline-block"
                       >
                         {formatTitle(section.title)}
                       </h3>
                       <div style={{ paddingTop: '0.25rem' }}>
                           <ul style={{ 
                               columnCount: useColumns ? 2 : 1, 
                               columnGap: '2rem', 
                               paddingLeft: '1.25rem', 
                               marginTop: 0,
                               listStyleType: 'disc'
                           }}>
                              {section.items && groupBulletPoints(section.items).map((g, gIdx) => {
                                if (g.key) {
                                  if (g.values.length === 1) {
                                    return (
                                      <li key={gIdx} style={{ listStyleType: 'none', marginLeft: '-1.25rem', fontSize: styles.fontSizeBody, lineHeight: styles.lineHeight, marginBottom: '2px', breakInside: 'avoid' }}>
                                        <span style={{ fontWeight: 'bold' }}>{g.key}:</span>{' '}
                                        <GrammarHighlighter 
                                          text={g.values[0].text} 
                                          path={`customSections.${idx}.items.${g.values[0].originalIndex}`} 
                                          issues={issues} 
                                          onAccept={handleAcceptIssue} 
                                          onIgnore={handleIgnoreIssue} 
                                          onEdit={(newVal) => handleEditCustomSectionItem(idx, g.values[0].originalIndex, newVal)}
                                        />
                                      </li>
                                    );
                                  } else {
                                    return (
                                      <li key={gIdx} style={{ listStyleType: 'none', marginLeft: '-1.25rem', fontSize: styles.fontSizeBody, lineHeight: styles.lineHeight, marginBottom: '2px', breakInside: 'avoid' }}>
                                        <div style={{ fontWeight: 'bold' }}>{g.key}:</div>
                                        <ul style={{ listStyleType: 'disc', paddingLeft: '1.25rem', marginTop: '2px', marginBottom: 0 }}>
                                          {g.values.map((v, vIdx) => (
                                            <li key={vIdx} style={{ marginBottom: '2px', paddingLeft: '2px' }}>
                                              <GrammarHighlighter 
                                                text={v.text} 
                                                path={`customSections.${idx}.items.${v.originalIndex}`} 
                                                issues={issues} 
                                                onAccept={handleAcceptIssue} 
                                                onIgnore={handleIgnoreIssue} 
                                                onEdit={(newVal) => handleEditCustomSectionItem(idx, v.originalIndex, newVal)}
                                              />
                                            </li>
                                          ))}
                                        </ul>
                                      </li>
                                    );
                                  }
                                } else {
                                  return g.values.map((v, vIdx) => (
                                    <li key={`${gIdx}-${vIdx}`} style={{ fontSize: styles.fontSizeBody, lineHeight: styles.lineHeight, marginBottom: '2px', paddingLeft: '2px', breakInside: 'avoid' }}>
                                      <GrammarHighlighter 
                                        text={v.text} 
                                        path={`customSections.${idx}.items.${v.originalIndex}`} 
                                        issues={issues} 
                                        onAccept={handleAcceptIssue} 
                                        onIgnore={handleIgnoreIssue} 
                                        onEdit={(newVal) => handleEditCustomSectionItem(idx, v.originalIndex, newVal)}
                                      />
                                    </li>
                                  ));
                                }
                              })}
                           </ul>
                       </div>
                     </div>
                   );
              })}

            </div>
          </div>
        </div>

        {/* Collapsible Utility Sidebar panel */}
        <AnimatePresence>
          {sidebarOpen && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 384, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="flex-shrink-0 h-full border-l border-white/5 bg-[#080b19] flex flex-col overflow-hidden z-10 text-left"
            >
              {/* Tab navigation headers */}
              <div className="flex border-b border-white/[0.06] bg-[#070914] flex-shrink-0">
                <button
                  onClick={() => setActiveTab('insights')}
                  className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-wider text-center border-b-2 transition-colors cursor-pointer ${
                    activeTab === 'insights'
                      ? 'border-indigo-500 text-white bg-white/[0.01]'
                      : 'border-transparent text-slate-500 hover:text-slate-300'
                  }`}
                >
                  Insights
                </button>
                <button
                  onClick={() => setActiveTab('signals')}
                  className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-wider text-center border-b-2 relative transition-colors cursor-pointer ${
                    activeTab === 'signals'
                      ? 'border-indigo-500 text-white bg-white/[0.01]'
                      : 'border-transparent text-slate-500 hover:text-slate-300'
                  }`}
                >
                  Signals
                  {issues.length > 0 && (
                    <span className="absolute top-2 right-2.5 w-4 h-4 rounded-full bg-rose-500 text-white text-[9px] font-extrabold flex items-center justify-center">
                      {issues.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setActiveTab('logs')}
                  className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-wider text-center border-b-2 transition-colors cursor-pointer ${
                    activeTab === 'logs'
                      ? 'border-indigo-500 text-white bg-white/[0.01]'
                      : 'border-transparent text-slate-500 hover:text-slate-300'
                  }`}
                >
                  History
                </button>
                <button
                  onClick={() => setActiveTab('settings')}
                  className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-wider text-center border-b-2 transition-colors cursor-pointer ${
                    activeTab === 'settings'
                      ? 'border-indigo-500 text-white bg-white/[0.01]'
                      : 'border-transparent text-slate-500 hover:text-slate-300'
                  }`}
                >
                  Settings
                </button>
              </div>

              {/* Tab Contents */}
              <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
                
                {/* 1. Insights Tab */}
                {activeTab === 'insights' && (
                  <div className="space-y-6">
                    {/* Real-time score widget */}
                    <div className="p-4 rounded-xl bg-white/[0.01] border border-white/[0.05] flex items-center justify-between">
                      <div className="flex flex-col text-left">
                        <span className="text-xs text-slate-400 font-medium">Resume Rating</span>
                        <span className="text-2xl font-bold text-white mt-1 font-display">{scoreData.score}/100</span>
                      </div>
                      
                      {/* Linear-like Score circular gauge */}
                      <div className="relative w-14 h-14">
                        <svg className="w-full h-full transform -rotate-90">
                          <circle
                            cx="28"
                            cy="28"
                            r="25"
                            className="stroke-white/[0.03]"
                            strokeWidth="3"
                            fill="transparent"
                          />
                          <circle
                            cx="28"
                            cy="28"
                            r="25"
                            className="stroke-indigo-500 transition-all duration-500"
                            strokeWidth="3"
                            fill="transparent"
                            strokeDasharray="157"
                            strokeDashoffset={157 - (157 * scoreData.score) / 100}
                          />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Award className="w-5 h-5 text-indigo-400" />
                        </div>
                      </div>
                    </div>

                    {/* Suggestions list */}
                    <div className="space-y-3">
                      <h4 className="text-xs font-bold text-slate-400 tracking-wider uppercase font-display">Recruiter Optimization Checklist</h4>
                      <div className="space-y-2.5">
                        {scoreData.suggestions.map((s) => (
                          <div 
                            key={s.id} 
                            className={`p-3 rounded-xl border flex items-start gap-3 transition-colors ${
                              s.type === 'success' 
                                ? 'bg-emerald-500/[0.02] border-emerald-500/10' 
                                : s.type === 'warning'
                                  ? 'bg-rose-500/[0.02] border-rose-500/10'
                                  : 'bg-white/[0.01] border-white/[0.04]'
                            }`}
                          >
                            <span className="mt-1 flex-shrink-0">
                              {s.type === 'success' ? (
                                <Check className="w-4 h-4 text-emerald-400" />
                              ) : s.type === 'warning' ? (
                                <AlertCircle className="w-4 h-4 text-rose-450" />
                              ) : (
                                <Info className="w-4 h-4 text-slate-400" />
                              )}
                            </span>
                            <div className="flex-1 flex flex-col text-left">
                              <span className={`text-[10px] font-bold uppercase tracking-wider leading-none mb-1 ${
                                s.type === 'success' ? 'text-emerald-400' : s.type === 'warning' ? 'text-rose-400' : 'text-slate-400'
                              }`}>
                                {s.category}
                              </span>
                              <p className="text-xs text-slate-300 font-light leading-relaxed">{s.text}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. Signals (Parser Signals) Tab */}
                {activeTab === 'signals' && (
                  <div className="h-full flex flex-col">
                    <div className="flex items-center justify-between mb-4 flex-shrink-0">
                      <h4 className="text-xs font-bold text-slate-400 tracking-wider uppercase font-display">Active Parser Issues ({issues.length})</h4>
                      {issues.length > 0 && (
                        <button 
                          onClick={handleFixAll}
                          className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-300 hover:text-indigo-200 transition-all bg-indigo-500/15 px-3 py-1.5 rounded-lg border border-indigo-500/25 cursor-pointer"
                        >
                          Fix All
                        </button>
                      )}
                    </div>
                    
                    {issues.length === 0 ? (
                      <div className="flex-1 flex flex-col items-center justify-center text-center py-12">
                        <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center mb-3">
                          <Check className="w-6 h-6 text-emerald-400" />
                        </div>
                        <p className="text-xs text-slate-500 font-light">No active issues. Scan with the "Check Grammar" tool to find spelling and style optimizations.</p>
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {issues.map((issue) => (
                          <div 
                            key={issue.id}
                            onClick={() => {
                              const el = document.getElementById(`issue-${issue.id}`);
                              if (el) {
                                  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                  const spanEl = el.querySelector('span[style*="cursor: pointer"]');
                                  if (spanEl) {
                                      (spanEl as HTMLElement).click();
                                  }
                              }
                            }}
                            className="p-3 rounded-xl bg-white/[0.01] border border-white/[0.04] hover:border-white/[0.08] hover:bg-white/[0.03] transition-all group cursor-pointer"
                          >
                            <div className="flex items-center justify-between mb-1.5">
                              <span className={`text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${
                                  issue.type === 'SPELLING' ? 'bg-rose-500/15 text-rose-300 border border-rose-500/10' : (issue.type === 'STYLE' ? 'bg-purple-500/15 text-purple-300 border border-purple-500/10' : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/10')
                              }`}>
                                  {issue.type}
                              </span>
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button 
                                      onClick={(e) => { e.stopPropagation(); handleIgnoreIssue(issue); }}
                                      className="p-1 hover:bg-white/10 rounded text-slate-400"
                                  >
                                      <X className="w-3 h-3" />
                                  </button>
                                  <button 
                                      onClick={(e) => { e.stopPropagation(); handleAcceptIssue(issue); }}
                                      className="p-1 hover:bg-emerald-500/20 rounded text-emerald-400"
                                  >
                                      <Check className="w-3 h-3" />
                                  </button>
                              </div>
                            </div>
                            <p className="text-xs text-slate-300 line-clamp-2 mb-2 font-light">"{issue.errorText}"</p>
                            <div className="flex items-center gap-2 text-[10px] text-emerald-400 font-semibold uppercase tracking-wider">
                                <ArrowRight className="w-3 h-3 text-emerald-500" /> {issue.suggestions[0]}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 3. History (Version Snapshots & Logs) Tab */}
                {activeTab === 'logs' && (
                  <div className="space-y-6">
                    {/* Revisions snapshots list */}
                    <div className="space-y-3">
                      <h4 className="text-xs font-bold text-slate-400 tracking-wider uppercase font-display">Version History Revisions</h4>
                      <div className="relative border-l border-white/5 pl-4 ml-1.5 space-y-4 text-left">
                        {historyStack.map((rev, revIdx) => (
                          <div key={rev.id} className="relative">
                            <span className={`absolute -left-[21px] w-2.5 h-2.5 rounded-full border-2 border-[#080b19] transition-colors ${
                              revIdx === currentHistoryIndex 
                                ? 'bg-indigo-500 ring-4 ring-indigo-500/20' 
                                : 'bg-slate-700 hover:bg-slate-500'
                            }`} />
                            
                            <div className="flex flex-col">
                              <span className="text-xs font-medium text-slate-200">{rev.description}</span>
                              <span className="text-[10px] text-slate-500 mt-0.5">
                                {new Date(rev.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                              </span>
                              {revIdx !== currentHistoryIndex && (
                                <button
                                  onClick={() => handleRestoreRevision(revIdx)}
                                  className="text-[10px] font-bold text-indigo-400 hover:text-indigo-300 text-left mt-1.5"
                                >
                                  Revert to this state
                                </button>
                              )}
                              {revIdx === currentHistoryIndex && (
                                <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-wider mt-1">Active Version</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="h-[1px] bg-white/5" />

                    {/* Timeline of edits */}
                    {changeLog.length > 0 && (
                      <div className="space-y-3">
                        <h4 className="text-xs font-bold text-slate-400 tracking-wider uppercase font-display">Refiner Logs</h4>
                        <div className="space-y-3">
                          {changeLog.map((log) => (
                            <div key={log.id} className="p-3 rounded-xl bg-white/[0.01] border border-white/[0.04] text-left">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-350 border border-indigo-500/5">
                                    {log.path.split('.').pop()}
                                </span>
                                <span className="text-[9px] text-slate-500 font-medium">
                                    {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                              
                              <div className="space-y-1">
                                {log.path !== "Extraction" && (
                                  <div className="text-[11px] text-slate-500 line-through opacity-75">
                                      "{log.original}"
                                  </div>
                                )}
                                <div className="flex items-start gap-1.5 text-xs text-slate-200 leading-relaxed font-light">
                                    <ArrowRight className="w-3.5 h-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
                                    <span>"{log.new}"</span>
                                </div>
                              </div>

                              <div className="mt-3 flex items-center justify-between pt-2.5 border-t border-white/5">
                                  <span className="text-[10px] text-slate-400 italic">
                                      {log.reason}
                                  </span>
                                  {log.path !== "Extraction" && (
                                      <button 
                                          onClick={() => handleUndoChange(log)}
                                          className="text-[10px] font-bold text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 px-2 py-1 rounded"
                                      >
                                          Undo
                                      </button>
                                  )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 4. Settings Tab */}
                {activeTab === 'settings' && (
                  <div className="space-y-5 text-left">
                    <div className="flex items-center gap-2 mb-2">
                      <ShieldCheck className="w-4.5 h-4.5 text-indigo-400" />
                      <h4 className="text-xs font-bold text-slate-400 tracking-wider uppercase font-display">Contact Info Retention</h4>
                    </div>
                    
                    <p className="text-xs text-slate-400 font-light leading-relaxed mb-4">Toggle which contact details are visible on your reformatted resume. Sensitive data is stripped securely when disabled.</p>

                    <div className="space-y-2.5">
                      <button
                        onClick={() => setRetainedFields(prev => ({ ...prev, location: !prev.location }))}
                        className={`w-full flex items-center justify-between p-3.5 rounded-xl border transition-all cursor-pointer ${
                          retainedFields.location
                            ? 'border-indigo-500/40 text-white bg-indigo-500/[0.06] shadow-[0_0_12px_rgba(99,102,241,0.08)]'
                            : 'border-white/[0.04] bg-[#070914] text-slate-400 hover:bg-white/[0.02]'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <MapPin className={`w-4 h-4 ${retainedFields.location ? 'text-indigo-400' : 'text-slate-500'}`} />
                          <span className="text-xs font-medium font-sans">Retain Location</span>
                        </div>
                        <span className={`w-2 h-2 rounded-full ${retainedFields.location ? 'bg-indigo-400 shadow-[0_0_6px_rgba(99,102,241,0.8)]' : 'bg-slate-700'}`} />
                      </button>
                      
                      <button
                        onClick={() => setRetainedFields(prev => ({ ...prev, phone: !prev.phone }))}
                        className={`w-full flex items-center justify-between p-3.5 rounded-xl border transition-all cursor-pointer ${
                          retainedFields.phone
                            ? 'border-indigo-500/40 text-white bg-indigo-500/[0.06] shadow-[0_0_12px_rgba(99,102,241,0.08)]'
                            : 'border-white/[0.04] bg-[#070914] text-slate-400 hover:bg-white/[0.02]'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <Phone className={`w-4 h-4 ${retainedFields.phone ? 'text-indigo-400' : 'text-slate-500'}`} />
                          <span className="text-xs font-medium font-sans">Retain Phone</span>
                        </div>
                        <span className={`w-2 h-2 rounded-full ${retainedFields.phone ? 'bg-indigo-400 shadow-[0_0_6px_rgba(99,102,241,0.8)]' : 'bg-slate-700'}`} />
                      </button>
                      
                      <button
                        onClick={() => setRetainedFields(prev => ({ ...prev, email: !prev.email }))}
                        className={`w-full flex items-center justify-between p-3.5 rounded-xl border transition-all cursor-pointer ${
                          retainedFields.email
                            ? 'border-indigo-500/40 text-white bg-indigo-500/[0.06] shadow-[0_0_12px_rgba(99,102,241,0.08)]'
                            : 'border-white/[0.04] bg-[#070914] text-slate-400 hover:bg-white/[0.02]'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <Mail className={`w-4 h-4 ${retainedFields.email ? 'text-indigo-400' : 'text-slate-500'}`} />
                          <span className="text-xs font-medium font-sans">Retain Email</span>
                        </div>
                        <span className={`w-2 h-2 rounded-full ${retainedFields.email ? 'bg-indigo-400 shadow-[0_0_6px_rgba(99,102,241,0.8)]' : 'bg-slate-700'}`} />
                      </button>
                    </div>
                  </div>
                )}

              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
};

export default ResumePreview;
