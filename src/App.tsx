import React, { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AppState, ResumeData, ResumeFormat } from '@/types';
import { extractResumeData, getUsageStats } from '@/services/geminiService';
import { generateResumeDoc } from '@/services/docxService';
import ResumePreview from '@/components/ResumePreview';
import AdminDashboard from '@/components/AdminDashboard';
import { saveAs } from 'file-saver';
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
  Clock
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
  const [usePro, setUsePro] = useState<boolean>(false);
  const [stats, setStats] = useState(getUsageStats(usePro));
  const [stagedContent, setStagedContent] = useState<StagedContent | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const [pendingResumeId, setPendingResumeId] = useState<string | null>(() => {
    return localStorage.getItem('pendingResumeId');
  });
  const [backendStatus, setBackendStatus] = useState<any>(null);

  useEffect(() => {
    if (pendingResumeId) {
      localStorage.setItem('pendingResumeId', pendingResumeId);
    } else {
      localStorage.removeItem('pendingResumeId');
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
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
          } catch (e) {
            if (response.status === 500) {
              errorMessage = `Server error (500) during .doc extraction. This format can be tricky; please try saving as .docx or .pdf for better results.`;
            } else if (response.status === 413) {
              errorMessage = `File is too large for the server to process. Please convert it to .docx or .pdf and try again.`;
            } else {
              errorMessage = `Server error (${response.status}). Please try again later.`;
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
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (e) {
          if (response.status === 500) {
            errorMessage = `Server processing error (500). This might be due to a large file or database issue. Please try a smaller file or try again in a few minutes.`;
          } else if (response.status === 413) {
            errorMessage = `File is too large for the server to process. Please try a smaller file.`;
          } else {
            errorMessage = `Server error (${response.status}). Please try again later.`;
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
    <div className="min-h-screen bg-[#0f172a] text-slate-200 font-sans selection:bg-indigo-500/30">
      {/* Ambient Background */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-600/20 blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-violet-600/20 blur-[120px]" />
      </div>

      <div className="relative z-10 flex flex-col items-center py-16 px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="absolute top-6 right-6 z-50">
          <button
            onClick={() => setShowAdmin(!showAdmin)}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 transition-colors"
          >
            <ShieldCheck className="w-4 h-4" />
            <span className="text-sm font-medium">{showAdmin ? 'Exit Admin' : 'Admin'}</span>
          </button>
        </div>

        {showAdmin ? (
          <AdminDashboard />
        ) : (
          <>
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className="text-center mb-16 max-w-3xl"
            >
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 backdrop-blur-md mb-6">
            <Sparkles className="w-4 h-4 text-indigo-400" />
            <span className="text-xs font-medium text-indigo-200 tracking-wide uppercase">Next-Gen Resume Intelligence</span>
          </div>
          
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6 bg-clip-text text-transparent bg-gradient-to-b from-white via-white to-slate-400">
            ArthFormat AI
          </h1>
          
          <p className="text-xl text-slate-400 font-light tracking-wide">
            "Resumes Reimagined, Precision Personified."
          </p>
        </motion.div>

        {/* Format Selection (Main Page) */}
        {appState === AppState.IDLE && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center mb-8"
          >
            <label className="text-slate-400 text-sm mb-3 font-medium uppercase tracking-widest">Select Target Format</label>
            <div className="flex gap-4">
              <button 
                onClick={() => setSelectedFormat(ResumeFormat.CLASSIC_PROFESSIONAL)}
                className={`px-6 py-3 rounded-xl border transition-all flex items-center gap-2 ${selectedFormat === ResumeFormat.CLASSIC_PROFESSIONAL ? 'bg-indigo-500/20 border-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'}`}
              >
                <LayoutTemplate className="w-4 h-4" />
                Classic Professional
              </button>
              <button 
                onClick={() => setSelectedFormat(ResumeFormat.MODERN_EXECUTIVE)}
                className={`px-6 py-3 rounded-xl border transition-all flex items-center gap-2 ${selectedFormat === ResumeFormat.MODERN_EXECUTIVE ? 'bg-indigo-500/20 border-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'}`}
              >
                <Sparkles className="w-4 h-4" />
                Modern Executive
              </button>
            </div>

            <div className="mt-6 flex items-center gap-3">
              <button
                onClick={() => setUsePro(!usePro)}
                className={`flex items-center gap-2 px-4 py-2 rounded-full border transition-all ${usePro ? 'bg-amber-500/20 border-amber-500 text-amber-200 shadow-lg shadow-amber-500/20' : 'bg-white/5 border-white/10 text-slate-500 hover:bg-white/10'}`}
              >
                <Database className={`w-4 h-4 ${usePro ? 'text-amber-400' : 'text-slate-500'}`} />
                <span className="text-xs font-bold uppercase tracking-wider">
                  {usePro ? "Pro Mode Active (Gemini 3.1 Pro)" : "Standard Mode (Gemini 3 Flash)"}
                </span>
              </button>
            </div>
          </motion.div>
        )}

        {/* Main Content Area */}
        <div className="w-full max-w-5xl">
          <AnimatePresence mode="wait">
            {(appState === AppState.IDLE || appState === AppState.ERROR) && (
              <motion.div 
                key="upload"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.4 }}
                className="relative group"
              >
                <div 
                  className={`
                    relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl p-12 md:p-20
                    flex flex-col items-center justify-center text-center transition-all duration-300
                    ${dragActive ? 'border-indigo-500/50 bg-indigo-500/10' : 'hover:border-white/20 hover:bg-white/10'}
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
                  
                  <div className="relative z-10 mb-8">
                    <div className="w-24 h-24 rounded-2xl bg-gradient-to-tr from-indigo-500 to-violet-500 p-[1px]">
                      <div className="w-full h-full rounded-2xl bg-[#0f172a] flex items-center justify-center">
                        <UploadCloud className="w-10 h-10 text-indigo-400" />
                      </div>
                    </div>
                    <div className="absolute inset-0 bg-indigo-500/30 blur-2xl -z-10" />
                  </div>
                  
                  <h3 className="text-2xl font-semibold text-white mb-3">
                    Drop your resume here
                  </h3>
                  <p className="text-slate-400 mb-8 max-w-md mx-auto font-light">
                    Supports Word (.docx, .doc), PDF, Text, or Images. We'll handle the rest with pixel-perfect precision.
                  </p>
                  
                  <button className="px-8 py-3 bg-white text-slate-900 font-semibold rounded-xl hover:bg-indigo-50 transition-colors flex items-center gap-2 group-hover:scale-105 duration-200">
                    Browse Files <ArrowRight className="w-4 h-4" />
                  </button>
                </div>

                {errorMsg && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-6 p-6 bg-red-500/10 border border-red-500/20 rounded-2xl flex flex-col gap-4 backdrop-blur-md"
                  >
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="w-6 h-6 text-red-400 flex-shrink-0 mt-0.5" />
                      <div className="flex flex-col gap-1">
                        <h4 className="font-bold text-red-200">Processing Issue</h4>
                        <p className="text-sm text-red-100/80 leading-relaxed">{errorMsg}</p>
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <button 
                        onClick={handleReset}
                        className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-200 text-xs font-bold uppercase tracking-widest rounded-lg transition-colors border border-red-500/30"
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
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-12 flex flex-col items-center text-center"
              >
                <div className="w-20 h-20 bg-emerald-500/10 rounded-2xl flex items-center justify-center mb-6 border border-emerald-500/20">
                  <CheckCircle className="w-10 h-10 text-emerald-400" />
                </div>
                <h2 className="text-2xl font-bold text-white mb-2">File Ready for Processing</h2>
                <p className="text-slate-400 mb-8 max-w-sm">
                  Document <span className="text-indigo-300 font-mono">"{fileName}"</span> has been prepared. 
                  Submit it to format your resume.
                </p>
                
                <div className="flex gap-4">
                  <button 
                    onClick={handleReset}
                    className="px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 font-semibold rounded-xl transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleSubmitForApproval}
                    className="px-10 py-3 bg-indigo-500 hover:bg-indigo-400 text-white font-bold rounded-xl shadow-lg shadow-indigo-500/20 transition-all flex items-center gap-2 active:scale-[0.98]"
                  >
                    <ArrowRight className="w-5 h-5" />
                    Format Resume
                  </button>
                </div>
              </motion.div>
            )}

            {appState === AppState.WAITING_APPROVAL && (
              <motion.div 
                key="waiting"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-12 flex flex-col items-center text-center"
              >
                <div className="w-20 h-20 bg-amber-500/10 rounded-2xl flex items-center justify-center mb-6 border border-amber-500/20">
                  <Clock className="w-10 h-10 text-amber-400" />
                </div>
                <h2 className="text-2xl font-bold text-white mb-2">Pending Admin Approval</h2>
                <p className="text-slate-400 mb-8 max-w-sm">
                  Your resume has been submitted and is waiting for an administrator to approve it. 
                  Once approved, the formatting process will begin automatically.
                  <br /><br />
                  <span className="text-amber-400/80 text-sm font-medium">Please keep this tab open.</span>
                </p>
                <button 
                  onClick={handleReset}
                  className="px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 font-semibold rounded-xl transition-all"
                >
                  Submit Another Resume
                </button>
              </motion.div>
            )}

            {appState === AppState.PROCESSING && (
              <motion.div 
                key="processing"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl p-20 flex flex-col items-center justify-center text-center min-h-[500px]"
              >
                 <div className="relative mb-8">
                    <div className="w-24 h-24 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <FileText className="w-8 h-8 text-indigo-400" />
                    </div>
                 </div>
                 <h2 className="text-3xl font-bold text-white mb-4">Processing Resume</h2>
                 <p className="text-slate-400 max-w-md animate-pulse font-light">
                   Your resume is being formatted...
                 </p>
              </motion.div>
            )}

            {appState === AppState.REVIEW && resumeData && (
              <motion.div 
                key="review"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
              >
                <ResumePreview 
                  key={fileName}
                  data={resumeData} 
                  onDownload={() => {}} 
                  onReset={handleReset} 
                  onUpdate={setResumeData}
                  selectedFormat={selectedFormat}
                  usePro={usePro}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        
        {/* Footer */}
        <footer className="w-full max-w-5xl mt-20 pt-8 border-t border-white/5">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-slate-500 text-xs">
            <p>© 2024 Precision Resume Formatter. All rights reserved.</p>
            <div className="flex items-center gap-6">
              {backendStatus && (
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${backendStatus.status === 'ok' ? 'bg-emerald-500' : 'bg-red-500'}`}></div>
                  <span>Backend: {backendStatus.status === 'ok' ? 'Connected' : 'Error'}</span>
                  {backendStatus.isVercel && <span className="px-1.5 py-0.5 bg-white/5 rounded text-[10px]">Vercel</span>}
                </div>
              )}
              <button 
                onClick={() => setShowAdmin(!showAdmin)}
                className="hover:text-slate-300 transition-colors flex items-center gap-1.5"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                Admin Portal
              </button>
            </div>
          </div>
        </footer>
          </>
        )}
      </div>
    </div>
  );
};

export default App;
