import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle, XCircle, Clock, FileText, AlertTriangle, LogOut, X, RefreshCw } from 'lucide-react';
import Login from './Login';
import { safeStorage } from '@/utils/safeStorage';

interface PendingResume {
  id: string;
  user_id: string;
  content: any;
  status: string;
  created_at: string;
  ip_address?: string;
  device_info?: string;
}

type StatusFilter = 'pending' | 'approved' | 'rejected';

interface AdminDashboardProps {
  onClose?: () => void;
}

const AdminDashboard: React.FC<AdminDashboardProps> = ({ onClose }) => {
  const [adminPassword, setAdminPassword] = useState<string | null>(() => {
    return safeStorage.getItem('adminPassword');
  });
  const [resumes, setResumes] = useState<PendingResume[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [healthStatus, setHealthStatus] = useState<any>(null);
  const [dbWarning, setDbWarning] = useState<string | null>(null);
  const [isLiveDb, setIsLiveDb] = useState<boolean>(false);
  const [activeProjectId, setActiveProjectId] = useState<string>('formatai-889f7');
  const [stats, setStats] = useState<{
    pendingCount: number;
    approvedCount: number;
    rejectedCount: number;
    weeklyApprovedCount: number;
    monthlyApprovedCount: number;
  } | null>(null);

  const fetchStats = async () => {
    if (!adminPassword) return;
    try {
      const response = await fetch(`/api/admin/stats?_t=${Date.now()}`, {
        headers: {
          'x-admin-password': adminPassword,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      });
      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch (err) {
      console.error("Failed to fetch admin stats:", err);
    }
  };

  const checkHealth = async () => {
    try {
      const response = await fetch(`/api/health?_t=${Date.now()}`, {
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      });
      const data = await response.json();
      setHealthStatus(data);
    } catch (err: any) {
      setHealthStatus({ error: err.message });
    }
  };

  useEffect(() => {
    if (adminPassword) {
      fetchResumes();
      checkHealth();
    } else {
      setLoading(false);
    }
  }, [adminPassword, statusFilter]);

  const handleLoginSuccess = (password: string) => {
    safeStorage.setItem('adminPassword', password);
    setAdminPassword(password);
  };

  const handleLogout = () => {
    safeStorage.removeItem('adminPassword');
    setAdminPassword(null);
  };

  const fetchResumes = async () => {
    try {
      setLoading(true);
      setDbWarning(null);
      fetchStats().catch(console.error);
      const response = await fetch(`/api/resumes?status=${statusFilter}&_t=${Date.now()}`, {
        headers: {
          'x-admin-password': adminPassword || '',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      });
      if (!response.ok) {
        if (response.status === 401) {
          handleLogout();
          throw new Error('Unauthorized. Please log in again.');
        }
        let errorMessage = 'Failed to fetch resumes';
        try {
          const responseText = await response.text();
          console.log(`Server error response body: ${responseText}`);
          try {
            const errorData = JSON.parse(responseText);
            errorMessage = errorData.error || errorData.message || errorMessage;
          } catch (e) {
            // If not JSON, show the first part of the response text
            errorMessage = `Server error (${response.status}): ${responseText.substring(0, 100)}${responseText.length > 100 ? '...' : ''}`;
          }
        } catch (e) {
          errorMessage = `Server error (${response.status}). Please try again later.`;
        }
        throw new Error(errorMessage);
      }
      const data = await response.json();
      setResumes(data.resumes || []);
      setIsLiveDb(data.usingDatabase === true);
      if (data.projectId) {
        setActiveProjectId(data.projectId);
      }
      if (data.usingDatabase === false) {
        setDbWarning(data.dbError || "Sandbox persistent database is active.");
      } else {
        setDbWarning(null);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (resumeId: string) => {
    if (!adminPassword) return;
    
    try {
      const response = await fetch('/api/approve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': adminPassword
        },
        body: JSON.stringify({ resumeId }),
      });

      if (!response.ok) {
        if (response.status === 401) handleLogout();
        let errorMessage = 'Failed to approve resume';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (e) {
          errorMessage = `Server error (${response.status}). Please try again later.`;
        }
        throw new Error(errorMessage);
      }

      setResumes(resumes.filter(r => r.id !== resumeId));
      fetchStats().catch(console.error);
      alert('Resume approved! The user can now format their resume.');
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const handleReject = async (resumeId: string) => {
    if (!adminPassword) return;
    
    try {
      const response = await fetch('/api/reject', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': adminPassword
        },
        body: JSON.stringify({ resumeId }),
      });

      if (!response.ok) {
        if (response.status === 401) handleLogout();
        let errorMessage = 'Failed to reject resume';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (e) {
          errorMessage = `Server error (${response.status}). Please try again later.`;
        }
        throw new Error(errorMessage);
      }

      setResumes(resumes.filter(r => r.id !== resumeId));
      fetchStats().catch(console.error);
      alert('Resume rejected.');
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  if (loading && resumes.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!adminPassword) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  if (error) {
    return (
      <div className="p-6 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-red-400 mt-0.5" />
        <div>
          <h3 className="text-red-200 font-semibold">Error loading dashboard</h3>
          <p className="text-red-200/70 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-7xl mx-auto p-4 md:p-6 text-slate-100 font-sans">
      {/* Top Admin Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pb-6 border-b border-white/10">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white flex items-center gap-2 font-display">
              Admin Dashboard
            </h1>
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium border ${
              isLiveDb 
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
            }`}>
              {isLiveDb ? '• Cloud Firestore Live' : '• Local Sandbox Persistent'}
            </span>
          </div>
          <p className="text-slate-400 text-xs mt-1 font-light">
            Manage resume submissions (Ultra-lightweight metadata logging & zero-RAM footprint)
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => { fetchStats(); fetchResumes(); checkHealth(); }}
            className="p-2 bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg transition-colors border border-white/10"
            title="Refresh All Dashboard Data"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={handlePurgeAll}
            className="px-3 py-2 bg-rose-600/20 hover:bg-rose-600/40 border border-rose-500/30 text-rose-300 hover:text-rose-200 rounded-lg text-xs font-semibold transition-all cursor-pointer"
            title="Purge all submission logs & reset memory storage"
          >
            Purge Memory & Logs
          </button>

          {onClose && (
            <button
              onClick={onClose}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-white font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer shadow-[0_0_15px_rgba(99,102,241,0.2)]"
              title="Close Admin Panel"
            >
              Exit Admin
            </button>
          )}
        </div>
      </div>

      {dbWarning && !isLiveDb && (
        <div className="mb-6 flex flex-col gap-4">
          {/* Specific Cloud Firestore API Warnings */}
          {dbWarning.toLowerCase().includes('quota') ? (
            <div className="p-5 bg-amber-500/10 border border-amber-500/20 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <h4 className="font-semibold text-amber-200">Firestore Quota Limit Exceeded</h4>
                  <p className="text-amber-200/70 text-xs mt-1">
                    Your Firebase project <code className="bg-white/5 px-1 py-0.5 rounded font-mono text-amber-300">{activeProjectId}</code> has exceeded its free tier daily read/write quota.
                  </p>
                  <p className="text-slate-400 text-xs mt-2">
                    The database has temporarily gone offline until Google resets the daily quota. The app is currently running in <strong>Bypass Sandbox Mode</strong>. No data will be lost. To avoid quota checks, you can upgrade your Firebase project to the pay-as-you-go (Blaze) plan.
                  </p>
                </div>
              </div>
              <a
                href={`https://console.firebase.google.com/project/${activeProjectId}/usage`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-medium text-xs rounded-lg shadow-md transition-all shrink-0 text-center inline-flex items-center justify-center gap-1.5 whitespace-nowrap self-start md:self-auto"
              >
                View Quota Usage
                <RefreshCw className="w-3.5 h-3.5 animate-pulse" />
              </a>
            </div>
          ) : dbWarning.includes('firestore.googleapis.com') ? (
            <div className="p-5 bg-rose-500/10 border border-rose-500/20 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-rose-400 mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <h4 className="font-semibold text-rose-200">Cloud Firestore API Disabled</h4>
                  <p className="text-rose-200/70 text-xs mt-1">
                    Your Firebase service account uploaded for project <code className="bg-white/5 px-1 py-0.5 rounded font-mono text-rose-300">{activeProjectId}</code> is loaded, but the <strong>Cloud Firestore API</strong> is not enabled in that project.
                  </p>
                  <p className="text-slate-400 text-xs mt-2">
                    The app has safely fallen back to <strong>Local Sandbox Server Mode</strong> and is <strong>fully persisting</strong> everything to <code className="bg-white/5 px-1.5 py-0.5 rounded text-indigo-300 font-mono">resumes_db.json</code>. No actions or data will be lost. To activate Google Cloud Firestore, click the button on the right to enable the API.
                  </p>
                </div>
              </div>
              <a
                href={`https://console.developers.google.com/apis/api/firestore.googleapis.com/overview?project=${activeProjectId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-medium text-xs rounded-lg shadow-md transition-all shrink-0 text-center inline-flex items-center justify-center gap-1.5 whitespace-nowrap self-start md:self-auto"
              >
                Enable Firestore API
                <RefreshCw className="w-3.5 h-3.5 animate-pulse" />
              </a>
            </div>
          ) : (
            <div className="p-4 bg-amber-500/5 border border-amber-500/15 rounded-xl flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-slate-300">
                <span className="font-semibold text-amber-300">Local Sandbox Server Mode:</span> All actions, submissions, logs, and state updates are <strong>fully persisted</strong> inside the local database file (<code className="bg-white/5 px-1 py-0.5 rounded text-indigo-300 font-mono">resumes_db.json</code>) which is 100% saved across restarts.
                <p className="text-slate-400 mt-1">
                  <em>Connection Status Warning:</em> {dbWarning}
                </p>
                <p className="text-slate-400 mt-1">
                  <em>Note for Production Deployment:</em> Direct Cloud Firestore server-side administration requires a private Key Service Account file or a FIREBASE_SERVICE_ACCOUNT environment variable.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stats Widgets Panel */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8 font-sans">
          {/* Card 1: Pending Approval */}
          <div className="glassmorphic-card rounded-2xl p-5 border border-white/[0.04] bg-white/[0.01] hover:bg-white/[0.02] flex items-center gap-4 transition-all">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
              <Clock className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <p className="text-slate-400 text-[10px] font-bold uppercase tracking-wider">Pending Approval</p>
              <h3 className="text-2xl font-black text-white mt-1">{stats.pendingCount}</h3>
              <p className="text-[10px] text-slate-500 mt-0.5">Awaiting review</p>
            </div>
          </div>

          {/* Card 2: Approved Weekly */}
          <div className="glassmorphic-card rounded-2xl p-5 border border-white/[0.04] bg-white/[0.01] hover:bg-white/[0.02] flex items-center gap-4 transition-all">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
              <CheckCircle className="w-5 h-5" />
            </div>
            <div>
              <p className="text-slate-400 text-[10px] font-bold uppercase tracking-wider">Weekly Approved</p>
              <h3 className="text-2xl font-black text-white mt-1">{stats.weeklyApprovedCount}</h3>
              <p className="text-[10px] text-emerald-400/70 mt-0.5">Last 7 days</p>
            </div>
          </div>

          {/* Card 3: Approved Monthly */}
          <div className="glassmorphic-card rounded-2xl p-5 border border-white/[0.04] bg-white/[0.01] hover:bg-white/[0.02] flex items-center gap-4 transition-all">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
              <CheckCircle className="w-5 h-5" />
            </div>
            <div>
              <p className="text-slate-400 text-[10px] font-bold uppercase tracking-wider">Monthly Approved</p>
              <h3 className="text-2xl font-black text-white mt-1">{stats.monthlyApprovedCount}</h3>
              <p className="text-[10px] text-indigo-400/70 mt-0.5">Last 30 days</p>
            </div>
          </div>

          {/* Card 4: Total Approved */}
          <div className="glassmorphic-card rounded-2xl p-5 border border-white/[0.04] bg-white/[0.01] hover:bg-white/[0.02] flex items-center gap-4 transition-all">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <p className="text-slate-400 text-[10px] font-bold uppercase tracking-wider">Total Approved</p>
              <h3 className="text-2xl font-black text-white mt-1">{stats.approvedCount}</h3>
              <p className="text-[10px] text-slate-500 mt-0.5">All-time count</p>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 mb-6 border-b border-white/10 pb-4 font-sans">
        <button
          onClick={() => setStatusFilter('pending')}
          className={`px-4 py-2 rounded-lg text-sm font-bold tracking-wide transition-all uppercase cursor-pointer ${
            statusFilter === 'pending' ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/35 shadow-[0_0_15px_rgba(99,102,241,0.1)]' : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
        >
          Pending
        </button>
        <button
          onClick={() => setStatusFilter('approved')}
          className={`px-4 py-2 rounded-lg text-sm font-bold tracking-wide transition-all uppercase cursor-pointer ${
            statusFilter === 'approved' ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/35 shadow-[0_0_15px_rgba(16,185,129,0.1)]' : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
        >
          Approved
        </button>
        <button
          onClick={() => setStatusFilter('rejected')}
          className={`px-4 py-2 rounded-lg text-sm font-bold tracking-wide transition-all uppercase cursor-pointer ${
            statusFilter === 'rejected' ? 'bg-red-500/15 text-red-300 border border-red-500/35 shadow-[0_0_15px_rgba(239,68,68,0.1)]' : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
        >
          Rejected
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
      ) : resumes.length === 0 ? (
        <div className="glassmorphic-card rounded-[24px] p-12 text-center">
          <CheckCircle className="w-12 h-12 text-emerald-400 mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-bold text-white mb-2">No {statusFilter} resumes</h3>
          <p className="text-slate-400 text-sm font-light">There are currently no resumes in this category.</p>
        </div>
      ) : (
        <div className="grid gap-4 font-sans">
          {resumes.map((resume) => (
            <motion.div
              key={resume.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="glassmorphic-card rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 group"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(99,102,241,0.1)]">
                  <FileText className="w-5 h-5 text-indigo-400" />
                </div>
                <div>
                  <h4 className="text-white font-bold break-all">
                    {(resume as any).fileName || resume.content?.fileName || 'Unnamed Resume'}
                  </h4>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400 mt-1">
                    <span>{new Date(resume.created_at).toLocaleDateString()}</span>
                    <span>•</span>
                    <span className="font-mono bg-white/[0.04] px-1.5 py-0.5 rounded border border-white/[0.06] text-[10.5px]">
                      IP: {resume.ip_address || 'N/A'}
                      {resume.device_info ? ` (${resume.device_info})` : ''}
                    </span>
                  </div>
                </div>
              </div>
              
              {statusFilter === 'pending' && (
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => handleReject(resume.id)}
                    className="px-4 py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-bold uppercase tracking-wider rounded-lg transition-all border border-red-500/25 active:scale-[0.98] cursor-pointer"
                  >
                    Reject
                  </button>
                  <button
                    onClick={() => handleApprove(resume.id)}
                    className="btn-2026-neon px-5 py-2.5 text-white text-xs font-bold uppercase tracking-wider rounded-lg transition-all active:scale-[0.98] cursor-pointer"
                  >
                    Approve
                  </button>
                </div>
              )}
              {statusFilter === 'approved' && (
                <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold uppercase tracking-wider">
                  <CheckCircle className="w-4 h-4" /> Approved
                </div>
              )}
              {statusFilter === 'rejected' && (
                <div className="flex items-center gap-2 text-red-400 text-xs font-bold uppercase tracking-wider">
                  <X className="w-4 h-4" /> 
                  {((resume as any).auto_rejected || resume.content?.auto_rejected) ? 'Auto-Rejected (Timeout)' : 'Rejected'}
                </div>
              )}
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
