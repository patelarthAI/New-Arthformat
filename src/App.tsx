import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AppState, ResumeData, ResumeFormat } from '@/types';
import { extractResumeData, getUsageStats } from '@/services/geminiService';
import { generateResumeDoc } from '@/services/docxService';
import ResumePreview from '@/components/ResumePreview';
import AdminDashboard from '@/components/AdminDashboard';
import { saveAs } from 'file-saver';
import { safeStorage } from '@/utils/safeStorage';
import { InteractiveLogo } from '@/components/InteractiveLogo';
import { 
  LayoutTemplate, 
  Database, 
  UploadCloud, 
  FileText, 
  AlertTriangle, 
  CheckCircle, 
  Sparkles, 
  ArrowRight,
  ShieldCheck,
  Clock,
  Lock,
  Eye,
  EyeOff,
  MapPin,
  Phone,
  Mail,
  Unlock
} from 'lucide-react';

interface StagedContent {
  text?: string;
  base64?: string;
  mimeType: string;
  fileName?: string;
}

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [fileName, setFileName] = useState<string>('');
  const [resumeData, setResumeData] = useState<ResumeData | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [dragActive, setDragActive] = useState<boolean>(false);
  const [selectedFormat, setSelectedFormat] = useState<ResumeFormat>(ResumeFormat.CLASSIC_PROFESSIONAL);
  const [retainedFields, setRetainedFields] = useState({
    location: false,
    phone: false,
    email: false,
  });
  const [usePro, setUsePro] = useState<boolean>(false);
  const [stats, setStats] = useState(getUsageStats(usePro));
  const [stagedContent, setStagedContent] = useState<StagedContent | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const [pendingResumeId, setPendingResumeId] = useState<string | null>(() => {
    return safeStorage.getItem('pendingResumeId');
  });
  const [backendStatus, setBackendStatus] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (pendingResumeId) {
      safeStorage.setItem('pendingResumeId', pendingResumeId);
    } else {
      safeStorage.removeItem('pendingResumeId');
    }
  }, [pendingResumeId]);

  useEffect(() => {
    fetch(`/api/health?_t=${Date.now()}`, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    })
      .then(res => res.json())
      .then(data => {
        console.log('Backend Health:', data);
        setBackendStatus(data);
      })
      .catch(err => {
        console.error('Backend Health Check Failed:', err);
        setBackendStatus({ status: 'error', message: err.message });
      });
  }, []);

  // Preload heavy document parsing libraries in the background to eliminate initial drag & drop latency
  useEffect(() => {
    const preloadParsers = async () => {
      try {
        console.log("[Optimization] Preloading mammoth and pdfjs-dist in the background...");
        
        // Asynchronously load mammoth
        const mammothPromise = import('mammoth').then(() => {
          console.log("[Optimization] Mammoth parser preloaded successfully.");
        }).catch(err => {
          console.warn("[Optimization] Failed to preload Mammoth:", err);
        });

        // Asynchronously load pdfjs-dist and its worker
        const pdfjsPromise = import('pdfjs-dist').then(async (pdfjsLib) => {
          try {
            const pdfWorker = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default;
            pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;
            console.log("[Optimization] PDFjs parser and worker preloaded successfully.");
          } catch (workerErr) {
            console.warn("[Optimization] Failed to preload PDFJS worker:", workerErr);
          }
        }).catch(err => {
          console.warn("[Optimization] Failed to preload PDFJS:", err);
        });

        await Promise.all([mammothPromise, pdfjsPromise]);
        console.log("[Optimization] Background parser preloading complete.");
      } catch (err) {
        console.warn("[Optimization] Parser preloading encountered an error:", err);
      }
    };

    // Use requestIdleCallback if available, otherwise fallback to setTimeout to avoid blocking main thread initialization
    if (typeof window !== 'undefined') {
      if ('requestIdleCallback' in window) {
        (window as any).requestIdleCallback(() => {
          preloadParsers();
        });
      } else {
        setTimeout(preloadParsers, 1000);
      }
    }
  }, []);

  // Poll for approval status
  useEffect(() => {
    let intervalId: NodeJS.Timeout;

    if (appState === AppState.WAITING_APPROVAL && pendingResumeId) {
      console.log("Polling for approval status for resume:", pendingResumeId);
      intervalId = setInterval(async () => {
        try {
          const res = await fetch(`/api/resumes/${pendingResumeId}/status?_t=${Date.now()}`, {
            headers: {
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              'Pragma': 'no-cache',
              'Expires': '0'
            }
          });
          if (res.ok) {
            const data = await res.json();
            console.log("Approval status response:", data);
            if (data.status === 'approved') {
              clearInterval(intervalId);
              // Restore content from backend if we lost it due to refresh
              if (!stagedContent && data.content) {
                setStagedContent(data.content);
              }
              processApprovedResume(data.content || stagedContent);
            } else if (data.status === 'rejected') {
              clearInterval(intervalId);
              if (data.content?.auto_rejected) {
                setErrorMsg("Your resume submission timed out (2 minutes) and was automatically rejected.");
              } else {
                setErrorMsg("Your resume submission was rejected by the administrator.");
              }
              setAppState(AppState.ERROR);
              setPendingResumeId(null);
            }
          }
        } catch (err) {
          console.error("Error checking resume status:", err);
        }
      }, 3000); // Check every 3 seconds
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [appState, pendingResumeId]);

  const processApprovedResume = async (contentToProcess: any = stagedContent) => {
    if (!contentToProcess) {
      console.warn("No content to process in processApprovedResume");
      return;
    }
    
    console.log("Processing approved resume content:", contentToProcess);
    setAppState(AppState.PROCESSING);
    try {
      const formattedData = await extractResumeData({
        text: contentToProcess.text,
        base64: contentToProcess.base64,
        mimeType: contentToProcess.mimeType,
        format: selectedFormat
      }, usePro);
      
      console.log("Extracted resume data successfully:", formattedData);
      setResumeData(formattedData);
      setAppState(AppState.REVIEW);
      setPendingResumeId(null); // Clear the pending ID once we start reviewing
    } catch (err: any) {
      console.error("Error during resume data extraction:", err);
      setErrorMsg(err.message);
      setAppState(AppState.ERROR);
      setPendingResumeId(null);
    }
  };

  // Handle file input (drag & drop or click)
  const handleFileChange = useCallback(async (file: File) => {
    if (!file) return;

    setFileName(file.name);
    setErrorMsg('');
    setAppState(AppState.STAGING);

    try {
      const fileNameLower = file.name.toLowerCase();

      // 1. DOCX Handling
      if (
        file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
        fileNameLower.endsWith('.docx')
      ) {
        const arrayBuffer = await file.arrayBuffer();
        const mammoth = await import('mammoth');
        const mammothInstance = (mammoth as any).default || mammoth;
        const result = await mammothInstance.extractRawText({ arrayBuffer });
        const text = result.value;
        if (!text || text.trim().length === 0) {
          throw new Error("Could not extract text from this Word document.");
        }
        setStagedContent({ text, mimeType: 'text/plain', fileName: file.name });
        return;
      }

      // 1.5. Legacy .doc Handling (Server-side)
      if (
        file.type === 'application/msword' || 
        fileNameLower.endsWith('.doc')
      ) {
        const base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.readAsDataURL(file);
          reader.onload = () => {
            const result = reader.result as string;
            const base64 = result.split(',')[1];
            resolve(base64);
          };
          reader.onerror = (error) => reject(error);
        });
        
        const response = await fetch('/api/extract-doc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileBase64: base64Data }),
        });

        if (!response.ok) {
          let errorMessage = "Failed to extract text from .doc file.";
          let responseText = "";
          try {
            responseText = await response.text();
            const errorData = JSON.parse(responseText);
            errorMessage = errorData.error || errorMessage;
          } catch (e: any) {
            if (response.status === 500) {
              errorMessage = `Server error (500) during .doc extraction: ${responseText || e.message}`;
            } else if (response.status === 413) {
              errorMessage = `File is too large for the server to process. Please convert it to .docx or .pdf and try again.`;
            } else {
              errorMessage = `Server error (${response.status}): ${responseText || e.message}`;
            }
          }
          throw new Error(errorMessage);
        }

        const { text } = await response.json();
        setStagedContent({ text, mimeType: 'text/plain', fileName: file.name });
        return;
      }

      // 2. Text / RTF / Markdown Handling
      if (
        file.type === 'text/plain' || 
        file.type === 'text/markdown' || 
        fileNameLower.endsWith('.txt') || 
        fileNameLower.endsWith('.md') ||
        fileNameLower.endsWith('.rtf')
      ) {
        const text = await file.text();
        setStagedContent({ text, mimeType: 'text/plain', fileName: file.name });
        return;
      }

      // 3. PDF Handling (Extract Text Client-Side)
      if (file.type === 'application/pdf' || fileNameLower.endsWith('.pdf')) {
        try {
          const arrayBuffer = await file.arrayBuffer();
          const pdfjsLib = await import('pdfjs-dist');
          const pdfWorker = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default;
          pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;
          
          const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
          let fullText = '';
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            
            let pageText = '';
            let lastY: number | null = null;
            let lastX: number | null = null;
            let lastWidth = 0;
            let lastHeight = 0;
            
            for (const item of textContent.items as any[]) {
              if (item.str === undefined) continue;
              
              const currentX = item.transform[4];
              const currentY = item.transform[5];
              const currentStr = item.str;
              const currentHeight = item.height || Math.abs(item.transform[3]) || 10;
              const currentWidth = item.width || 0;
              
              if (lastY === null) {
                pageText += currentStr;
              } else {
                const yDiff = Math.abs(currentY - lastY);
                // If Y coordinate has changed significantly, we are on a new line.
                // We use a threshold of 3 points or half the font height, whichever is larger.
                const isNewLine = yDiff > Math.max(3, currentHeight * 0.5);
                
                if (isNewLine) {
                  pageText += '\n' + currentStr;
                } else {
                  // Same line. Check if we should add a space.
                  const gap = currentX - (lastX! + lastWidth);
                  const spaceThreshold = Math.max(1.5, currentHeight * 0.15);
                  
                  if (gap > spaceThreshold && !pageText.endsWith(' ') && !currentStr.startsWith(' ')) {
                    pageText += ' ' + currentStr;
                  } else {
                    pageText += currentStr;
                  }
                }
              }
              
              lastX = currentX;
              lastY = currentY;
              lastWidth = currentWidth;
              lastHeight = currentHeight;
            }
            
            fullText += pageText + '\n';
          }
          
          if (!fullText.trim()) {
            throw new Error("Empty text");
          }
          
          setStagedContent({ text: fullText, mimeType: 'text/plain', fileName: file.name });
          return;
        } catch (pdfError: any) {
          console.warn("PDF Text Extraction Failed, falling back to base64:", pdfError);
          const base64 = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => {
              const result = reader.result as string;
              resolve(result.split(',')[1]);
            };
          });
          setStagedContent({ base64, mimeType: 'application/pdf', fileName: file.name });
          return;
        }
      }

      // 4. Image Handling (Compress and Base64)
      const validImageTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (validImageTypes.includes(file.type)) {
        const compressedBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.readAsDataURL(file);
          reader.onload = (e) => {
            const img = new Image();
            img.src = e.target?.result as string;
            img.onload = () => {
              const canvas = document.createElement('canvas');
              let width = img.width;
              let height = img.height;
              
              // Max dimension 1200px
              const MAX_DIM = 1200;
              if (width > height && width > MAX_DIM) {
                height *= MAX_DIM / width;
                width = MAX_DIM;
              } else if (height > MAX_DIM) {
                width *= MAX_DIM / height;
                height = MAX_DIM;
              }
              
              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext('2d');
              ctx?.drawImage(img, 0, 0, width, height);
              
              // Compress to JPEG with 0.7 quality
              const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
              resolve(dataUrl.split(',')[1]);
            };
            img.onerror = () => reject(new Error("Failed to load image for compression"));
          };
          reader.onerror = (error) => reject(error);
        });

        setStagedContent({ base64: compressedBase64, mimeType: 'image/jpeg', fileName: file.name });
        return;
      }

      throw new Error("Unsupported file format. Please upload DOCX, DOC, PDF, Text, or Image files.");

    } catch (err: any) {
      console.error("Extraction Error:", err);
      setErrorMsg(err.message || "Failed to process the resume.");
      setAppState(AppState.ERROR);
    }
  }, [selectedFormat, usePro]);

  const handleSubmitForApproval = async () => {
    if (!stagedContent) return;
    
    setAppState(AppState.PROCESSING);
    try {
      const response = await fetch('/api/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: stagedContent,
          userId: null
        }),
      });

      if (!response.ok) {
        let errorMessage = 'Failed to submit resume';
        let responseText = "";
        try {
          responseText = await response.text();
          const errorData = JSON.parse(responseText);
          errorMessage = errorData.error || errorMessage;
        } catch (e: any) {
          if (response.status === 500) {
            errorMessage = `Server processing error (500): ${responseText || e.message}`;
          } else if (response.status === 413) {
            errorMessage = `File is too large for the server to process. Please try a smaller file.`;
          } else {
            errorMessage = `Server error (${response.status}): ${responseText || e.message}`;
          }
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      if (data.resume && data.resume.id) {
        setPendingResumeId(data.resume.id);
      }
      
      setAppState(AppState.WAITING_APPROVAL);
    } catch (err: any) {
      setErrorMsg(err.message);
      setAppState(AppState.ERROR);
    }
  };

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const handleReset = () => {
    setAppState(AppState.IDLE);
    setResumeData(null);
    setFileName('');
    setErrorMsg('');
    setPendingResumeId(null);
    setStagedContent(null);
  };

  // Restore state on mount if there's a pending resume
  useEffect(() => {
    if (pendingResumeId && appState === AppState.IDLE) {
      setAppState(AppState.WAITING_APPROVAL);
    }
  }, []);

  return (
    <div className="bg-[#04060f] text-slate-200 font-sans selection:bg-indigo-500/30 overflow-x-hidden min-h-screen">
      {/* Ambient Background with slow-pulsing color rings */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="grid-bg-mesh" />
        <div className="absolute top-[-10%] left-[-10%] w-[70%] h-[70%] rounded-full bg-indigo-600/[0.08] blur-[150px] animate-pulse" style={{ animationDuration: '8s' }} />
        <div className="absolute bottom-[-10%] right-[-10%] w-[70%] h-[70%] rounded-full bg-purple-600/[0.08] blur-[150px] animate-pulse" style={{ animationDuration: '10s' }} />
        <div className="absolute top-[25%] left-[25%] w-[50%] h-[50%] rounded-full bg-violet-500/[0.05] blur-[130px] animate-pulse" style={{ animationDuration: '12s' }} />
      </div>

      <div className={`relative z-10 flex flex-col items-center w-full min-h-screen ${
        appState === AppState.REVIEW 
          ? 'w-full max-w-full px-0 pt-0 pb-0' 
          : 'px-4 sm:px-6 lg:px-[48px] max-w-[1280px] mx-auto pt-4 pb-8'
      }`}>
        {/* Header - Brand Bar */}
        {appState !== AppState.REVIEW && (
          <div className="w-full flex items-center justify-between mb-2 lg:mb-4">
            <div 
              onClick={() => setShowAdmin(!showAdmin)}
              className="flex items-center cursor-pointer select-none group focus:outline-none"
              title="Double-click or tap to toggle view mode securely"
            >
              <InteractiveLogo size="sm" />
            </div>

            <div className="flex items-center gap-3">
              {showAdmin && (
                <button
                  onClick={() => setShowAdmin(false)}
                  className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-xs font-semibold tracking-wide uppercase transition-all"
                >
                  Exit Workspace
                </button>
              )}
            </div>
          </div>
        )}

        {showAdmin ? (
          <AdminDashboard onClose={() => setShowAdmin(false)} />
        ) : (
          <>
            {appState !== AppState.REVIEW ? (
              <div className="main-hero-container w-full flex-1 flex flex-col justify-center items-center text-center gap-5 py-2">
                
                {/* Hero Text */}
                <motion.div 
                  initial={{ opacity: 0, y: -15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                  className="flex flex-col items-center text-center w-full mb-3"
                >
                  {/* Logo and Name on Same Line - Big & Hero */}
                  <div className="flex items-center justify-center gap-4 sm:gap-6 mb-4 select-none">
                    <div className="relative group transition-all duration-500 hover:scale-[1.03] active:scale-[0.98] flex-shrink-0">
                      {/* Glowing background aura */}
                      <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-indigo-500/20 via-purple-500/20 to-pink-500/20 blur-2xl opacity-80 pointer-events-none" />
                      <InteractiveLogo size="xl" />
                    </div>
                    
                    <h1 className="hero-title font-display text-4xl sm:text-5xl lg:text-6xl font-black text-white tracking-tight drop-shadow-[0_4px_16px_rgba(0,0,0,0.6)]">
                      Arth<span className="text-gradient-rainbow drop-shadow-[0_0_35px_rgba(168,85,247,0.35)]">Format</span> <span className="text-white drop-shadow-[0_0_20px_rgba(255,255,255,0.2)]">AI</span>
                    </h1>
                  </div>

                  {/* Subtitle - Resumes, Perfected */}
                  <h2 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-white mb-3 select-none drop-shadow-[0_2px_6px_rgba(0,0,0,0.4)]">
                    Resumes, <span className="text-gradient-rainbow font-black drop-shadow-[0_0_30px_rgba(168,85,247,0.25)]">Perfected.</span>
                  </h2>

                  {/* Tagline / Third Line */}
                  <p className="hero-tagline text-xs sm:text-sm lg:text-base text-slate-400 max-w-2xl mx-auto leading-relaxed drop-shadow-[0_2px_4px_rgba(0,0,0,0.3)] select-none">
                    Instantly transform your resume into a polished, professionally formatted document designed to impress hiring managers.
                  </p>
                </motion.div>

                {/* Upload / Combined Option selector Zone - Expanded Main Box */}
                <div className="w-full max-w-[1000px] z-10">
                  <AnimatePresence mode="wait">
                    {(appState === AppState.IDLE || appState === AppState.ERROR) && (
                      <motion.div 
                        key="upload-options"
                        initial={{ opacity: 0, scale: 0.98 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.98 }}
                        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                        className="glassmorphic-card hero-card-container rounded-[28px] p-6 lg:p-8 flex flex-col gap-6 text-left"
                      >
                        {/* Selector Row - Snug & Prominent */}
                        <div className="hero-card-selector-row grid grid-cols-1 md:grid-cols-3 gap-5 items-center pb-5 border-b border-white/[0.05]">
                          {/* Style Selector */}
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[11px] lg:text-[12px] font-extrabold text-slate-400 uppercase tracking-widest select-none flex items-center gap-1.5">
                              <LayoutTemplate className="w-3.5 h-3.5 text-indigo-400" />
                              1. Target Template Style
                            </span>
                            <div className="relative flex p-1 bg-white/[0.01] border border-white/[0.05] hover:border-white/10 rounded-xl h-[44px] transition-colors duration-300">
                              {/* Sliding Background */}
                              <div 
                                className={`absolute top-1 bottom-1 transition-all duration-300 ease-out bg-indigo-500/15 border border-indigo-500/40 rounded-lg shadow-[0_0_12px_rgba(99,102,241,0.25)] ${
                                  selectedFormat === ResumeFormat.CLASSIC_PROFESSIONAL 
                                    ? 'left-1 w-[calc(50%-4px)]' 
                                    : 'left-[50%] w-[calc(50%-4px)]'
                                }`}
                              />
                              
                              <button 
                                onClick={() => setSelectedFormat(ResumeFormat.CLASSIC_PROFESSIONAL)}
                                className={`relative z-10 flex-1 py-1 text-[12px] font-bold rounded-lg flex items-center justify-center gap-1.5 transition-colors duration-300 cursor-pointer ${
                                  selectedFormat === ResumeFormat.CLASSIC_PROFESSIONAL ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                                }`}
                              >
                                <LayoutTemplate className="w-3.5 h-3.5 text-indigo-400" />
                                <span className="font-display">Classic</span>
                              </button>
                              
                              <button 
                                onClick={() => setSelectedFormat(ResumeFormat.MODERN_EXECUTIVE)}
                                className={`relative z-10 flex-1 py-1 text-[12px] font-bold rounded-lg flex items-center justify-center gap-1.5 transition-colors duration-300 cursor-pointer ${
                                  selectedFormat === ResumeFormat.MODERN_EXECUTIVE ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                                }`}
                              >
                                <Sparkles className="w-3.5 h-3.5 text-pink-400" />
                                <span className="font-display">Modern</span>
                              </button>
                            </div>
                          </div>

                          {/* AI Engine Selector */}
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[11px] lg:text-[12px] font-extrabold text-slate-400 uppercase tracking-widest select-none flex items-center gap-1.5">
                              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                              2. AI Engine
                            </span>
                            <div className="relative flex p-1 bg-white/[0.01] border border-white/[0.05] hover:border-white/10 rounded-xl h-[44px] cursor-pointer transition-colors duration-300" onClick={() => setUsePro(!usePro)}>
                              {/* Sliding Background */}
                              <div 
                                className={`absolute top-1 bottom-1 transition-all duration-300 ease-out rounded-lg ${
                                  usePro 
                                    ? 'left-[50%] w-[calc(50%-4px)] bg-amber-500/15 border border-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.25)]' 
                                    : 'left-1 w-[calc(50%-4px)] bg-indigo-500/15 border border-indigo-500/40 shadow-[0_0_12px_rgba(99,102,241,0.25)]'
                                }`}
                              />
                              
                              <button 
                                type="button"
                                className={`relative z-10 flex-1 text-[11px] font-bold uppercase rounded-lg flex items-center justify-center gap-1.5 transition-colors duration-300 ${
                                  !usePro ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                                }`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${!usePro ? 'bg-indigo-400 animate-pulse' : 'bg-slate-500'}`} />
                                <span className="font-display">Standard</span>
                              </button>
                              
                              <button 
                                type="button"
                                className={`relative z-10 flex-1 text-[11px] font-bold uppercase rounded-lg flex items-center justify-center gap-1.5 transition-colors duration-300 ${
                                  usePro ? 'text-amber-200' : 'text-slate-400 hover:text-slate-200'
                                }`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${usePro ? 'bg-amber-400 animate-pulse' : 'bg-slate-500'}`} />
                                <span className="font-display">Pro</span>
                              </button>
                            </div>
                          </div>

                          {/* Data Shield Selector */}
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[11px] lg:text-[12px] font-extrabold text-slate-400 uppercase tracking-widest select-none flex items-center gap-1.5">
                              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                              3. Data Shield
                            </span>
                            <div className="relative flex p-1 bg-white/[0.01] border border-white/[0.05] hover:border-white/10 rounded-xl h-[44px] transition-colors duration-300 w-full gap-1">
                              <button
                                onClick={() => setRetainedFields(prev => ({ ...prev, location: !prev.location }))}
                                className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all duration-300 cursor-pointer select-none ${
                                  retainedFields.location
                                    ? 'bg-indigo-500/15 border border-indigo-500/40 text-white shadow-[0_0_12px_rgba(99,102,241,0.25)]'
                                    : 'text-slate-400 hover:text-white hover:bg-white/[0.02]'
                                }`}
                                title="Retain Location"
                              >
                                <MapPin className={`w-3.5 h-3.5 flex-shrink-0 ${retainedFields.location ? 'text-indigo-400' : 'text-slate-500'}`} />
                                <span>Location</span>
                              </button>
                              
                              <button
                                onClick={() => setRetainedFields(prev => ({ ...prev, phone: !prev.phone }))}
                                className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all duration-300 cursor-pointer select-none ${
                                  retainedFields.phone
                                    ? 'bg-indigo-500/15 border border-indigo-500/40 text-white shadow-[0_0_12px_rgba(99,102,241,0.25)]'
                                    : 'text-slate-400 hover:text-white hover:bg-white/[0.02]'
                                }`}
                                title="Retain Phone"
                              >
                                <Phone className={`w-3.5 h-3.5 flex-shrink-0 ${retainedFields.phone ? 'text-indigo-400' : 'text-slate-500'}`} />
                                <span>Phone</span>
                              </button>

                              <button
                                onClick={() => setRetainedFields(prev => ({ ...prev, email: !prev.email }))}
                                className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all duration-300 cursor-pointer select-none ${
                                  retainedFields.email
                                    ? 'bg-indigo-500/15 border border-indigo-500/40 text-white shadow-[0_0_12px_rgba(99,102,241,0.25)]'
                                    : 'text-slate-400 hover:text-white hover:bg-white/[0.02]'
                                }`}
                                title="Retain Email"
                              >
                                <Mail className={`w-3.5 h-3.5 flex-shrink-0 ${retainedFields.email ? 'text-indigo-400' : 'text-slate-500'}`} />
                                <span>Email</span>
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Drag and Drop box - Expanded Sizing */}
                        <div 
                          className={`
                            hero-dropzone-container relative overflow-hidden rounded-[24px] p-6 lg:p-10
                            flex flex-col items-center justify-center text-center border min-h-[220px] lg:min-h-[260px] cursor-pointer transition-all duration-350 group/dropzone
                            \${dragActive 
                              ? 'border-indigo-500 bg-indigo-500/[0.05] shadow-[0_0_35px_rgba(168,85,247,0.25)] scale-[1.02] border-solid' 
                              : ''
                            }
                          `}
                          onDragEnter={onDragEnter}
                          onDragLeave={onDragLeave}
                          onDragOver={onDragOver}
                          onDrop={onDrop}
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <input
                            ref={fileInputRef}
                            type="file"
                            className="hidden"
                            onChange={(e) => e.target.files && handleFileChange(e.target.files[0])}
                            accept=".pdf,.docx,.txt,.rtf,.png,.jpg,.jpeg,.webp"
                          />
                          
                          {/* Glowing dynamic background flare with color transition */}
                          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-pink-500/10 rounded-full blur-[80px] pointer-events-none -z-10 group-hover/dropzone:scale-110 transition-all duration-500 animate-[slow-spin_20s_linear_infinite]" />
                          
                          <div className="w-full flex flex-col items-center justify-center flex-1 py-6 z-10 pointer-events-none">
                            <div className="hero-dropzone-icon-container mb-3.5 relative">
                              {/* Pulsing ring halo */}
                              <div className="absolute inset-0 rounded-2xl bg-indigo-500/15 blur-md scale-125 opacity-0 group-hover/dropzone:opacity-100 transition-opacity duration-500" />
                              <div className="relative w-14 h-14 rounded-2xl bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 bg-[length:200%_auto] animate-[gradient-flow_4s_linear_infinite] p-[1.5px] shadow-lg shadow-indigo-500/15 group-hover/dropzone:scale-110 transition-transform duration-350">
                                <div className="w-full h-full rounded-2xl bg-[#080d24]/90 backdrop-blur-md flex items-center justify-center">
                                  <UploadCloud className="w-6 h-6 text-indigo-400 group-hover/dropzone:text-pink-400 group-hover/dropzone:-translate-y-0.5 transition-all duration-300" />
                                </div>
                              </div>
                            </div>
                            
                            <h3 className="text-xl sm:text-2xl font-extrabold text-white mb-5.5 tracking-tight font-display select-none">
                              Drop your resume here
                            </h3>
                            
                            <div className="relative overflow-hidden bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 bg-[length:200%_auto] animate-[gradient-flow_4s_linear_infinite] px-8 py-3.5 rounded-xl shadow-[0_6px_20px_rgba(99,102,241,0.4),0_0_15px_rgba(236,72,153,0.3)] hover:shadow-[0_10px_30px_rgba(99,102,241,0.6),0_0_25px_rgba(236,72,153,0.5)] text-[10.5px] font-extrabold tracking-widest uppercase text-white flex items-center gap-2 group-hover/dropzone:scale-[1.04] hover:scale-[1.06] transition-all duration-300 border border-white/20 select-none cursor-pointer mb-3.5">
                              <span>Browse Files</span>
                              <ArrowRight className="w-3.5 h-3.5 text-white group-hover/dropzone:translate-x-0.5 transition-transform duration-300" />
                            </div>
                            
                            <p className="text-slate-500 font-bold tracking-[0.2em] text-[9.5px] sm:text-[10px] uppercase mt-2.5 select-none">
                              PDF &bull; DOCX &bull; DOC &bull; Images
                            </p>
                          </div>
                        </div>

                        {errorMsg && (
                          <motion.div 
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex flex-col gap-2.5 backdrop-blur-md"
                          >
                            <div className="flex items-start gap-2 text-left">
                              <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                              <div className="flex flex-col gap-0.5">
                                <h4 className="font-bold text-red-200 text-[10px] uppercase tracking-wider">Processing Issue</h4>
                                <p className="text-[11px] text-red-100/80 leading-relaxed">{errorMsg}</p>
                              </div>
                            </div>
                            <div className="flex justify-end">
                              <button 
                                onClick={handleReset}
                                className="px-3 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-200 text-[9px] font-bold uppercase tracking-widest rounded-md transition-colors border border-red-500/30"
                              >
                                Try Another File
                              </button>
                            </div>
                          </motion.div>
                        )}
                      </motion.div>
                    )}

                    {appState === AppState.STAGING && (
                      <motion.div 
                        key="staging"
                        initial={{ opacity: 0, scale: 0.96 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.96 }}
                        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                        className="glassmorphic-card rounded-[24px] p-8 lg:p-10 flex flex-col items-center justify-center text-center w-full min-h-[220px] lg:min-h-[260px]"
                      >
                        <div className="w-full max-w-[600px] mx-auto flex flex-col items-center justify-center flex-1 py-2">
                          <div className="w-14 h-14 bg-emerald-500/10 rounded-xl flex items-center justify-center mb-5 border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.15)]">
                            <CheckCircle className="w-7 h-7 text-emerald-400" />
                          </div>
                          <h2 className="text-xl font-bold text-white mb-2 font-display">File Successfully Loaded</h2>
                          <p className="text-slate-400 mb-6 text-xs leading-relaxed max-w-sm">
                            We've successfully staged <span className="text-indigo-400 font-mono font-medium">"{fileName}"</span>. Ready to extract and reformat with absolute style representation.
                          </p>
                          
                          <div className="flex gap-3 w-full justify-center">
                            <button 
                              onClick={handleReset}
                              className="btn-2026-secondary px-5 py-3 text-[10px] font-bold uppercase tracking-wider rounded-xl transition-all cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button 
                              onClick={handleSubmitForApproval}
                              className="btn-2026-neon px-6 py-3 text-white font-bold text-[10px] uppercase tracking-wider rounded-xl shadow-lg transition-all flex items-center gap-1.5 cursor-pointer"
                            >
                              <ArrowRight className="w-3.5 h-3.5" />
                              Format Resume
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}

                    {appState === AppState.WAITING_APPROVAL && (
                      <motion.div 
                        key="waiting"
                        initial={{ opacity: 0, scale: 0.96 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.96 }}
                        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                        className="glassmorphic-card rounded-[24px] p-8 lg:p-10 flex flex-col items-center justify-center text-center w-full min-h-[220px] lg:min-h-[260px]"
                      >
                        <div className="w-full max-w-[600px] mx-auto flex flex-col items-center justify-center flex-1 py-2">
                          <div className="w-14 h-14 bg-amber-500/10 rounded-xl flex items-center justify-center mb-5 border border-amber-500/25 shadow-[0_0_15px_rgba(245,158,11,0.15)]">
                            <Clock className="w-7 h-7 text-amber-400" />
                          </div>
                          <h2 className="text-xl font-bold text-white mb-2 font-display">Awaiting Authorization</h2>
                          <p className="text-slate-400 mb-6 text-xs leading-relaxed max-w-sm">
                            Your formatted resume is staged and pending an administrator review. The processing will trigger instantly after confirmation.
                            <br /><br />
                            <span className="text-amber-400/90 text-[10px] font-bold uppercase tracking-wider bg-amber-500/[0.06] px-3.5 py-2 rounded-full border border-amber-500/20 inline-block">Please keep this browser window open</span>
                          </p>
                          <button 
                            onClick={handleReset}
                            className="btn-2026-secondary px-5 py-3 text-[10px] font-bold uppercase tracking-wider rounded-xl transition-all cursor-pointer"
                          >
                            Submit Alternative File
                          </button>
                        </div>
                      </motion.div>
                    )}

                    {appState === AppState.PROCESSING && (
                      <motion.div 
                        key="processing"
                        initial={{ opacity: 0, scale: 0.96 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.96 }}
                        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                        className="glassmorphic-card rounded-[24px] p-[36px] lg:p-[44px] flex flex-col items-center justify-center text-center min-h-[220px] lg:min-h-[260px] w-full"
                      >
                        <div className="w-full max-w-[600px] mx-auto flex flex-col items-center justify-center flex-1 py-2">
                          <div className="relative mb-6">
                             <div className="w-20 h-20 border-4 border-indigo-500/20 border-t-indigo-500 border-r-pink-500 rounded-full animate-spin"></div>
                             <div className="absolute inset-0 flex items-center justify-center">
                               <FileText className="w-7 h-7 text-indigo-400" />
                             </div>
                          </div>
                          <h2 className="text-xl font-bold text-white mb-2 font-display">Reformatting Document</h2>
                          <p className="text-slate-400/90 max-w-xs font-light text-xs animate-pulse leading-relaxed mx-auto mt-2">
                            Analyzing structure, adjusting typography, and optimizing spacing for modern elite layout. Just a moment...
                          </p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

              </div>
            ) : resumeData ? (
              <motion.div 
                key="review"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="lg:h-full w-full flex flex-col lg:min-h-0"
              >
                <ResumePreview 
                  key={fileName}
                  data={resumeData} 
                  onDownload={() => {}} 
                  onReset={handleReset} 
                  onUpdate={setResumeData}
                  selectedFormat={selectedFormat}
                  usePro={usePro}
                  retainedFields={retainedFields}
                  setRetainedFields={setRetainedFields}
                  originalText={stagedContent?.text}
                />
              </motion.div>
            ) : null}

            {/* Footer */}
            {appState !== AppState.REVIEW && (
              <footer className="w-full max-w-6xl mt-4 lg:mt-6 pt-4 border-t border-white/5">
                <div className="flex items-center justify-between gap-4 text-slate-500 text-xs">
                  <p className="font-light tracking-wide">© 2026 <span className="font-medium text-slate-400">ArthFormat</span> • Resumes Reimagined</p>
                  <div className="flex items-center gap-4">
                    <button 
                      onClick={() => setShowAdmin(!showAdmin)}
                      className="opacity-25 hover:opacity-100 transition-opacity p-1 text-slate-400"
                      title="System Console"
                    >
                      <Lock className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </footer>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default App;
