import React, { useState, useEffect } from "react";
import { ResumeData, GrammarIssue, ChangeLogItem, ResumeFormat } from "@/types";
import { Download, CheckCircle2, FileText, SpellCheck, Loader2, History, ArrowRight, LayoutTemplate, Undo2, ShieldCheck, Lock, AlertCircle, Sparkles, Check, X, Eye, EyeOff, MapPin, Phone, Mail, Unlock } from "lucide-react";
import { analyzeGrammar } from "@/services/geminiService";
import { generateResumePDF } from "@/services/pdfService";
import { generateResumeDoc } from "@/services/docxService";
import { saveAs } from "file-saver";
import GrammarHighlighter from "./GrammarHighlighter";
import get from "lodash/get";
import set from "lodash/set";
import { motion, AnimatePresence } from "framer-motion";
import { cleanBullet, groupBulletPoints, processDescription, processDescriptionWithIndices } from "@/utils/formatters";

interface ResumePreviewProps {
  data: ResumeData;
  onDownload: () => void;
  onReset: () => void;
  onUpdate: (data: ResumeData) => void;
  selectedFormat: ResumeFormat;
  usePro?: boolean;
  retainedFields: { location: boolean; phone: boolean; email: boolean };
  setRetainedFields: React.Dispatch<React.SetStateAction<{ location: boolean; phone: boolean; email: boolean }>>;
}

