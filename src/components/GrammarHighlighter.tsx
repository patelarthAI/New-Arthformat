import React, { useState, useRef, useEffect } from 'react';
import { GrammarIssue } from '@/types';
import { Check, X, AlertCircle } from 'lucide-react';
import { rewritePhrase } from '../services/geminiService';

interface GrammarHighlighterProps {
  text: string;
  path: string;
  issues: GrammarIssue[];
  onAccept: (issue: GrammarIssue) => void;
  onIgnore: (issue: GrammarIssue) => void;
  style?: React.CSSProperties;
  className?: string;
  onEdit?: (newText: string) => void;
  onConfirmAI?: (title: string, description: string, cost: number, onConfirm: () => void) => void;
  activeIssueId?: string | null;
  setActiveIssueId?: (id: string | null) => void;
}

const GrammarHighlighter: React.FC<GrammarHighlighterProps> = ({ 
  text, 
  path, 
  issues, 
  onAccept, 
  onIgnore,
  style,
  className,
  onEdit,
  onConfirmAI,
  activeIssueId,
  setActiveIssueId
}) => {
  const [localActiveIssueId, setLocalActiveIssueId] = useState<string | null>(null);
  const isStateControlled = activeIssueId !== undefined && setActiveIssueId !== undefined;
  const currentActiveIssueId = isStateControlled ? activeIssueId : localActiveIssueId;
  const changeActiveIssueId = isStateControlled ? setActiveIssueId : setLocalActiveIssueId;

  const [popoverPosition, setPopoverPosition] = useState<'top' | 'bottom'>('bottom');
  const spanRef = useRef<HTMLSpanElement>(null);
  const [refineText, setRefineText] = useState<string>('');
  const [isRefining, setIsRefining] = useState<boolean>(false);
  const [activeIssueSuggestions, setActiveIssueSuggestions] = useState<Record<string, string[]>>({});

  useEffect(() => {
    setRefineText('');
    setIsRefining(false);
  }, [currentActiveIssueId]);

  // Handle clicking outside or Esc key to close suggestion popup
  useEffect(() => {
    if (!currentActiveIssueId) return;

    const handleDocumentClick = (e: MouseEvent) => {
      const triggerSpan = document.getElementById(`issue-${currentActiveIssueId}`);
      if (triggerSpan && triggerSpan.contains(e.target as Node)) {
        return;
      }
      changeActiveIssueId(null);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        changeActiveIssueId(null);
      }
    };

    document.addEventListener('mousedown', handleDocumentClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleDocumentClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [currentActiveIssueId, changeActiveIssueId]);

  const handleRefine = async (issue: any) => {
    if (!refineText.trim()) return;
    
    const runRefinement = async () => {
      setIsRefining(true);
      try {
        const newSuggestions = await rewritePhrase(issue.cleanErrorText, refineText);
        setActiveIssueSuggestions(prev => ({
          ...prev,
          [issue.id]: newSuggestions
        }));
        setRefineText('');
      } catch (err) {
        console.error("Refinement failed:", err);
        alert("Failed to refine phrase. Please try again.");
      } finally {
        setIsRefining(false);
      }
    };

    if (onConfirmAI) {
      onConfirmAI(
        "AI Custom Refine",
        `Refine the text "${issue.cleanErrorText}" with the custom instruction: "${refineText}" using Gemini.`,
        1,
        runRefinement
      );
    } else {
      await runRefinement();
    }
  };
  
  // Normalize path for comparison
  const normalizePath = (p: string) => p.replace(/\[(\d+)\]/g, '.$1');
  
  // Find ALL issues for this specific path
  const fieldIssues = issues.filter(i => normalizePath(i.path) === normalizePath(path));

  if (fieldIssues.length === 0) {
    return (
      <span 
        className={`${className || ""} editable-field-cue focus:outline-none px-1 rounded transition-colors duration-150`} 
        style={{ ...style, cursor: onEdit ? 'text' : 'inherit' }}
        contentEditable={!!onEdit}
        suppressContentEditableWarning
        onBlur={(e) => {
          if (onEdit) {
            onEdit(e.currentTarget.textContent || "");
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      >
        {text}
      </span>
    );
  }

  // Sort issues by their position in the text to render them in order
  const sortedIssues = [...fieldIssues]
    .map(issue => {
        let cleanErrorText = issue.errorText.replace(/^\s*([\u2022\u25E6\u2023\u25B8\u25AA\u25AB\-\*\u2013\u2014\u2043\u2219\u25C6\u27A2\uF0D8\u00B7]\s*)+/, '').trim();
        let index = text.indexOf(cleanErrorText);
        
        if (index === -1) {
            const lowerText = text.toLowerCase();
            const lowerError = cleanErrorText.toLowerCase();
            index = lowerText.indexOf(lowerError);
        }

        if (index === -1) {
            const strip = (s: string) => s.replace(/[^a-z0-9]/gi, '');
            const strippedText = strip(text);
            const strippedError = strip(cleanErrorText);
            const strippedIndex = strippedText.indexOf(strippedError);
            
            if (strippedIndex !== -1) {
                const firstWord = cleanErrorText.split(/\s+/)[0];
                if (firstWord) {
                    index = text.toLowerCase().indexOf(firstWord.toLowerCase());
                    if (index !== -1) {
                        cleanErrorText = text.substring(index, index + cleanErrorText.length);
                    }
                }
            }
        }

        return {
            ...issue,
            cleanErrorText,
            index
        };
    })
    .filter(issue => issue.index !== -1)
    .sort((a, b) => a.index - b.index);

  if (sortedIssues.length === 0) {
    return <span className={className} style={style}>{text}</span>;
  }

  const renderParts = () => {
    const result: React.ReactNode[] = [];
    let lastIndex = 0;

    sortedIssues.forEach((issue, idx) => {
      if (issue.index > lastIndex) {
        result.push(text.substring(lastIndex, issue.index));
      }

      const isSpelling = issue.type === 'SPELLING';
      const isStyle = issue.type === 'STYLE';
      const highlightColor = isSpelling ? '#f87171' : (isStyle ? '#c084fc' : '#4ade80'); 
      const bgColor = isSpelling ? 'rgba(239, 68, 68, 0.08)' : (isStyle ? 'rgba(139, 92, 246, 0.08)' : 'rgba(34, 197, 94, 0.08)');
      const iconColor = isSpelling ? '#f87171' : (isStyle ? '#c084fc' : '#4ade80');
      const label = isSpelling ? 'Spelling Error' : (isStyle ? 'Style Suggestion' : 'Grammar Correction');
      const animationClass = isSpelling ? 'highlight-spelling-active' : (isStyle ? 'highlight-style-active' : 'highlight-grammar-active');

      result.push(
        <span 
          key={issue.id} 
          id={`issue-${issue.id}`}
          className="relative inline-block" 
          style={{ zIndex: currentActiveIssueId === issue.id ? 50 : 1 }}
        >
          <span 
            ref={currentActiveIssueId === issue.id ? spanRef : null}
            className={`${animationClass} cursor-pointer rounded-[2px] px-0.5 transition-all duration-200`}
            style={{
              borderBottom: `2px solid ${highlightColor}`,
              backgroundColor: bgColor,
            }}
            onClick={(e) => {
                e.stopPropagation();
                if (currentActiveIssueId === issue.id) {
                    changeActiveIssueId(null);
                } else {
                    changeActiveIssueId(issue.id);
                    setTimeout(() => {
                        if (spanRef.current) {
                            const rect = spanRef.current.getBoundingClientRect();
                            const container = document.getElementById('resume-preview-content');
                            if (container) {
                                const containerRect = container.getBoundingClientRect();
                                const relativeTop = rect.top - containerRect.top;
                                if (relativeTop < 350) {
                                    setPopoverPosition('bottom');
                                } else {
                                    setPopoverPosition('top');
                                }
                            } else {
                                if (rect.top < 350) {
                                    setPopoverPosition('bottom');
                                } else {
                                    setPopoverPosition('top');
                                }
                            }
                        }
                    }, 10);
                }
            }}
          >
            {text.substring(issue.index, issue.index + issue.cleanErrorText.length)}
          </span>
          
          {currentActiveIssueId === issue.id && (
            <div 
              className={`absolute z-50 left-0 w-72 rounded-2xl shadow-2xl border p-4 text-sm font-sans backdrop-blur-xl animate-in fade-in zoom-in duration-250 ${
                popoverPosition === 'top' ? 'bottom-full mb-2.5' : 'top-full mt-2.5'
              }`}
              style={{
                backgroundColor: 'rgba(8, 12, 28, 0.94)',
                borderColor: 'rgba(255, 255, 255, 0.08)',
                color: '#f8fafc',
                textAlign: 'left',
                minWidth: '300px',
                boxShadow: '0 20px 50px -12px rgba(0,0,0,0.8), 0 0 15px rgba(99, 102, 241, 0.15)'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-2.5 mb-2">
                <AlertCircle className="w-4.5 h-4.5 mt-0.5 flex-shrink-0" style={{ color: iconColor }} />
                <div>
                   <div className="font-bold text-white text-xs uppercase tracking-wider">{label}</div>
                   <div className="text-xs mt-1 leading-relaxed text-slate-400">{issue.reason}</div>
                </div>
              </div>
              
              <div className="p-2.5 rounded-xl border mb-3" style={{ backgroundColor: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)' }}>
                 <div className="line-through text-xs mb-1 text-slate-500 font-medium">{issue.cleanErrorText}</div>
                 <div className="flex flex-col gap-1.5 mt-2">
                    {(activeIssueSuggestions[issue.id] || issue.suggestions).map((suggestion, sIdx) => (
                        <button
                            key={sIdx}
                            onClick={() => { onAccept({ ...issue, suggestions: [suggestion] }); changeActiveIssueId(null); }}
                            className={`text-left px-2.5 py-1.5 text-xs font-semibold rounded-lg transition-all border border-transparent cursor-pointer ${
                                isSpelling 
                                ? 'hover:bg-red-500/20 text-red-200 border-red-500/20 hover:border-red-500/40 hover:shadow-[0_0_8px_rgba(239,68,68,0.25)]' 
                                : (isStyle ? 'hover:bg-purple-500/20 text-purple-200 border-purple-500/20 hover:border-purple-500/40 hover:shadow-[0_0_8px_rgba(139,92,246,0.25)]' : 'hover:bg-emerald-500/20 text-emerald-200 border-emerald-500/20 hover:border-emerald-500/40 hover:shadow-[0_0_8px_rgba(34,197,94,0.25)]')
                            }`}
                        >
                            {suggestion}
                        </button>
                    ))}
                 </div>

                 {/* 1. Local Action Verb Swapper (0 Credits) */}
                 {isStyle && (
                   <div className="mt-3 pt-2.5 border-t border-white/5">
                     <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1.5">💡 Swap Action Verb (0 Credits)</div>
                     <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto custom-scrollbar">
                       {["Spearheaded", "Orchestrated", "Engineered", "Pioneered", "Synthesized", "Accelerated", "Architected", "Cultivated"].map(v => (
                         <button
                           key={v}
                           onClick={() => {
                             onAccept({ ...issue, suggestions: [v] });
                             changeActiveIssueId(null);
                           }}
                           className="px-2 py-0.5 text-[9px] bg-white/5 hover:bg-indigo-500/25 text-indigo-300 hover:text-white rounded border border-white/5 transition-colors cursor-pointer"
                         >
                           {v}
                         </button>
                       ))}
                     </div>
                   </div>
                 )}

                 {/* 2. Custom Refinement Input (1 Credit) */}
                 <div className="mt-3 pt-2.5 border-t border-white/5">
                   <div className="flex items-center justify-between mb-1.5">
                     <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">⚡ AI Custom Refine</span>
                     <span className="text-[9px] text-indigo-400/80 font-mono">1 AI Credit</span>
                   </div>
                   <div className="flex gap-1.5">
                     <input
                       type="text"
                       placeholder="E.g. 'make it sound more technical'..."
                       value={refineText}
                       onChange={(e) => setRefineText(e.target.value)}
                       onKeyDown={async (e) => {
                         if (e.key === 'Enter' && refineText.trim()) {
                           e.preventDefault();
                           await handleRefine(issue);
                         }
                       }}
                       disabled={isRefining}
                       className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2.5 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/50"
                     />
                     <button
                       onClick={() => handleRefine(issue)}
                       disabled={isRefining || !refineText.trim()}
                       className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg cursor-pointer transition-colors"
                     >
                       {isRefining ? '...' : 'Go'}
                     </button>
                   </div>
                 </div>
              </div>

              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => { onIgnore(issue); changeActiveIssueId(null); }}
                  className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider bg-white/5 hover:bg-white/10 rounded-lg border border-white/10 flex items-center gap-1.5 cursor-pointer text-slate-300 transition-colors"
                >
                  <X className="w-3.5 h-3.5" /> Ignore
                </button>
              </div>
              
              <div 
                className={`absolute left-4 w-2.5 h-2.5 border-b border-r transform ${
                  popoverPosition === 'top' ? 'top-full -mt-1.5 rotate-[45deg]' : 'bottom-full -mb-1.5 rotate-[225deg]'
                }`}
                style={{ backgroundColor: 'rgba(8, 12, 28, 0.94)', borderColor: 'rgba(255, 255, 255, 0.08)' }}
              ></div>
            </div>
          )}
        </span>
      );

      lastIndex = issue.index + issue.cleanErrorText.length;
    });

    if (lastIndex < text.length) {
      result.push(text.substring(lastIndex));
    }

    return result;
  };

  return (
    <span className={className} style={style}>
      {renderParts()}
    </span>
  );
};

export default GrammarHighlighter;
