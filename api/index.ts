import 'dotenv/config';
import express from "express";
import crypto from "crypto";
console.log("Server starting...");

import multer from "multer";
import path from "path";
import fs from "fs";

const upload = multer({ storage: multer.memoryStorage() });

import { db, isFirebaseConfigured, performAutoCleanup } from "../server/firebase";
import { 
  extractResumeDataBackend, 
  analyzeGrammarBackend, 
  checkSpellingBackend, 
  getUsageStatsBackend,
  updateResumeBackend,
  rewritePhraseBackend,
  performOcrBackend
} from "../server/gemini";

const app = express();
const PORT = 3000;

console.log("Starting server setup...");

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
console.log("Express JSON middleware loaded with 50mb limit");

// Health check
app.get("/api/health", (req, res) => {
  res.json({ 
    status: "ok", 
    env: process.env.NODE_ENV,
    hasApiKey: !!(process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY)
  });
});

// Gemini API proxies
app.post("/api/gemini/extract", async (req, res) => {
  try {
    const { payload, usePro } = req.body;
    const data = await extractResumeDataBackend(payload, usePro);
    res.json(data);
  } catch (err: any) {
    console.error("Error in /api/gemini/extract:", err);
    res.status(500).json({ error: err.message || "Failed to extract resume data" });
  }
});

app.post("/api/gemini/analyze-grammar", async (req, res) => {
  try {
    const { data, format, usePro } = req.body;
    const issues = await analyzeGrammarBackend(data, format, usePro);
    res.json(issues);
  } catch (err: any) {
    console.error("Error in /api/gemini/analyze-grammar:", err);
    res.status(500).json({ error: err.message || "Failed to analyze grammar" });
  }
});

app.post("/api/gemini/check-spelling", async (req, res) => {
  try {
    const { data, format, usePro } = req.body;
    const corrected = await checkSpellingBackend(data, format, usePro);
    res.json(corrected);
  } catch (err: any) {
    console.error("Error in /api/gemini/check-spelling:", err);
    res.status(500).json({ error: err.message || "Failed to check spelling" });
  }
});

app.post("/api/gemini/update-resume", async (req, res) => {
  try {
    const { data, instruction, targetJobDescription, format, usePro } = req.body;
    const updated = await updateResumeBackend(data, instruction, targetJobDescription, format, usePro);
    res.json(updated);
  } catch (err: any) {
    console.error("Error in /api/gemini/update-resume:", err);
    res.status(500).json({ error: err.message || "Failed to update resume data" });
  }
});

app.post("/api/gemini/rewrite-phrase", async (req, res) => {
  try {
    const { text, instruction, usePro } = req.body;
    const suggestions = await rewritePhraseBackend(text, instruction, usePro);
    res.json(suggestions);
  } catch (err: any) {
    console.error("Error in /api/gemini/rewrite-phrase:", err);
    res.status(500).json({ error: err.message || "Failed to rewrite phrase" });
  }
});

app.get("/api/gemini/stats", (req, res) => {
  try {
    const usePro = req.query.usePro === 'true';
    const stats = getUsageStatsBackend(usePro);
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/ocr", async (req, res) => {
  try {
    const { base64, mimeType, usePro } = req.body;
    if (!base64 || !mimeType) {
      return res.status(400).json({ error: "Missing image base64 or mimeType data." });
    }
    console.log(`[OCR Request] Starting document scan for mimeType: ${mimeType}`);
    const text = await performOcrBackend(base64, mimeType, usePro);
    res.json({ text });
  } catch (err: any) {
    console.error("Error in /api/ocr:", err);
    res.status(500).json({ error: err.message || "Failed to perform OCR on image" });
  }
});

// Timing-safe constant-time string comparison to prevent administrative timing attacks
const timingSafeCompare = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Consume equivalent verification time to obscure correct length info
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
};

// In-memory fallback persisted to JSON file for high-precision local sandbox stability
const DB_FILE = process.env.VERCEL 
  ? '/tmp/resumes_db.json' 
  : path.join(process.cwd(), 'resumes_db.json');
let inMemoryResumes: any[] = [];
try {
  if (fs.existsSync(DB_FILE)) {
    inMemoryResumes = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    console.log(`[Persistence Fallback] Loaded ${inMemoryResumes.length} resumes from ${DB_FILE}`);
  }
} catch (e: any) {
  console.warn("[Persistence Fallback] Failed to load resumes_db.json:", e.message);
}