const ResumePreview: React.FC<ResumePreviewProps> = ({ 
  data, 
  onDownload, 
  onReset, 
  onUpdate, 
  selectedFormat, 
  usePro = false,
  retainedFields,
  setRetainedFields
}) => {
  console.log("ResumePreview mounting with data:", data);
  const [isChecking, setIsChecking] = useState(false);
  const [issues, setIssues] = useState<GrammarIssue[]>([]);

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
  
  // Note: setIssues([]) is NOT called here anymore. 
  // It will be reset naturally when ResumePreview remounts due to key={fileName} in App.tsx
  
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
            showContactInfo: false, // Only location
            jobLayout: 'modern' as const, // Date -> Company -> Title
            headingMarginTop: "11pt",
            headingMarginBottom: "11pt"
        };
    }
    // Default Classic
    return {
        fontFamily: "Calibri, sans-serif",
        fontSizeBody: "11pt", // Approx 14.7px
        fontSizeName: "14pt", // Approx 18.7px
        headingTransform: "uppercase" as const,
        headingBorder: "none",
        headingColor: "#000000",
        nameAlign: "center" as const,
        lineHeight: "1.2",
        marginBottom: "1rem",
        showContactInfo: false, // Only location for privacy
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
    cleaned = cleaned.replace(/[:\-–—_*\s~▪•·|]+$/, ""); // strip trailing colons, hyphens, en/em dashes, underscores, stars, spaces, bullets, pipes
    cleaned = cleaned.replace(/^[:\-–—_*\s~▪•·|]+/, "");  // strip leading colons, hyphens, en/em dashes, underscores, stars, spaces, bullets, pipes
    return `${cleaned}:`;
  };
  
  // Helper to shorten state names, capitalize city names, and retain just City, State
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

    // Strip ZIP codes (5 or 9 digit) anywhere first
    let cleanedLoc = loc.replace(/\b\d{5}(-\d{4})?\b/g, '').trim();

    const parts = cleanedLoc.split(',').map(p => p.trim()).filter(Boolean);
    if (parts.length >= 1) {
        // Capitalize City
        parts[0] = parts[0].split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
        
        if (parts.length >= 2) {
            // Shorten State if found in map
            const state = parts[1];
            const foundState = Object.keys(stateMap).find(s => s.toLowerCase() === state.toLowerCase());
            if (foundState) {
                parts[1] = stateMap[foundState];
            } else if (state.length > 2) {
                parts[1] = state.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
            } else {
                parts[1] = state.toUpperCase(); // Ensure 2-letter codes are uppercase
            }
        }
        return parts.slice(0, 2).join(', ');
    }
    
    return cleanedLoc;
  };

  // Helper to expand months for Modern format
  const formatModernDate = (dateStr: string) => {
      if (!dateStr) return "";
      
      const monthMap: { [key: string]: string } = {
          "Jan": "January", "Feb": "February", "Mar": "March", "Apr": "April",
          "May": "May", "Jun": "June", "Jul": "July", "Aug": "August",
          "Sep": "September", "Oct": "October", "Nov": "November", "Dec": "December",
          "Sept": "September"
      };

      // Replace all occurrences of 3-letter months with full names
      // We use a regex with word boundaries to avoid replacing parts of other words
      let formatted = dateStr;
      Object.keys(monthMap).forEach(short => {
          const regex = new RegExp(`\\b${short}\\b`, 'g');
          formatted = formatted.replace(regex, monthMap[short]);
      });
      
      return formatted;
  };

  const styleText = (text: string) => {
    if (selectedFormat === ResumeFormat.MODERN_EXECUTIVE) {
        return formatModernDate(text);
    }
    return text;
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
    // Create deep clone to avoid mutation
    const newData = JSON.parse(JSON.stringify(data));
    
    // Get current value at path
    const currentValue = get(newData, issue.path);
    
    if (typeof currentValue === 'string' && issue.errorText && issue.suggestions && issue.suggestions.length > 0) {
        const selectedSuggestion = issue.suggestions[0];
        
        // Robust replacement
        let newValue = currentValue;
        if (currentValue.includes(issue.errorText)) {
            newValue = currentValue.replace(issue.errorText, selectedSuggestion);
        } else if (issue.original === currentValue) {
            // If the AI's 'original' matches our current value exactly, trust the suggestion
            newValue = selectedSuggestion;
        } else {
            // Try a more flexible match (ignoring extra whitespace)
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
            onUpdate(newData);
        }
    }
    
    setIssues(prev => prev.filter(i => i.id !== issue.id));
  };

  const handleFixAll = () => {
    if (issues.length === 0) return;
    
    // Create deep clone to avoid mutation
    let newData = JSON.parse(JSON.stringify(data));
    const newLogs: ChangeLogItem[] = [];
    
    // Group issues by path to apply them sequentially to the same string
    const issuesByPath: Record<string, GrammarIssue[]> = {};
    issues.forEach(issue => {
        if (!issuesByPath[issue.path]) issuesByPath[issue.path] = [];
        issuesByPath[issue.path].push(issue);
    });

    Object.entries(issuesByPath).forEach(([path, pathIssues]) => {
        let currentValue = get(newData, path);
        if (typeof currentValue !== 'string') return;

        // Sort issues by their position in the string (reverse order to not break indices)
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
        onUpdate(newData);
    }
    setIssues([]);
  };

  const handleIgnoreIssue = (issue: GrammarIssue) => {
    setIssues(prev => prev.filter(i => i.id !== issue.id));
  };

  const handleUndoChange = (log: ChangeLogItem) => {
    // Only allow undo for Grammar changes
    if (log.path === "Extraction") return;

    const newData = JSON.parse(JSON.stringify(data));
    const currentValue = get(newData, log.path);

    if (typeof currentValue === 'string') {
        const newValue = currentValue.replace(log.new, log.original);
        set(newData, log.path, newValue);
        
        // Update data
        onUpdate(newData);
        
        // Remove from changeLog
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

  const calculateScore = () => {
    let score = 75; // Base score
    if (data.summary && data.summary.length > 0) score += 5;
    if (data.experience && data.experience.length > 2) score += 10;
    if (data.education && data.education.length > 0) score += 5;
    if (data.customSections && data.customSections.length > 0) score += 5;
    
    // Deduct for issues
    score -= issues.length * 2;
    
    return Math.min(100, Math.max(0, score));
  };

  const score = calculateScore();

  return (
    <div className="flex flex-col lg:flex-row gap-6 w-full h-full min-h-0 mx-auto">
      <style>{`
        #resume-preview-content ul li::marker {
          font-size: 13px;
        }
      `}</style>
      {/* Left Column: Resume Preview */}
      <div className="flex-1 min-w-0 font-sans flex flex-col h-full min-h-0">
        <div className="glassmorphic-card rounded-2xl p-5 flex flex-col h-full min-h-0 overflow-hidden">
            {/* Toolbar */}
            <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 mb-4 pb-4 border-b border-white/[0.06] flex-shrink-0">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center shadow-[0_0_15px_rgba(99,102,241,0.15)] shrink-0">
                        <FileText className="w-5 h-5 text-indigo-400" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-white tracking-tight font-display">
                            Resume Workspace
                        </h2>
                        <p className="text-xs text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 to-purple-300 tracking-wide font-bold uppercase">Format & Grammar Review</p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto justify-start xl:justify-end">
                    <button
                        onClick={onReset}
                        className="btn-2026-secondary px-5 h-10 text-xs font-bold uppercase tracking-wider rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5"
                    >
                        Reset
                    </button>
                    
                    <button
                        onClick={handleCheckGrammar}
                        disabled={isChecking}
                        className="btn-2026-primary px-5 h-10 text-xs font-bold uppercase tracking-wider rounded-xl flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                    >
                        {isChecking ? <Loader2 className="w-3.5 h-3.5 animate-spin relative z-10" /> : <Sparkles className="w-3.5 h-3.5 text-indigo-400 relative z-10" />}
                        <span className="relative z-10">Check Grammar</span>
                    </button>

                    <button
                        onClick={handleDownloadDOCX}
                        className="btn-2026-neon px-5 h-10 text-xs font-bold uppercase tracking-wider rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer"
                    >
                        <Download className="w-3.5 h-3.5" />
                        Download DOCX
                    </button>

                    <button
                        onClick={handleDownloadPDF}
                        className="btn-2026-secondary px-5 h-10 text-xs font-bold uppercase tracking-wider rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer"
                    >
                        <Download className="w-3.5 h-3.5" />
                        PDF
                    </button>
                </div>
            </div>

            {/* Resume Content */}
            <div 
              id="resume-preview-content"
              className="overflow-y-auto flex-1 custom-scrollbar" 
              style={{ 
                fontFamily: styles.fontFamily, 
                color: black, 
                backgroundColor: '#ffffff', // Explicit hex for html2canvas
                padding: '48px', /* 0.5 inch */
                borderRadius: '12px'
              }}
            >
              
              {/* 1. Name */}
              <div style={{ textAlign: styles.nameAlign, marginBottom: styles.marginBottom }}>
                <h1 style={{ fontWeight: 'bold', textTransform: 'uppercase', fontSize: styles.fontSizeName, color: styles.headingColor === "#000000" ? black : styles.headingColor, margin: 0 }}>
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
                      {/* Modern Executive: Render location if selected or default to standard location-only */}
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
                            // Modern Layout: Date -> Company -> Title
                            <>
                                {exp.dates && exp.dates !== "undefined" && (
                                  <div style={{ fontWeight: 'bold', fontSize: styles.fontSizeBody, color: black, marginBottom: '2px' }}>
                                      {formatModernDate(exp.dates)}
                                  </div>
                                )}
                                <div style={{ fontWeight: 'bold', fontSize: styles.fontSizeBody, color: black, marginBottom: '2px' }}>
                                    {exp.company}{exp.location ? `, ${formatLocation(exp.location)}` : ''}
                                </div>
                                <div style={{ fontWeight: 'bold', fontSize: styles.fontSizeBody, color: black, marginBottom: '4px' }}>
                                    {exp.title}
                                </div>
                            </>
                        ) : (
                            // Classic Layout: Company | Date -> Title
                            <>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                  <span style={{ fontWeight: 'bold', fontSize: styles.fontSizeBody, color: black }}>
                                    {exp.company}{exp.location ? `, ${formatLocation(exp.location)}` : ''}
                                  </span>
                                  {exp.dates && exp.dates !== "undefined" && (
                                    <span style={{ fontWeight: 'bold', textAlign: 'right', fontSize: styles.fontSizeBody, color: black }}>{exp.dates}</span>
                                  )}
                                </div>
                                <div style={{ fontWeight: 'bold', marginBottom: 0, fontSize: styles.fontSizeBody, color: black }}>
                                  {exp.title}
                                </div>
                            </>
                        )}
                        <ul style={{ listStyleType: 'disc', paddingLeft: '1.25rem', marginTop: 0 }}>
                          {exp.description && processDescriptionWithIndices(exp.description).map((bulletObj, bIdx) => (
                            <li key={bIdx} style={{ fontSize: styles.fontSizeBody, lineHeight: styles.lineHeight, marginBottom: '2px', paddingLeft: '2px' }}>
                                <GrammarHighlighter 
                                  text={bulletObj.text} 
                                  path={`experience.${idx}.description.${bulletObj.originalIndex}`} // Correct original index path mapping
                                  issues={issues} 
                                  onAccept={handleAcceptIssue} 
                                  onIgnore={handleIgnoreIssue} 
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
                            // Modern Layout
                            <>
                                {exp.dates && exp.dates !== "undefined" && (
                                  <div style={{ fontWeight: 'bold', fontSize: styles.fontSizeBody, color: black, marginBottom: '2px' }}>
                                      {formatModernDate(exp.dates)}
                                  </div>
                                )}
                                <div style={{ fontWeight: 'bold', fontSize: styles.fontSizeBody, color: black, marginBottom: '2px' }}>
                                    {exp.company}{exp.location ? `, ${formatLocation(exp.location)}` : ''}
                                </div>
                                <div style={{ fontWeight: 'bold', fontSize: styles.fontSizeBody, color: black, marginBottom: '4px' }}>
                                    {exp.title}
                                </div>
                            </>
                        ) : (
                            // Classic Layout
                            <>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                  <span style={{ fontWeight: 'bold', fontSize: styles.fontSizeBody, color: black }}>
                                    {exp.company}{exp.location ? `, ${formatLocation(exp.location)}` : ''}
                                  </span>
                                  {exp.dates && exp.dates !== "undefined" && (
                                    <span style={{ fontWeight: 'bold', textAlign: 'right', fontSize: styles.fontSizeBody, color: black }}>{exp.dates}</span>
                                  )}
                                </div>
                                <div style={{ fontWeight: 'bold', marginBottom: 0, fontSize: styles.fontSizeBody, color: black }}>
                                  {exp.title}
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
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                          <span style={{ fontWeight: 'bold', fontSize: styles.fontSizeBody, color: black }}>
                            {edu.institution}{edu.location ? `, ${formatLocation(edu.location)}` : ''}
                          </span>
                          {edu.dates && edu.dates !== "undefined" && (
                            <span style={{ fontWeight: 'bold', textAlign: 'right', fontSize: styles.fontSizeBody, color: black }}>{edu.dates}</span>
                          )}
                        </div>
                        <div style={{ fontWeight: 'bold', fontSize: styles.fontSizeBody, color: black }}>
                          {edu.degree}
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

      {/* Right Column: Change Log / Recruiter Dashboard */}
      <div className="w-full lg:w-80 flex-shrink-0 flex flex-col h-full min-h-0 space-y-4 overflow-hidden">
        
        {/* Contact Info Retention Selection Panel */}
        <motion.div 
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            className={`glassmorphic-card rounded-2xl p-4 border text-left relative z-10 transition-all duration-500 shadow-lg flex-shrink-0 ${
                retainedFields.location || retainedFields.phone || retainedFields.email
                    ? 'border-indigo-500/20 bg-slate-900/50 shadow-[0_0_15px_rgba(99,102,241,0.03)]'
                    : 'border-white/[0.05] bg-slate-900/40'
            }`}
        >
            <div className="flex items-center gap-2 mb-3 pb-1.5 border-b border-white/[0.04] flex-shrink-0">
                <ShieldCheck className={`w-4 h-4 transition-transform duration-500 ${retainedFields.location || retainedFields.phone || retainedFields.email ? 'text-indigo-400 rotate-12 scale-110' : 'text-slate-400'}`} />
                <h3 className="text-xs font-bold text-slate-200 tracking-wider uppercase font-display">Field Retention</h3>
            </div>

            <div className="grid grid-cols-3 gap-2">
                <button
                    onClick={() => setRetainedFields(prev => ({ ...prev, location: !prev.location }))}
                    className={`group/btn flex flex-col items-center justify-center py-3 px-1 rounded-xl border text-center transition-all duration-300 cursor-pointer select-none ${
                        retainedFields.location
                            ? 'border-indigo-500/40 text-white bg-indigo-500/[0.08] shadow-[0_0_12px_rgba(99,102,241,0.08)]'
                            : 'border-white/[0.04] bg-white/[0.01] text-slate-400 hover:text-white hover:bg-white/[0.04] hover:border-white/10'
                    }`}
                >
                    <MapPin className={`w-3.5 h-3.5 mb-1 transition-colors duration-300 ${retainedFields.location ? 'text-indigo-400' : 'text-slate-500 group-hover/btn:text-slate-300'}`} />
                    <span className="text-[10px] font-medium font-sans">Location</span>
                    <span className={`w-1.5 h-1.5 rounded-full mt-1.5 transition-all duration-300 ${retainedFields.location ? 'bg-indigo-400 shadow-[0_0_6px_rgba(99,102,241,0.8)] scale-110' : 'bg-slate-700 scale-90'}`} />
                </button>
                
                <button
                    onClick={() => setRetainedFields(prev => ({ ...prev, phone: !prev.phone }))}
                    className={`group/btn flex flex-col items-center justify-center py-3 px-1 rounded-xl border text-center transition-all duration-300 cursor-pointer select-none ${
                        retainedFields.phone
                            ? 'border-indigo-500/40 text-white bg-indigo-500/[0.08] shadow-[0_0_12px_rgba(99,102,241,0.08)]'
                            : 'border-white/[0.04] bg-white/[0.01] text-slate-400 hover:text-white hover:bg-white/[0.04] hover:border-white/10'
                    }`}
                >
                    <Phone className={`w-3.5 h-3.5 mb-1 transition-colors duration-300 ${retainedFields.phone ? 'text-indigo-400' : 'text-slate-500 group-hover/btn:text-slate-300'}`} />
                    <span className="text-[10px] font-medium font-sans">Phone</span>
                    <span className={`w-1.5 h-1.5 rounded-full mt-1.5 transition-all duration-300 ${retainedFields.phone ? 'bg-indigo-400 shadow-[0_0_6px_rgba(99,102,241,0.8)] scale-110' : 'bg-slate-700 scale-90'}`} />
                </button>
                
                <button
                    onClick={() => setRetainedFields(prev => ({ ...prev, email: !prev.email }))}
                    className={`group/btn flex flex-col items-center justify-center py-3 px-1 rounded-xl border text-center transition-all duration-300 cursor-pointer select-none ${
                        retainedFields.email
                            ? 'border-indigo-500/40 text-white bg-indigo-500/[0.08] shadow-[0_0_12px_rgba(99,102,241,0.08)]'
                            : 'border-white/[0.04] bg-white/[0.01] text-slate-400 hover:text-white hover:bg-white/[0.04] hover:border-white/10'
                    }`}
                >
                    <Mail className={`w-3.5 h-3.5 mb-1 transition-colors duration-300 ${retainedFields.email ? 'text-indigo-400' : 'text-slate-500 group-hover/btn:text-slate-300'}`} />
                    <span className="text-[10px] font-medium font-sans">Email</span>
                    <span className={`w-1.5 h-1.5 rounded-full mt-1.5 transition-all duration-300 ${retainedFields.email ? 'bg-indigo-400 shadow-[0_0_6px_rgba(99,102,241,0.8)] scale-110' : 'bg-slate-700 scale-90'}`} />
                </button>
            </div>
        </motion.div>
             {/* Grammar Issues Panel */}
        {issues.length > 0 && (
            <motion.div 
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                className="glassmorphic-card rounded-[24px] p-4 flex flex-col flex-1 min-h-0 overflow-hidden"
            >
                <div className="flex items-center justify-between mb-4 pb-2 border-b border-white/[0.06] flex-shrink-0">
                    <div className="flex items-center gap-2">
                        <AlertCircle className="w-4.5 h-4.5 text-rose-400" />
                        <h3 className="text-sm font-bold text-white tracking-tight">Parser Signals ({issues.length})</h3>
                    </div>
                    <button 
                        onClick={handleFixAll}
                        className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-300 hover:text-indigo-200 transition-all bg-indigo-500/15 px-3 py-1.5 rounded-lg border border-indigo-500/25 shadow-[0_0_15px_rgba(99,102,241,0.1)] cursor-pointer"
                    >
                        Fix All
                    </button>
                </div>
                <div className="space-y-2.5 overflow-y-auto flex-1 pr-1 custom-scrollbar">
                    {issues.map((issue) => (
                        <div 
                            key={issue.id} 
                            onClick={() => {
                                const el = document.getElementById(`issue-${issue.id}`);
                                if (el) {
                                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                    // Simulate click to open popover
                                    const spanEl = el.querySelector('span[style*="cursor: pointer"]');
                                    if (spanEl) {
                                        (spanEl as HTMLElement).click();
                                    }
                                }
                            }}
                            className="p-3 rounded-xl bg-white/[0.01] border border-white/[0.03] hover:border-white/[0.08] hover:bg-white/[0.03] transition-all group cursor-pointer"
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
            </motion.div>
        )}

        {/* Modification Log Panel */}
        {changeLog.length > 0 && (
            <motion.div 
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                className="glassmorphic-card rounded-[24px] p-4 flex flex-col flex-1 min-h-0 overflow-hidden"
            >
                <div className="flex items-center gap-2 mb-4 pb-2 border-b border-white/[0.06] flex-shrink-0">
                    <History className="w-4.5 h-4.5 text-indigo-400" />
                    <h3 className="text-sm font-bold text-white tracking-tight">Refiner Logs</h3>
                </div>

                <div className="space-y-3.5 overflow-y-auto flex-1 pr-1 custom-scrollbar">
                    {changeLog.map((log) => (
                        <div key={log.id} className="p-3.5 rounded-xl bg-white/[0.01] border border-white/[0.03] hover:border-white/[0.08] hover:bg-white/[0.02] transition-colors group">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-350 border border-indigo-500/5">
                                    {log.path.split('.').pop()}
                                </span>
                                <span className="text-[9px] text-slate-500 font-medium">
                                    {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                            </div>
                            
                            <div className="space-y-1.5">
                                <div className="text-[11px] text-slate-500 line-through opacity-70">
                                    "{log.original}"
                                </div>
                                <div className="flex items-start gap-1.5 text-xs text-slate-200 leading-relaxed font-light">
                                    <ArrowRight className="w-3.5 h-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
                                    <span>"{log.new}"</span>
                                </div>
                            </div>

                            <div className="mt-4 flex items-center justify-between pt-3 border-t border-white/5">
                                <span className="text-[10px] text-slate-400 italic">
                                    {log.reason}
                                </span>
                                {log.path !== "Extraction" && (
                                    <button 
                                        onClick={() => handleUndoChange(log)}
                                        className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-[10px] font-bold text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 px-2 py-1 rounded"
                                    >
                                        <Undo2 className="w-3 h-3" /> Undo
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </motion.div>
        )}
      </div>
    </div>
  );
};

export default ResumePreview;
