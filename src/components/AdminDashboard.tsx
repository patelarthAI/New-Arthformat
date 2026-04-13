import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle, XCircle, Clock, FileText, AlertTriangle, LogOut, X, RefreshCw } from 'lucide-react';
import Login from './Login';

interface PendingResume {
  id: string;
  user_id: string;
  content: any;
  status: string;
  created_at: string;
}

type StatusFilter = 'pending' | 'approved' | 'rejected';

const AdminDashboard: React.FC = () => {
  const [adminPassword, setAdminPassword] = useState<string | null>(() => {
    return localStorage.getItem('adminPassword');
  });
  const [resumes, setResumes] = useState<PendingResume[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [healthStatus, setHealthStatus] = useState<any>(null);
  const [dbWarning, setDbWarning] = useState<string | null>(null);

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
    localStorage.setItem('adminPassword', password);
    setAdminPassword(password);
  };

  const handleLogout = () => {
    localStorage.removeItem('adminPassword');
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
      if (data.usingDatabase === false) {
        setDbWarning(data.dbError || "Database not configured. Using temporary in-memory storage (data will be lost on refresh).");
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
          <h1 className="text-2xl font-bold text-white">Admin Dashboard</h1>
          <p className="text-slate-400 text-sm mt-1">Manage resume submissions</p>
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
        </div>
      </div>

      {dbWarning && (
        <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="text-amber-200 font-semibold">Database Connection Issue</h3>
            <p className="text-amber-200/80 text-sm mt-1">{dbWarning}</p>
            <p className="text-amber-200/80 text-sm mt-2 font-medium">
              If you are on Vercel, make sure you have added NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to your Vercel Environment Variables.
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 mb-6 border-b border-white/10 pb-4">
        <button
          onClick={() => setStatusFilter('pending')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            statusFilter === 'pending' ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
        >
          Pending
        </button>
        <button
          onClick={() => setStatusFilter('approved')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            statusFilter === 'approved' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
        >
          Approved
        </button>
        <button
          onClick={() => setStatusFilter('rejected')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            statusFilter === 'rejected' ? 'bg-red-500/20 text-red-300 border border-red-500/30' : 'text-slate-400 hover:text-white hover:bg-white/5'
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
        <div className="bg-white/5 border border-white/10 rounded-2xl p-12 text-center">
          <CheckCircle className="w-12 h-12 text-emerald-400 mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-medium text-white mb-2">No {statusFilter} resumes</h3>
          <p className="text-slate-400">There are currently no resumes in this category.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {resumes.map((resume) => (
            <motion.div
              key={resume.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white/5 border border-white/10 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 group hover:bg-white/10 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-indigo-500/20 flex items-center justify-center shrink-0">
                  <FileText className="w-5 h-5 text-indigo-400" />
                </div>
                <div>
                  <h4 className="text-white font-medium break-all">
                    {(resume as any).fileName || resume.content?.fileName || 'Unnamed Resume'}
                  </h4>
                  <div className="flex items-center gap-3 text-sm text-slate-400 mt-1">
                    <span>ID: {resume.id.substring(0, 8)}...</span>
                    <span>•</span>
                    <span>{new Date(resume.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
              
              {statusFilter === 'pending' && (
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => handleReject(resume.id)}
                    className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm font-medium rounded-lg transition-colors border border-red-500/20 flex items-center gap-2"
                  >
                    <X className="w-4 h-4" />
                    Reject
                  </button>
                  <button
                    onClick={() => handleApprove(resume.id)}
                    className="px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-sm font-medium rounded-lg transition-colors border border-emerald-500/30 flex items-center gap-2"
                  >
                    <CheckCircle className="w-4 h-4" />
                    Approve
                  </button>
                </div>
              )}
              {statusFilter === 'approved' && (
                <div className="flex items-center gap-2 text-emerald-400 text-sm font-medium">
                  <CheckCircle className="w-4 h-4" /> Approved
                </div>
              )}
              {statusFilter === 'rejected' && (
                <div className="flex items-center gap-2 text-red-400 text-sm font-medium">
                  <XCircle className="w-4 h-4" /> 
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