let isSaving = false;
let savePending = false;
const saveInMemoryResumes = async () => {
  if (isSaving) {
    savePending = true;
    return;
  }
  isSaving = true;
  try {
    await fs.promises.writeFile(DB_FILE, JSON.stringify(inMemoryResumes, null, 2), 'utf8');
    console.log(`[Persistence Fallback] Saved ${inMemoryResumes.length} resumes to ${DB_FILE}`);
  } catch (e: any) {
    console.warn("[Persistence Fallback] Failed to save resumes_db.json:", e.message);
  } finally {
    isSaving = false;
    if (savePending) {
      savePending = false;
      saveInMemoryResumes();
    }
  }
};


// Background task to clean up old pending resumes
const autoRejectOldResumes = async () => {
  // Auto-rejection logic removed as per user request
};

const getDeviceInfoFromUA = (ua: string): string => {
  if (!ua) return 'Unknown Device';
  
  let os = 'Unknown OS';
  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Macintosh') || ua.includes('Mac OS')) os = 'macOS';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('Linux')) os = 'Linux';
  
  let browser = 'Unknown Browser';
  if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('Chrome') && !ua.includes('Chromium')) browser = 'Chrome';
  else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
  else if (ua.includes('Edge')) browser = 'Edge';
  else if (ua.includes('Trident') || ua.includes('MSIE')) browser = 'IE';
  
  return `${os} / ${browser}`;
};

// API Route for submitting a resume
app.post("/api/submit", async (req, res) => {
  try {
    const { content, userId } = req.body;
    
    if (!content) {
      return res.status(400).json({ error: "Resume content is required" });
    }

    const uid = typeof userId === 'string' && userId.trim().length > 0 ? userId.trim() : null;
    
    const rawIp = 
      (req.headers['x-forwarded-for'] as string) || 
      (req.headers['x-real-ip'] as string) || 
      (req.headers['cf-connecting-ip'] as string) ||
      (req.headers['x-client-ip'] as string) ||
      req.socket.remoteAddress || 
      req.ip || 
      '';
    const ip = typeof rawIp === 'string' && rawIp.includes(',') ? rawIp.split(',')[0].trim() : rawIp;

    const userAgent = req.headers['user-agent'] || '';
    const deviceInfo = getDeviceInfoFromUA(userAgent);

    // Run Firestore auto-cleanup asynchronously
    performAutoCleanup().catch(err => console.error("[Auto-Cleanup] Trigger failed:", err));

    const useDatabase = isFirebaseConfigured() && process.env.BYPASS_DB_ON_ERROR !== 'only-memory';
    if (useDatabase) {
      try {
        const resumeRef = db.collection('resumes').doc();
        const insertData: any = {
          id: resumeRef.id,
          content,
          status: 'pending',
          ip_address: ip,
          device_info: deviceInfo,
          created_at: new Date().toISOString()
        };
        if (uid) insertData.user_id = uid;

        await resumeRef.set(insertData);

        // 2. Log the action
        const logRef = db.collection('activity_logs').doc();
        const logData: any = {
          id: logRef.id,
          action: 'resume_submitted',
          details: { resume_id: resumeRef.id },
          ip_address: ip,
          device_info: deviceInfo,
          created_at: new Date().toISOString()
        };
        if (uid) logData.user_id = uid;

        await logRef.set(logData);

        res.status(200).json({ message: "Resume submitted successfully", resume: insertData });
      } catch (dbError: any) {
        console.warn("Database error (falling back to in-memory):", dbError.message);
        if (process.env.VERCEL && process.env.BYPASS_DB_ON_ERROR !== 'true') {
          return res.status(503).json({ 
            error: `Database connection failed: ${dbError.message}. If deploying on Vercel, please ensure ENABLE_FIREBASE=true and your Firebase config is set. To temporarily bypass this and run in-memory, set BYPASS_DB_ON_ERROR=true in your environment variables.` 
          });
        }
        
        const resumeId = crypto.randomUUID();
        const newResume = { 
          id: resumeId, 
          user_id: uid, 
          content, 
          status: 'pending', 
          ip_address: ip, 
          device_info: deviceInfo, 
          created_at: new Date().toISOString() 
        };
        inMemoryResumes.push(newResume);
        saveInMemoryResumes();
        
        res.status(200).json({ 
          message: "Resume submitted successfully (local database)", 
          resume: newResume,
          bypassApproval: process.env.VERCEL === 'true'
        });
      }
    } else {
      const resumeId = crypto.randomUUID();
      const newResume = { 
        id: resumeId, 
        user_id: uid, 
        content, 
        status: 'pending', 
        ip_address: ip, 
        device_info: deviceInfo, 
        created_at: new Date().toISOString() 
      };
      inMemoryResumes.push(newResume);
      saveInMemoryResumes();
      
      res.status(200).json({ 
        message: "Resume submitted successfully (local database)", 
        resume: newResume,
        bypassApproval: process.env.VERCEL === 'true'
      });
    }
  } catch (error: any) {
    console.error("Error submitting resume:", error);
    res.status(500).json({ error: error.message || "Failed to submit resume" });
  }
});

const checkAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const pass = req.headers['x-admin-password'];
  const adminPassword = (process.env.APP_ADMIN_PASSWORD || 'admin123').trim();
  if (typeof pass === 'string' && timingSafeCompare(pass.trim(), adminPassword)) {
    next();
  } else {
    res.status(401).json({ error: "Unauthorized" });
  }
};

app.post("/api/admin/verify", (req, res) => {
  const { password } = req.body;
  const adminPassword = (process.env.APP_ADMIN_PASSWORD || 'admin123').trim();
  console.log("Login verification attempt running via timing-safe comparison engine.");
  if (typeof password === 'string' && timingSafeCompare(password.trim(), adminPassword)) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: "Invalid password" });
  }
});

// API Route for fetching resumes (Admin Dashboard)
app.get("/api/resumes", checkAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    
    const useDatabase = isFirebaseConfigured() && process.env.BYPASS_DB_ON_ERROR !== 'only-memory';
    if (useDatabase) {
      try {
        let q: any = db.collection('resumes');
        
        if (status === 'pending' || status === 'rejected') {
          q = q.where('status', '==', 'pending');
        } else if (status === 'approved') {
          q = q.where('status', '==', 'approved');
        }
          
        const snapshot = await q.get();
        
        // Map the status for the frontend
        let resumes = snapshot.docs.map(doc => {
          const r = doc.data();
          let currentStatus = (r.rejected || r.content?.rejected) ? 'rejected' : r.status;
          return {
            id: doc.id,
            status: currentStatus,
            created_at: r.created_at,
            content: r.content,
            ip_address: r.ip_address || '',
            device_info: r.device_info || ''
          };
        });

        // Re-filter in memory to account for lazy rejections and the removed pending filter
        if (status && typeof status === 'string') {
          resumes = resumes.filter(r => r.status === status);
        }

        // Sort in memory directly by created_at desc to avoid requiring any custom compound/composite index
        resumes.sort((a: any, b: any) => {
          const tA = a.created_at ? new Date(a.created_at).getTime() : 0;
          const tB = b.created_at ? new Date(b.created_at).getTime() : 0;
          return tB - tA;
        });

        res.status(200).json({ resumes, usingDatabase: true });
      } catch (dbError: any) {
        console.warn("Database error (falling back to in-memory):", dbError.message);
        if (process.env.VERCEL && process.env.BYPASS_DB_ON_ERROR !== 'true') {
          return res.status(503).json({ 
            error: `Database connection failed: ${dbError.message}. If deploying on Vercel, please ensure ENABLE_FIREBASE=true. To temporarily bypass this and run in-memory, set BYPASS_DB_ON_ERROR=true in your environment variables.` 
          });
        }
        
        let filtered = inMemoryResumes;
        if (status && typeof status === 'string') {
          filtered = filtered.filter(r => r.status === status);
        }
        res.status(200).json({ resumes: filtered, usingDatabase: false, dbError: dbError.message });
      }
    } else {
      let filtered = inMemoryResumes;
      if (status && typeof status === 'string') {
        filtered = filtered.filter(r => r.status === status);
      }
      res.status(200).json({ resumes: filtered, usingDatabase: false });
    }
  } catch (error: any) {
    console.error("Error fetching resumes:", error);
    res.status(500).json({ error: error.message || "Failed to fetch resumes" });
  }
});

