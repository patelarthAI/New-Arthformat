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
    <div className="w-full max-w-5xl mx-auto p-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-white tracking-tight">Admin Dashboard</h1>
            {isLiveDb ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-emerald-500/10 text-emerald-400 text-xs font-semibold rounded-full border border-emerald-500/20 shadow-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                Cloud Firestore Live
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-amber-500/10 text-amber-400 text-xs font-semibold rounded-full border border-amber-500/20 shadow-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                Sandbox DB Active
              </span>
            )}
          </div>
          <p className="text-slate-400 text-sm mt-1">Manage resume submissions (100% persistent backend)</p>
        </div>

        <div className="flex items-center gap-4">
          <button 
            onClick={fetchResumes}
            disabled={loading}
            className="p-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-slate-300 transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button 
            onClick={handleLogout}
            className="p-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-slate-300 transition-colors"
            title="Sign Out"
          >
            <LogOut className="w-4 h-4" />
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
          {/* Specific Cloud Firestore API Disabled Warning */}
          {dbWarning.includes('firestore.googleapis.com') ? (
            <div className="p-5 bg-rose-500/10 border border-rose-500/20 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-rose-400 mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <h4 className="font-semibold text-rose-200">Cloud Firestore API Disabled</h4>
                  <p className="text-rose-200/70 text-xs mt-1">
                    Your Firebase service account uploaded for project <code className="bg-white/5 px-1 py-0.5 rounded font-mono text-rose-300">formatai-889f7</code> is loaded, but the <strong>Cloud Firestore API</strong> is not enabled in that project.
                  </p>
                  <p className="text-slate-400 text-xs mt-2">
                    The app has safely fallen back to <strong>Local Sandbox Server Mode</strong> and is <strong>fully persisting</strong> everything to <code className="bg-white/5 px-1.5 py-0.5 rounded text-indigo-300 font-mono">resumes_db.json</code>. No actions or data will be lost. To activate Google Cloud Firestore, click the button on the right to enable the API.
                  </p>
                </div>
              </div>
              <a
                href="https://console.developers.google.com/apis/api/firestore.googleapis.com/overview?project=formatai-889f7"
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
                    <span className="font-mono bg-white/[0.04] px-1.5 py-0.5 rounded border border-white/[0.06] text-[10.5px]">IP: {resume.ip_address || 'N/A'}</span>
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
