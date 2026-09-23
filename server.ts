import 'dotenv/config';
import express from "express";
import crypto from "crypto";
console.log("Server starting...");
import WordExtractor from "word-extractor";
// Fallback for some environments
const Extractor = (WordExtractor as any).default || WordExtractor;
import multer from "multer";
import path from "path";
import fs from "fs";

const upload = multer({ storage: multer.memoryStorage() });

import { db, isFirebaseConfigured, performAutoCleanup, firebaseConfig } from "./server/firebase";
import { 
  extractResumeDataBackend, 
  analyzeGrammarBackend, 
  checkSpellingBackend, 
  getUsageStatsBackend,
  updateResumeBackend,
  rewritePhraseBackend,
  performOcrBackend
} from "./server/gemini";

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
    if (inMemoryResumes.length > 50) {
      inMemoryResumes = inMemoryResumes.slice(-50);
    }
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

// Global process error handlers for long-running server stability
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Process Security] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[Process Security] Uncaught Exception:', error);
});


// Background task to clean up old pending resumes and enforce zero-bloat RAM usage
const performAutoCleanup = async () => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    // 1. Clean up in-memory records older than 30 days or cap at max 20 lightweight items
    inMemoryResumes = inMemoryResumes.filter(r => {
      if (!r.created_at) return true;
      const created = new Date(r.created_at);
      return created >= thirtyDaysAgo;
    });

    if (inMemoryResumes.length > 20) {
      inMemoryResumes = inMemoryResumes.slice(-20);
    }
    await saveInMemoryResumes();

    // 2. Clean up Firestore database if configured
    if (isFirebaseConfigured() && process.env.BYPASS_DB_ON_ERROR !== 'only-memory') {
      const oldSnapshot = await db.collection('resumes')
        .where('created_at', '<', thirtyDaysAgo.toISOString())
        .get();
      
      if (!oldSnapshot.empty) {
        const batch = db.batch();
        oldSnapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        console.log(`[Auto-Cleanup] Auto-deleted ${oldSnapshot.size} old resume records from Firestore.`);
      }
    }
  } catch (err: any) {
    console.warn("[Auto-Cleanup] Warning during auto-delete:", err.message);
  }
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