// API Route for checking resume status
app.get("/api/resumes/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    
    const useDatabase = isFirebaseConfigured() && process.env.BYPASS_DB_ON_ERROR !== 'only-memory';
    if (useDatabase) {
      try {
        const docVal = await db.collection('resumes').doc(id).get();
        if (!docVal.exists) {
          throw new Error("Resume not found");
        }
        const resume = docVal.data() || {};
        
        let currentStatus = resume.content?.rejected ? 'rejected' : resume.status;

        res.status(200).json({ 
          status: currentStatus,
          content: resume.content // Send content back so frontend can recover after refresh
        });
      } catch (dbError: any) {
        console.warn("Database error (falling back to in-memory):", dbError.message);
        if (process.env.VERCEL && process.env.BYPASS_DB_ON_ERROR !== 'true') {
          return res.status(503).json({ 
            error: `Database connection failed: ${dbError.message}. To temporarily bypass this and run in-memory, set BYPASS_DB_ON_ERROR=true in your environment variables.` 
          });
        }
        const resume = inMemoryResumes.find(r => r.id === id);
        if (!resume) {
          return res.status(404).json({ error: "Resume not found" });
        }
        
        res.status(200).json({ 
          status: resume.status,
          content: resume.content 
        });
      }
    } else {
      const resume = inMemoryResumes.find(r => r.id === id);
      if (!resume) {
        return res.status(404).json({ error: "Resume not found" });
      }
      
      res.status(200).json({ 
        status: resume.status,
        content: resume.content 
      });
    }
  } catch (error: any) {
    console.error("Error checking resume status:", error);
    res.status(500).json({ error: error.message || "Failed to check resume status" });
  }
});

// API Route for approving a resume
app.post("/api/approve", checkAdmin, async (req, res) => {
  try {
    const { resumeId } = req.body;

    if (!resumeId) {
      return res.status(400).json({ error: "Resume ID is required" });
    }

    const useDatabase = isFirebaseConfigured() && process.env.BYPASS_DB_ON_ERROR !== 'only-memory';
    if (useDatabase) {
      try {
        const resumeRef = db.collection('resumes').doc(resumeId);
        const nowStr = new Date().toISOString();
        await resumeRef.update({ 
          status: 'approved',
          approved_at: nowStr
        });
        
        const docVal = await resumeRef.get();
        const resume = { id: docVal.id, ...docVal.data() };

        // 2. Log the approval
        const logRef = db.collection('activity_logs').doc();
        await logRef.set({
          id: logRef.id,
          action: 'resume_approved',
          details: { resume_id: resumeId, approved_by: 'admin' },
          created_at: nowStr
        });

        res.status(200).json({ message: "Resume approved successfully", resume });
      } catch (dbError: any) {
        console.warn("Database error (falling back to in-memory):", dbError.message);
        if (process.env.VERCEL && process.env.BYPASS_DB_ON_ERROR !== 'true') {
          return res.status(503).json({ 
            error: `Database connection failed: ${dbError.message}. To temporarily bypass this and run in-memory, set BYPASS_DB_ON_ERROR=true in your environment variables.` 
          });
        }
        
        const resumeIndex = inMemoryResumes.findIndex(r => r.id === resumeId);
        if (resumeIndex === -1) {
          return res.status(404).json({ error: "Resume not found in memory" });
        }
        
        inMemoryResumes[resumeIndex].status = 'approved';
        inMemoryResumes[resumeIndex].approved_at = new Date().toISOString();
        saveInMemoryResumes();
        res.status(200).json({ message: "Resume approved successfully (local database)", resume: inMemoryResumes[resumeIndex] });
      }
    } else {
      const resumeIndex = inMemoryResumes.findIndex(r => r.id === resumeId);
      if (resumeIndex === -1) {
        return res.status(404).json({ error: "Resume not found in memory" });
      }
      
      inMemoryResumes[resumeIndex].status = 'approved';
      inMemoryResumes[resumeIndex].approved_at = new Date().toISOString();
      saveInMemoryResumes();
      res.status(200).json({ message: "Resume approved successfully (local database)", resume: inMemoryResumes[resumeIndex] });
    }
  } catch (error: any) {
    console.error("Error approving resume:", error);
    res.status(500).json({ error: error.message || "Failed to approve resume" });
  }
});

