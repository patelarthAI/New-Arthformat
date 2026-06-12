import React, { useState, useCallback, useEffect } from 'react';
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
            const pageText = textContent.items.map((item: any) => item.str).join(' ');
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
    <div className="bg-[#04060f] text-slate-200 font-sans selection:bg-indigo-500/30 overflow-x-hidden min-h-screen lg:h-screen lg:overflow-hidden">
      {/* Ambient Background with slow-pulsing color rings */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[70%] h-[70%] rounded-full bg-indigo-600/[0.08] blur-[150px] animate-pulse" style={{ animationDuration: '8s' }} />
        <div className="absolute bottom-[-10%] right-[-10%] w-[70%] h-[70%] rounded-full bg-purple-600/[0.08] blur-[150px] animate-pulse" style={{ animationDuration: '10s' }} />
        <div className="absolute top-[25%] left-[25%] w-[50%] h-[50%] rounded-full bg-violet-500/[0.05] blur-[130px] animate-pulse" style={{ animationDuration: '12s' }} />
      </div>

      <div className="relative z-10 flex flex-col items-center px-4 sm:px-6 lg:px-8 w-full py-4 lg:py-6 lg:h-full lg:overflow-hidden min-h-screen">
        {/* Header - Brand Bar */}
        <div className="w-full max-w-7xl flex items-center justify-between mb-4 lg:mb-6">
          <div 
            onClick={() => setShowAdmin(!showAdmin)}
            className="flex items-center gap-3 cursor-pointer select-none group focus:outline-none"
            title="Double-click or tap to toggle view mode securely"
          >
            <InteractiveLogo size="sm" />
            <span className="text-xl font-bold tracking-tight text-white hidden sm:inline-block">
              Arth<span className="text-gradient-rainbow font-extrabold">Format</span>
            </span>
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

        {showAdmin ? (
          <AdminDashboard />
        ) : (
          <>
            {appState !== AppState.REVIEW ? (
              <div className="w-full max-w-6xl flex-1 flex flex-col justify-center py-2 lg:py-4">
                <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-12 items-center">
                  
                  {/* Left Column: Title and Configurations */}
                  <div className="lg:col-span-5 flex flex-col items-center lg:items-start text-center lg:text-left gap-4 lg:gap-6">
                    <motion.div 
                      initial={{ opacity: 0, y: -20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                      className="flex flex-col items-center lg:items-start"
                    >
                      {/* Premium AI Tech Badge */}
                      <div className="mb-4 flex items-center gap-2 px-3 py-1 rounded-full border border-indigo-500/20 bg-indigo-500/[0.05] text-[10px] font-bold text-indigo-300 uppercase tracking-widest shadow-[0_0_15px_rgba(99,102,241,0.1)]">
                        <Sparkles className="w-3 h-3 text-indigo-400 animate-pulse" />
                        AI-Powered Precision Formatter
                      </div>
                      
                      <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight mb-4 text-white leading-none">
                        Arth<span className="text-gradient-rainbow font-extrabold">Format</span> <span className="text-white">AI</span>
                      </h1>
                      
                      <p className="text-sm sm:text-base text-slate-400 font-light tracking-wide leading-relaxed max-w-sm">
                        Resumes Reimagined, Precision Personified. Instantly scan, format, and align your resume to modern executive standards.
                      </p>
                    </motion.div>

                    {/* Format Selection (Only shown when not processing or staged) */}
                    {appState === AppState.IDLE && (
                      <motion.div 
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2, duration: 0.6 }}
                        className="w-full max-w-md bg-white/[0.02] border border-white/[0.05] rounded-3xl p-5 backdrop-blur-2xl shadow-[0_30px_60px_-15px_rgba(0,0,0,0.8)] flex flex-col gap-5"
                      >
                        {/* Style Selector */}
                        <div className="flex flex-col gap-2.5">
                          <span className="text-xs font-bold text-slate-400 uppercase tracking-widest text-left">
                            1. Target Template Style
                          </span>
                          <div className="relative flex p-1 bg-white/[0.02] border border-white/[0.06] rounded-xl">
                            {/* Sliding Background */}
                            <div 
                              className={`absolute top-1 bottom-1 transition-all duration-300 ease-out bg-indigo-500/10 border border-indigo-500/30 rounded-lg shadow-[0_0_12px_rgba(99,102,241,0.15)] ${
                                selectedFormat === ResumeFormat.CLASSIC_PROFESSIONAL 
                                  ? 'left-1 w-[calc(50%-4px)]' 
                                  : 'left-[50%] w-[calc(50%-4px)]'
                              }`}
                            />
                            
                            <button 
                              onClick={() => setSelectedFormat(ResumeFormat.CLASSIC_PROFESSIONAL)}
                              className={`relative z-10 flex-1 py-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-2 transition-colors duration-300 cursor-pointer ${
                                selectedFormat === ResumeFormat.CLASSIC_PROFESSIONAL ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              <LayoutTemplate className="w-3.5 h-3.5" />
                              <span className="font-display">Classic Professional</span>
                            </button>
                            
                            <button 
                              onClick={() => setSelectedFormat(ResumeFormat.MODERN_EXECUTIVE)}
                              className={`relative z-10 flex-1 py-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-2 transition-colors duration-300 cursor-pointer ${
                                selectedFormat === ResumeFormat.MODERN_EXECUTIVE ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              <Sparkles className="w-3.5 h-3.5" />
                              <span className="font-display">Modern Executive</span>
                            </button>
                          </div>
                        </div>

                        {/* Divider */}
                        <div className="h-[1px] bg-white/[0.06]" />

                        {/* Engine and Retention Row */}
                        <div className="grid grid-cols-2 gap-4">
                          {/* Engine Selector */}
                          <div className="flex flex-col gap-2">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-left">
                              2. AI Engine
                            </span>
                            <button
                              onClick={() => setUsePro(!usePro)}
                              className={`relative w-full py-2.5 px-3 border rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all duration-500 cursor-pointer overflow-hidden text-center flex items-center justify-center gap-1.5 ${
                                usePro 
                                  ? 'bg-amber-500/[0.08] border-amber-500/40 text-amber-200 shadow-[0_0_12px_rgba(245,158,11,0.15)] font-semibold' 
                                  : 'bg-white/[0.01] border-white/[0.06] text-slate-400 hover:text-white hover:bg-white/[0.04]'
                              }`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${usePro ? 'bg-amber-400 animate-pulse' : 'bg-slate-500'}`} />
                              <span>{usePro ? "Pro Active" : "Standard"}</span>
                            </button>
                          </div>

                          {/* Retention Selector */}
                          <div className="flex flex-col gap-2">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-left">
                              3. Data Shield
                            </span>
                            <div className="flex gap-1.5 w-full">
                              <button
                                onClick={() => setRetainedFields(prev => ({ ...prev, location: !prev.location }))}
                                className={`flex-1 flex items-center justify-center gap-1 py-2 px-1.5 rounded-xl border text-[9px] transition-all duration-300 cursor-pointer select-none ${
                                  retainedFields.location
                                    ? 'border-indigo-500/40 text-white bg-indigo-500/10 shadow-[0_0_8px_rgba(99,102,241,0.08)] font-semibold'
                                    : 'border-white/[0.04] bg-white/[0.01] text-slate-400 hover:text-white hover:border-white/10'
                                }`}
                                title="Retain Location"
                              >
                                <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                                <span>Loc</span>
                              </button>
                              
                              <button
                                onClick={() => setRetainedFields(prev => ({ ...prev, phone: !prev.phone }))}
                                className={`flex-1 flex items-center justify-center gap-1 py-2 px-1.5 rounded-xl border text-[9px] transition-all duration-300 cursor-pointer select-none ${
                                  retainedFields.phone
                                    ? 'border-indigo-500/40 text-white bg-indigo-500/10 shadow-[0_0_8px_rgba(99,102,241,0.08)] font-semibold'
                                    : 'border-white/[0.04] bg-white/[0.01] text-slate-400 hover:text-white hover:border-white/10'
                                }`}
                                title="Retain Phone"
                              >
                                <Phone className="w-3.5 h-3.5 flex-shrink-0" />
                                <span>Phone</span>
                              </button>

                              <button
                                onClick={() => setRetainedFields(prev => ({ ...prev, email: !prev.email }))}
                                className={`flex-1 flex items-center justify-center gap-1 py-2 px-1.5 rounded-xl border text-[9px] transition-all duration-300 cursor-pointer select-none ${
                                  retainedFields.email
                                    ? 'border-indigo-500/40 text-white bg-indigo-500/10 shadow-[0_0_8px_rgba(99,102,241,0.08)] font-semibold'
                                    : 'border-white/[0.04] bg-white/[0.01] text-slate-400 hover:text-white hover:border-white/10'
                                }`}
                                title="Retain Email"
                              >
                                <Mail className="w-3.5 h-3.5 flex-shrink-0" />
                                <span>Email</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </div>

                  {/* Right Column: Interactive Upload / Processing Card */}
                  <div className="lg:col-span-7 w-full flex flex-col justify-center">
                    <div className="w-full max-w-xl mx-auto">
                      <AnimatePresence mode="wait">
                        {(appState === AppState.IDLE || appState === AppState.ERROR) && (
                          <motion.div 
                            key="upload"
                            initial={{ opacity: 0, scale: 0.98 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.98 }}
                            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                            className="relative group w-full"
                          >
                            <div 
                              className={`
                                relative overflow-hidden rounded-[24px] p-8 sm:p-10 lg:p-8
                                flex flex-col items-center justify-center text-center glassmorphic-card min-h-[300px] lg:min-h-[320px] cursor-pointer
                                ${dragActive 
                                  ? 'border-indigo-500/80 bg-indigo-500/10 shadow-[0_0_40px_rgba(99,102,241,0.25)] scale-[1.01]' 
                                  : 'border-white/[0.04]'
                                }
                              `}
                              onDragEnter={onDragEnter}
                              onDragLeave={onDragLeave}
                              onDragOver={onDragOver}
                              onDrop={onDrop}
                            >
                              <input
                                type="file"
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
                                onChange={(e) => e.target.files && handleFileChange(e.target.files[0])}
                                accept=".pdf,.docx,.txt,.rtf,.png,.jpg,.jpeg,.webp"
                              />
                              
                              {/* Glowing dynamic background flare */}
                              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-indigo-500/[0.05] rounded-full blur-[90px] pointer-events-none -z-10 group-hover:bg-indigo-500/[0.1] transition-colors duration-500" />
                              
                              <div className="relative z-10 mb-4 lg:mb-5">
                                <div className="w-12 h-12 lg:w-14 lg:h-14 rounded-xl bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 p-[1.5px] shadow-lg shadow-indigo-500/10">
                                  <div className="w-full h-full rounded-xl bg-[#080d24] flex items-center justify-center">
                                    <UploadCloud className="w-6 h-6 lg:w-7 lg:h-7 text-indigo-400 group-hover:translate-y-[-2px] group-hover:text-pink-400 transition-all duration-300" />
                                  </div>
                                </div>
                              </div>
                              
                              <h3 className="text-lg sm:text-xl font-bold text-white mb-2 tracking-tight font-display">
                                Drop your resume here
                              </h3>
                              
                              <p className="text-slate-400 mb-5 max-w-xs sm:max-w-sm mx-auto font-light leading-relaxed text-xs">
                                Supports Word (.docx, .doc), PDF, Text, or Images. We'll handle the rest with pixel-perfect structural precision.
                              </p>
                              
                              <div className="btn-2026-neon px-6 py-2.5 font-bold text-xs tracking-wide rounded-xl shadow-md transition-all duration-300 flex items-center justify-center gap-2 group-hover:scale-[1.02]">
                                Browse Files <ArrowRight className="w-3.5 h-3.5 text-white group-hover:translate-x-0.5 transition-transform" />
                              </div>
                            </div>

                            {errorMsg && (
                              <motion.div 
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="mt-5 p-5 bg-red-500/10 border border-red-500/20 rounded-2xl flex flex-col gap-3 backdrop-blur-md"
                              >
                                <div className="flex items-start gap-2.5">
                                  <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                                  <div className="flex flex-col gap-1 text-left">
                                    <h4 className="font-bold text-red-200 text-xs uppercase tracking-wider">Processing Issue</h4>
                                    <p className="text-xs text-red-100/80 leading-relaxed">{errorMsg}</p>
                                  </div>
                                </div>
                                <div className="flex justify-end">
                                  <button 
                                    onClick={handleReset}
                                    className="px-3.5 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-200 text-[10px] font-bold uppercase tracking-widest rounded-lg transition-colors border border-red-500/30"
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
                            className="glassmorphic-card rounded-[24px] p-8 sm:p-12 flex flex-col items-center text-center w-full"
                          >
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
                          </motion.div>
                        )}

                        {appState === AppState.WAITING_APPROVAL && (
                          <motion.div 
                            key="waiting"
                            initial={{ opacity: 0, scale: 0.96 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.96 }}
                            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                            className="glassmorphic-card rounded-[24px] p-8 sm:p-12 flex flex-col items-center text-center w-full"
                          >
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
                          </motion.div>
                        )}

                        {appState === AppState.PROCESSING && (
                          <motion.div 
                            key="processing"
                            initial={{ opacity: 0, scale: 0.96 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.96 }}
                            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                            className="glassmorphic-card rounded-[24px] p-12 sm:p-16 flex flex-col items-center justify-center text-center min-h-[340px] w-full"
                          >
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
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>

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
                />
              </motion.div>
            ) : null}

            {/* Footer */}
            {appState !== AppState.REVIEW && (
              <footer className="w-full max-w-6xl mt-8 lg:mt-12 pt-6 border-t border-white/5">
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