// API Route for submitting a resume (STRICT ZERO-RESUME-STORAGE: stores lightweight candidate metadata only, NEVER resume body)
app.post("/api/submit", async (req, res) => {
  try {
    const { content, userId, candidateName: inputName, fileName: inputFileName } = req.body;
    
    if (!content && !inputName && !inputFileName) {
      return res.status(400).json({ error: "Submission metadata is required" });
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
    const ip = typeof rawIp === 'string' && rawIp.includes(',') ? rawIp.split(',')[0].trim() : (rawIp || 'Unknown IP');

    const userAgent = req.headers['user-agent'] || '';
    const deviceInfo = getDeviceInfoFromUA(userAgent);

    // Run auto-cleanup asynchronously to purge old records
    performAutoCleanup().catch(err => console.error("[Auto-Cleanup] Trigger failed:", err));

    // STRICT ZERO-STORAGE PRIVACY: Extract ONLY the candidate display name.
    // NEVER save resume text, bullets, experience, skills or document payloads.
    let candidateName = typeof inputName === 'string' && inputName.trim().length > 0 ? inputName.trim() : '';
    if (!candidateName && inputFileName) {
      candidateName = String(inputFileName).replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ').trim();
    }
    if (!candidateName && content) {
      if (typeof content === 'object') {
        candidateName = String(content.candidateName || content.fileName || content.name || '').replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ').trim();
      } else if (typeof content === 'string') {
        candidateName = "Candidate Submission";
      }
    }
    if (!candidateName) {
      candidateName = "Candidate Submission";
    }
    candidateName = candidateName.slice(0, 80);

    const useDatabase = isFirebaseConfigured() && process.env.BYPASS_DB_ON_ERROR !== 'only-memory';
    if (useDatabase) {
      try {
        const resumeRef = db.collection('resumes').doc();
        const insertData: any = {
          id: resumeRef.id,
          candidate_name: candidateName,
          status: 'pending',
          ip_address: ip,
          device_info: deviceInfo,
          created_at: new Date().toISOString(),
          approved_at: null,
          rejected_at: null
        };
        if (uid) insertData.user_id = uid;

        await resumeRef.set(insertData);

        // Log the action
        const logRef = db.collection('activity_logs').doc();
        const logData: any = {
          id: logRef.id,
          action: 'resume_submitted',
          details: { resume_id: resumeRef.id, candidate_name: candidateName },
          ip_address: ip,
          device_info: deviceInfo,
          created_at: new Date().toISOString()
        };
        if (uid) logData.user_id = uid;

        await logRef.set(logData);

        return res.status(200).json({ message: "Resume submitted successfully", resume: insertData });
      } catch (dbError: any) {
        console.warn("Database error (falling back to in-memory):", dbError.message);
        if (process.env.VERCEL && process.env.BYPASS_DB_ON_ERROR !== 'true') {
          return res.status(503).json({ 
            error: `Database connection failed: ${dbError.message}.` 
          });
        }
        
        const resumeId = crypto.randomUUID();
        const newResume = { 
          id: resumeId, 
          user_id: uid, 
          candidate_name: candidateName,
          status: 'pending', 
          ip_address: ip, 
          device_info: deviceInfo, 
          created_at: new Date().toISOString(),
          approved_at: null,
          rejected_at: null
        };
        inMemoryResumes.push(newResume);
        saveInMemoryResumes();
        
        return res.status(200).json({ 
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
        candidate_name: candidateName,
        status: 'pending', 
        ip_address: ip, 
        device_info: deviceInfo, 
        created_at: new Date().toISOString(),
        approved_at: null,
        rejected_at: null
      };
      inMemoryResumes.push(newResume);
      saveInMemoryResumes();
      
      return res.status(200).json({ 
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

// API Route for fetching resumes (Admin Dashboard - supports status & period filtering)
app.get("/api/resumes", checkAdmin, async (req, res) => {
  try {
    const { status, period } = req.query;
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const weekStart = now.getTime() - 7 * 24 * 60 * 60 * 1000;
    const monthStart = now.getTime() - 30 * 24 * 60 * 60 * 1000;
    
    const useDatabase = isFirebaseConfigured() && process.env.BYPASS_DB_ON_ERROR !== 'only-memory';
    let rawList: any[] = [];
    let usingDatabase = false;
    let dbErrorMsg: string | undefined = undefined;

    if (useDatabase) {
      try {
        const snapshot = await db.collection('resumes').get();
        rawList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        usingDatabase = true;
      } catch (dbError: any) {
        console.warn("Database error (falling back to in-memory):", dbError.message);
        rawList = inMemoryResumes;
        dbErrorMsg = dbError.message;
      }
    } else {
      rawList = inMemoryResumes;
    }

    // Map to clean metadata records (ZERO resume body or text payload)
    let records = rawList.map(r => {
      let curStatus = (r.rejected || r.content?.rejected || r.status === 'rejected') ? 'rejected' : (r.status || 'pending');
      const candidateName = r.candidate_name || r.content?.name || r.name || 'Candidate Submission';
      return {
        id: r.id,
        candidate_name: candidateName,
        status: curStatus,
        ip_address: r.ip_address || 'Unknown IP',
        device_info: r.device_info || '',
        created_at: r.created_at || new Date().toISOString(),
        approved_at: r.approved_at || null,
        rejected_at: r.rejected_at || null
      };
    });

    // 1. Status Filter
    if (status && status !== 'all' && typeof status === 'string') {
      records = records.filter(r => r.status === status);
    }

    // 2. Period Filter
    if (period && period !== 'all' && typeof period === 'string') {
      records = records.filter(r => {
        let tsStr = r.created_at;
        if (r.status === 'approved' && r.approved_at) tsStr = r.approved_at;
        else if (r.status === 'rejected' && r.rejected_at) tsStr = r.rejected_at;
        const time = tsStr ? new Date(tsStr).getTime() : 0;
        if (period === 'day') return time >= todayStart;
        if (period === 'week') return time >= weekStart;
        if (period === 'month') return time >= monthStart;
        return true;
      });
    }

    // 3. Sort by most recent timestamp descending
    records.sort((a, b) => {
      const tA = new Date(a.approved_at || a.rejected_at || a.created_at).getTime();
      const tB = new Date(b.approved_at || b.rejected_at || b.created_at).getTime();
      return tB - tA;
    });

    res.status(200).json({ 
      resumes: records, 
      usingDatabase, 
      dbError: dbErrorMsg, 
      projectId: firebaseConfig.projectId 
    });
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
        let currentStatus = (resume.rejected || resume.content?.rejected || resume.status === 'rejected') ? 'rejected' : resume.status;
        return res.status(200).json({ 
          status: currentStatus,
          candidate_name: resume.candidate_name
        });
      } catch (dbError: any) {
        console.warn("Database error (falling back to in-memory):", dbError.message);
      }
    }
    
    const resume = inMemoryResumes.find(r => r.id === id);
    if (!resume) {
      return res.status(404).json({ error: "Resume not found" });
    }
    
    res.status(200).json({ 
      status: resume.status,
      candidate_name: resume.candidate_name
    });
  } catch (error: any) {
    console.error("Error checking resume status:", error);
    res.status(500).json({ error: error.message || "Failed to check resume status" });
  }
});

app.delete("/api/resumes/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const useDatabase = isFirebaseConfigured() && process.env.BYPASS_DB_ON_ERROR !== 'only-memory';
    
    if (useDatabase) {
      try {
        await db.collection('resumes').doc(id).delete();
        res.status(200).json({ message: "Resume deleted successfully from database" });
      } catch (dbError: any) {
        console.warn("Database error during delete fallback:", dbError.message);
        // Fallback to in-memory deletion
        inMemoryResumes = inMemoryResumes.filter(r => r.id !== id);
        await saveInMemoryResumes();
        res.status(200).json({ message: "Resume deleted successfully (local database)" });
      }
    } else {
      inMemoryResumes = inMemoryResumes.filter(r => r.id !== id);
      await saveInMemoryResumes();
      res.status(200).json({ message: "Resume deleted successfully (local database)" });
    }
  } catch (error: any) {
    console.error("Error deleting resume:", error);
    res.status(500).json({ error: error.message || "Failed to delete resume" });
  }
});

// API Route for purging all storage and memory logs
app.post("/api/admin/purge", checkAdmin, async (req, res) => {
  try {
    inMemoryResumes = [];
    await saveInMemoryResumes();

    const useDatabase = isFirebaseConfigured() && process.env.BYPASS_DB_ON_ERROR !== 'only-memory';
    if (useDatabase) {
      try {
        const snapshot = await db.collection('resumes').get();
        if (!snapshot.empty) {
          const batch = db.batch();
          snapshot.docs.forEach(doc => batch.delete(doc.ref));
          await batch.commit();
        }
      } catch (dbErr: any) {
        console.warn("Firestore purge warning:", dbErr.message);
      }
    }
    res.json({ success: true, message: "All submission logs and memory storage purged successfully." });
  } catch (err: any) {
    console.error("Error purging records:", err);
    res.status(500).json({ error: err.message || "Failed to purge database records" });
  }
});

// API Route for approving a resume
// API Route for approving a resume
app.post("/api/approve", checkAdmin, async (req, res) => {
  try {
    const { resumeId } = req.body;

    if (!resumeId) {
      return res.status(400).json({ error: "Resume ID is required" });
    }

    const nowStr = new Date().toISOString();
    const useDatabase = isFirebaseConfigured() && process.env.BYPASS_DB_ON_ERROR !== 'only-memory';
    if (useDatabase) {
      try {
        const resumeRef = db.collection('resumes').doc(resumeId);
        await resumeRef.update({ 
          status: 'approved',
          approved_at: nowStr
        });
        
        const docVal = await resumeRef.get();
        const resume = { id: docVal.id, ...docVal.data() };

        // Log the approval
        const logRef = db.collection('activity_logs').doc();
        await logRef.set({
          id: logRef.id,
          action: 'resume_approved',
          details: { resume_id: resumeId, approved_by: 'admin' },
          created_at: nowStr
        });

        return res.status(200).json({ message: "Resume approved successfully", resume });
      } catch (dbError: any) {
        console.warn("Database error (falling back to in-memory):", dbError.message);
      }
    }

    const resumeIndex = inMemoryResumes.findIndex(r => r.id === resumeId);
    if (resumeIndex !== -1) {
      inMemoryResumes[resumeIndex].status = 'approved';
      inMemoryResumes[resumeIndex].approved_at = nowStr;
      saveInMemoryResumes();
      return res.status(200).json({ message: "Resume approved successfully (local database)", resume: inMemoryResumes[resumeIndex] });
    }
    res.status(200).json({ message: "Resume approved successfully" });
  } catch (error: any) {
    console.error("Error approving resume:", error);
    res.status(500).json({ error: error.message || "Failed to approve resume" });
  }
});

// API Route for fetching admin dashboard statistics (Approved vs Declined by Day, Week, Month, and All-Time)
app.get("/api/admin/stats", checkAdmin, async (req, res) => {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const weekStart = now.getTime() - 7 * 24 * 60 * 60 * 1000;
    const monthStart = now.getTime() - 30 * 24 * 60 * 60 * 1000;

    let pendingCount = 0;
    let approvedToday = 0;
    let approvedWeek = 0;
    let approvedMonth = 0;
    let approvedAllTime = 0;

    let declinedToday = 0;
    let declinedWeek = 0;
    let declinedMonth = 0;
    let declinedAllTime = 0;

    const useDatabase = isFirebaseConfigured() && process.env.BYPASS_DB_ON_ERROR !== 'only-memory';
    let rawList: any[] = [];
    let usingDatabase = false;
    let dbErrorMsg: string | undefined = undefined;

    if (useDatabase) {
      try {
        const snapshot = await db.collection('resumes').get();
        rawList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        usingDatabase = true;
      } catch (dbError: any) {
        console.warn("Database error (falling back to in-memory stats):", dbError.message);
        rawList = inMemoryResumes;
        dbErrorMsg = dbError.message;
      }
    } else {
      rawList = inMemoryResumes;
    }

    rawList.forEach((r: any) => {
      const curStatus = (r.rejected || r.content?.rejected || r.status === 'rejected') ? 'rejected' : (r.status || 'pending');
      if (curStatus === 'pending') {
        pendingCount++;
      } else if (curStatus === 'approved') {
        approvedAllTime++;
        const ts = r.approved_at ? new Date(r.approved_at).getTime() : (r.created_at ? new Date(r.created_at).getTime() : 0);
        if (ts >= todayStart) approvedToday++;
        if (ts >= weekStart) approvedWeek++;
        if (ts >= monthStart) approvedMonth++;
      } else if (curStatus === 'rejected') {
        declinedAllTime++;
        const ts = r.rejected_at ? new Date(r.rejected_at).getTime() : (r.created_at ? new Date(r.created_at).getTime() : 0);
        if (ts >= todayStart) declinedToday++;
        if (ts >= weekStart) declinedWeek++;
        if (ts >= monthStart) declinedMonth++;
      }
    });

    res.json({
      pendingCount,
      approved: {
        today: approvedToday,
        week: approvedWeek,
        month: approvedMonth,
        allTime: approvedAllTime
      },
      declined: {
        today: declinedToday,
        week: declinedWeek,
        month: declinedMonth,
        allTime: declinedAllTime
      },
      // Backward compatibility aliases
      approvedCount: approvedAllTime,
      rejectedCount: declinedAllTime,
      weeklyApprovedCount: approvedWeek,
      monthlyApprovedCount: approvedMonth,
      usingDatabase,
      dbError: dbErrorMsg
    });
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

    const nowStr = new Date().toISOString();
    const useDatabase = isFirebaseConfigured() && process.env.BYPASS_DB_ON_ERROR !== 'only-memory';
    if (useDatabase) {
      try {
        const resumeRef = db.collection('resumes').doc(resumeId);
        await resumeRef.update({ 
          status: 'rejected',
          rejected_at: nowStr
        });
        
        const docVal = await resumeRef.get();
        const resume = { id: docVal.id, ...docVal.data() };

        // Log the rejection
        const logRef = db.collection('activity_logs').doc();
        await logRef.set({
          id: logRef.id,
          action: 'resume_rejected',
          details: { resume_id: resumeId, rejected_by: 'admin' },
          created_at: nowStr
        });

        return res.status(200).json({ message: "Resume rejected successfully", resume });
      } catch (dbError: any) {
        console.warn("Database error (falling back to in-memory):", dbError.message);
      }
    }

    const resumeIndex = inMemoryResumes.findIndex(r => r.id === resumeId);
    if (resumeIndex !== -1) {
      inMemoryResumes[resumeIndex].status = 'rejected';
      inMemoryResumes[resumeIndex].rejected_at = nowStr;
      saveInMemoryResumes();
      return res.status(200).json({ message: "Resume rejected successfully (local database)", resume: inMemoryResumes[resumeIndex] });
    }
    res.status(200).json({ message: "Resume rejected successfully" });
  } catch (error: any) {
    console.error("Error rejecting resume:", error);
    res.status(500).json({ error: error.message || "Failed to reject resume" });
  }
});

// Helper to extract clean printable text sequences from raw binary buffer if word-extractor truncates
function extractAllDocText(buffer: Buffer): string {
  const resultLines: string[] = [];
  const seenLines = new Set<string>();

  function addLine(line: string) {
    const trimmed = line.trim();
    if (trimmed.length < 3) return;
    if (trimmed.startsWith('CompObj') || trimmed.startsWith('ObjectPool') || trimmed.includes('Microsoft Word Document') || trimmed.startsWith('WordDocument')) return;
    
    const clean = trimmed.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ').replace(/\s+/g, ' ').trim();
    if (clean.length >= 3 && !seenLines.has(clean.toLowerCase())) {
      seenLines.add(clean.toLowerCase());
      resultLines.push(clean);
    }
  }

  // Stream 1: UTF-16LE Text Extraction (Word 97-2003 Unicode text streams)
  let currentUtf16: string[] = [];
  for (let i = 0; i < buffer.length - 1; i += 2) {
    const code = buffer.readUInt16LE(i);
    if ((code >= 32 && code <= 126) || code === 10 || code === 13 || code === 9 || (code >= 160 && code <= 0x02FF)) {
      if (code === 10 || code === 13) {
        if (currentUtf16.length >= 3) addLine(currentUtf16.join(''));
        currentUtf16 = [];
      } else {
        currentUtf16.push(String.fromCharCode(code));
      }
    } else {
      if (currentUtf16.length >= 3) addLine(currentUtf16.join(''));
      currentUtf16 = [];
    }
  }
  if (currentUtf16.length >= 3) addLine(currentUtf16.join(''));

  // Stream 2: 8-bit ANSI / Compressed Text Extraction
  let currentAnsi: string[] = [];
  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];
    if ((byte >= 32 && byte <= 126) || byte === 10 || byte === 13 || byte === 9 || (byte >= 160 && byte <= 255)) {
      if (byte === 10 || byte === 13) {
        if (currentAnsi.length >= 4) addLine(currentAnsi.join(''));
        currentAnsi = [];
      } else {
        currentAnsi.push(String.fromCharCode(byte));
      }
    } else {
      if (currentAnsi.length >= 4) addLine(currentAnsi.join(''));
      currentAnsi = [];
    }
  }
  if (currentAnsi.length >= 4) addLine(currentAnsi.join(''));

  return resultLines.join('\n');
}

// API Route for .doc extraction
app.post("/api/extract-doc", async (req, res) => {
  try {
    const { fileBase64 } = req.body;
    
    if (!fileBase64) {
      return res.status(400).json({ error: "No file data provided" });
    }

    const buffer = Buffer.from(fileBase64, 'base64');
    let text = "";

    try {
      const extractor = new Extractor();
      const extracted = await extractor.extract(buffer);
      const bodyText = extracted.getBody() || "";
      const textboxText = typeof extracted.getTextboxes === 'function' ? (extracted.getTextboxes() || "") : "";
      const headerText = typeof extracted.getHeaders === 'function' ? (extracted.getHeaders() || "") : "";
      const footerText = typeof extracted.getFooters === 'function' ? (extracted.getFooters() || "") : "";
      const footnoteText = typeof extracted.getFootnotes === 'function' ? (extracted.getFootnotes() || "") : "";
      const endnoteText = typeof extracted.getEndnotes === 'function' ? (extracted.getEndnotes() || "") : "";
      
      text = [headerText, bodyText, textboxText, footerText, footnoteText, endnoteText]
        .filter(t => typeof t === 'string' && t.trim().length > 0)
        .join("\n\n");
    } catch (extractErr) {
      console.warn("word-extractor failed, using binary text fallback:", extractErr);
    }

    // Binary stream scanner ensures NO section/page is missed due to piece-table truncation
    const binaryText = extractAllDocText(buffer);

    if (!text || text.trim().length < 20) {
      text = binaryText;
    } else if (binaryText && binaryText.length > text.length + 50) {
      text = text + "\n\n" + binaryText;
    }

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