// API Route for fetching admin dashboard statistics
app.get("/api/admin/stats", checkAdmin, async (req, res) => {
  try {
    let pendingCount = 0;
    let approvedCount = 0;
    let rejectedCount = 0;
    let weeklyApprovedCount = 0;
    let monthlyApprovedCount = 0;

    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const useDatabase = isFirebaseConfigured() && process.env.BYPASS_DB_ON_ERROR !== 'only-memory';
    if (useDatabase) {
      try {
        // Calculate status counts efficiently using Firestore count queries (only counts documents on server, which counts as 1 read per query or per 1,000 docs)
        pendingCount = await db.collection('resumes').where('status', '==', 'pending').count();
        approvedCount = await db.collection('resumes').where('status', '==', 'approved').count();
        rejectedCount = await db.collection('resumes').where('status', '==', 'rejected').count();

        // Retrieve recent approved documents to calculate time-series metrics.
        // This is a single-field range query on approved_at, which uses standard indexing without composite index.
        const recentSnapshot = await db.collection('resumes')
          .where('approved_at', '>=', oneMonthAgo.toISOString())
          .get();

        recentSnapshot.docs.forEach((doc: any) => {
          const r = doc.data();
          if (r.status === 'approved') {
            const approvedAt = r.approved_at ? new Date(r.approved_at) : null;
            if (approvedAt) {
              if (approvedAt >= oneWeekAgo) {
                weeklyApprovedCount++;
              }
              if (approvedAt >= oneMonthAgo) {
                monthlyApprovedCount++;
              }
            }
          }
        });
        
        res.json({
          pendingCount,
          approvedCount,
          rejectedCount,
          weeklyApprovedCount,
          monthlyApprovedCount,
          usingDatabase: true
        });
      } catch (dbError: any) {
        console.warn("Database error (falling back to in-memory stats):", dbError.message);
        if (process.env.VERCEL && process.env.BYPASS_DB_ON_ERROR !== 'true') {
          return res.status(503).json({ 
            error: `Database connection failed: ${dbError.message}. To temporarily bypass this and run in-memory, set BYPASS_DB_ON_ERROR=true in your environment variables.` 
          });
        }
        
        inMemoryResumes.forEach((r: any) => {
          const status = r.status;
          if (status === 'pending') {
            pendingCount++;
          } else if (status === 'rejected') {
            rejectedCount++;
          } else if (status === 'approved') {
            approvedCount++;
            
            const approvedAtStr = r.approved_at || r.created_at;
            if (approvedAtStr) {
              const approvedAt = new Date(approvedAtStr);
              if (approvedAt >= oneWeekAgo) {
                weeklyApprovedCount++;
              }
              if (approvedAt >= oneMonthAgo) {
                monthlyApprovedCount++;
              }
            }
          }
        });
        
        res.json({
          pendingCount,
          approvedCount,
          rejectedCount,
          weeklyApprovedCount,
          monthlyApprovedCount,
          usingDatabase: false,
          dbError: dbError.message
        });
      }
    } else {
      inMemoryResumes.forEach((r: any) => {
        const status = r.status;
        if (status === 'pending') {
          pendingCount++;
        } else if (status === 'rejected') {
          rejectedCount++;
        } else if (status === 'approved') {
          approvedCount++;
          
          const approvedAtStr = r.approved_at || r.created_at;
          if (approvedAtStr) {
            const approvedAt = new Date(approvedAtStr);
            if (approvedAt >= oneWeekAgo) {
              weeklyApprovedCount++;
            }
            if (approvedAt >= oneMonthAgo) {
              monthlyApprovedCount++;
            }
          }
        }
      });
      
      res.json({
        pendingCount,
        approvedCount,
        rejectedCount,
        weeklyApprovedCount,
        monthlyApprovedCount,
        usingDatabase: false
      });
    }
  } catch (error: any) {
    console.error("Error calculating stats:", error);
    res.status(500).json({ error: error.message || "Failed to calculate statistics" });
  }
});

// API Route for rejecting a resume
app.post("/api/reject", checkAdmin, async (req, res) => {
  try {
    const { resumeId } = req.body;

    if (!resumeId) {
      return res.status(400).json({ error: "Resume ID is required" });
    }

    const useDatabase = isFirebaseConfigured() && process.env.BYPASS_DB_ON_ERROR !== 'only-memory';
    if (useDatabase) {
      try {
        const resumeRef = db.collection('resumes').doc(resumeId);
        const docVal = await resumeRef.get();
        if (!docVal.exists) {
          throw new Error("Resume not found");
        }
        const currentResume = docVal.data() || {};

        // 2. Update status by setting status directly and a flag in the content Map
        const updatedContent = { ...(currentResume.content || {}), rejected: true };
        await resumeRef.update({ 
          status: 'rejected',
          content: updatedContent 
        });
        
        const newDocVal = await resumeRef.get();
        const resume = { id: newDocVal.id, ...newDocVal.data() };

        // 3. Log the rejection
        const logRef = db.collection('activity_logs').doc();
        await logRef.set({
          id: logRef.id,
          action: 'resume_rejected',
          details: { resume_id: resumeId, rejected_by: 'admin' },
          created_at: new Date().toISOString()
        });

        res.status(200).json({ message: "Resume rejected successfully", resume });
      } catch (dbError: any) {
        console.warn("Database error (falling back to in-memory):", dbError.message);
        if (process.env.VERCEL && process.env.BYPASS_DB_ON_ERROR !== 'true') {
          return res.status(503).json({ 
            error: `Database connection failed: ${dbError.message}. To temporarily bypass this and run in-memory, set BYPASS_DB_ON_ERROR=true in your environment variables.` 
          });
        }
        
        const resumeIndex = inMemoryResumes.findIndex(r => r.id === resumeId);
        if (resumeIndex === -1) {
          return res.status(404).json({ error: "Resume not found in memory" });
        }
        
        inMemoryResumes[resumeIndex].status = 'rejected';
        saveInMemoryResumes();
        res.status(200).json({ message: "Resume rejected successfully (local database)", resume: inMemoryResumes[resumeIndex] });
      }
    } else {
      const resumeIndex = inMemoryResumes.findIndex(r => r.id === resumeId);
      if (resumeIndex === -1) {
        return res.status(404).json({ error: "Resume not found in memory" });
      }
      
      inMemoryResumes[resumeIndex].status = 'rejected';
      saveInMemoryResumes();
      res.status(200).json({ message: "Resume rejected successfully (local database)", resume: inMemoryResumes[resumeIndex] });
    }
  } catch (error: any) {
    console.error("Error rejecting resume:", error);
    res.status(500).json({ error: error.message || "Failed to reject resume" });
  }
});

// API Route for .doc extraction
app.post("/api/extract-doc", async (req, res) => {
  try {
    const { fileBase64 } = req.body;
    
    if (!fileBase64) {
      return res.status(400).json({ error: "No file data provided" });
    }

    const buffer = Buffer.from(fileBase64, 'base64');
    // Dynamic import to prevent ESM/CJS conflicts at module load time
    const WordExtractor = await import("word-extractor");
    const Extractor = (WordExtractor as any).default || WordExtractor;
    const extractor = new Extractor();
    const extracted = await extractor.extract(buffer);
    const text = extracted.getBody();

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: "Could not extract text from this .doc file." });
    }

    res.json({ text });
  } catch (error: any) {
    console.error("Error extracting .doc:", error);
    res.status(500).json({ error: error.message || "Failed to extract text from .doc file" });
  }
});

// Catch-all for undefined API routes
app.all("/api/*all", (req, res) => {
  res.status(404).json({ error: "API route not found" });
});

// Global error handler to prevent HTML error pages
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Global error handler caught:', err);
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Payload too large. Please upload a smaller file.' });
  }
  res.status(err.status || 500).json({ 
    error: err.message || 'Internal Server Error',
    details: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

async function startDevServer() {
  if (!process.env.VERCEL) {
    // Vite middleware for development
    if (process.env.NODE_ENV !== "production") {
      try {
        const viteModule = "vite";
        const { createServer: createViteServer } = await import(viteModule);
        const vite = await createViteServer({
          server: { middlewareMode: true },
          appType: "spa",
        });
        app.use(vite.middlewares);
        console.log("Vite middleware loaded successfully");
      } catch (e) {
        console.error("Failed to load Vite middleware:", e);
      }
    } else {
      // Serve static files in production
      app.use(express.static(path.join(process.cwd(), "dist")));
      app.get("*all", (req, res) => {
        res.sendFile(path.join(process.cwd(), "dist", "index.html"));
      });
    }

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}

startDevServer().catch(console.error);

export default app;
