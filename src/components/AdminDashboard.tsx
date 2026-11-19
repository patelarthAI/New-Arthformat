import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  CheckCircle, 
  XCircle, 
  Clock, 
  User, 
  UserCheck,
  Search, 
  RefreshCw, 
  Globe, 
  Calendar, 
  AlertTriangle,
  Filter,
  Check, 
  X,
  ChevronLeft,
  ChevronRight,
  Award,
  BarChart3,
  TrendingUp,
  Shield,
  Sparkles,
  Database,
  Lock,
  Unlock,
  KeyRound,
  ShieldAlert,
  Eye,
  EyeOff,
  Flame,
  Trash2
} from 'lucide-react';
import Login from './Login';
import { safeStorage } from '@/utils/safeStorage';

export interface CandidateRecord {
  id: string;
  candidate_name: string;
  recruiter_name?: string;
  status: 'pending' | 'approved' | 'rejected';
  ip_address: string;
  device_info?: string;
  created_at: string;
  approved_at?: string | null;
  rejected_at?: string | null;
}

export interface RecruiterStat {
  name: string;
  total: number;
  approved: number;
  pending: number;
  rejected: number;
}

export interface DashboardStats {
  pendingCount: number;
  approved: {
    today: number;
    week: number;
    month: number;
    allTime: number;
  };
  declined: {
    today: number;
    week: number;
    month: number;
    allTime: number;
  };
  topRecruiters?: RecruiterStat[];
}

export type TimePeriod = 'all' | 'day' | 'week' | 'month' | 'custom';
export type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected';

interface AdminDashboardProps {
  onClose?: () => void;
}

const PAGE_SIZE = 20;

const AdminDashboard: React.FC<AdminDashboardProps> = ({ onClose }) => {
  const [adminPassword, setAdminPassword] = useState<string | null>(() => {
    return safeStorage.getItem('adminPassword');
  });

  const [candidates, setCandidates] = useState<CandidateRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Default to 'pending' as requested: only pending resumes show while approving
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [periodFilter, setPeriodFilter] = useState<TimePeriod>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [recruiterFilter, setRecruiterFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Pagination to prevent Chrome DOM freeze
  const [currentPage, setCurrentPage] = useState(1);

  // Stats
  const [stats, setStats] = useState<DashboardStats>({
    pendingCount: 0,
    approved: { today: 0, week: 0, month: 0, allTime: 0 },
    declined: { today: 0, week: 0, month: 0, allTime: 0 },
    topRecruiters: []
  });

  // Master Memory Cleanup states (Secret / Master Passcode Protected)
  const [showMasterCleanModal, setShowMasterCleanModal] = useState<boolean>(false);
  const [masterKeyInput, setMasterKeyInput] = useState<string>('');
  const [showMasterKey, setShowMasterKey] = useState<boolean>(false);
  const [masterCleanMode, setMasterCleanMode] = useState<'processed' | 'all' | 'declined'>('processed');
  const [masterCleanLoading, setMasterCleanLoading] = useState<boolean>(false);
  const [masterCleanError, setMasterCleanError] = useState<string>('');
  const [masterCleanSuccess, setMasterCleanSuccess] = useState<string>('');

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleLoginSuccess = (password: string) => {
    safeStorage.setItem('adminPassword', password);
    setAdminPassword(password);
  };

  const handleLogout = () => {
    safeStorage.removeItem('adminPassword');
    setAdminPassword(null);
  };

  const fetchStats = async () => {
    if (!adminPassword) return;
    try {
      const response = await fetch(`/api/admin/stats?_t=${Date.now()}`, {
        headers: {
          'x-admin-password': adminPassword,
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
      });
      if (response.ok && isMountedRef.current) {
        const data = await response.json();
        setStats({
          pendingCount: data.pendingCount || 0,
          approved: {
            today: data.approved?.today || 0,
            week: data.approved?.week || 0,
            month: data.approved?.month || 0,
            allTime: data.approved?.allTime ?? (data.approvedCount || 0)
          },
          declined: {
            today: data.declined?.today || 0,
            week: data.declined?.week || 0,
            month: data.declined?.month || 0,
            allTime: data.declined?.allTime ?? (data.rejectedCount || 0)
          },
          topRecruiters: data.topRecruiters || []
        });
      }
    } catch (err) {
      console.error("Failed to fetch dashboard stats:", err);
    }
  };

  const fetchCandidates = async () => {
    if (!adminPassword) return;
    try {
      if (isMountedRef.current) {
        setLoading(true);
        setError(null);
      }
      
      const queryParams = new URLSearchParams();
      if (statusFilter !== 'all') queryParams.append('status', statusFilter);
      if (periodFilter !== 'all' && periodFilter !== 'custom') queryParams.append('period', periodFilter);
      if (startDate) queryParams.append('startDate', startDate);
      if (endDate) queryParams.append('endDate', endDate);
      if (recruiterFilter !== 'all') queryParams.append('recruiter', recruiterFilter);
      queryParams.append('_t', Date.now().toString());

      const response = await fetch(`/api/resumes?${queryParams.toString()}`, {
        headers: {
          'x-admin-password': adminPassword,
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          handleLogout();
          throw new Error('Session expired or unauthorized. Please log in again.');
        }
        throw new Error(`Server returned error (${response.status})`);
      }

      const data = await response.json();
      if (isMountedRef.current) {
        setCandidates(data.resumes || []);
        setCurrentPage(1); // Reset to page 1 on new query
        fetchStats().catch(console.error);
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        setError(err.message || 'Failed to load candidates');
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (adminPassword) {
      fetchCandidates();
    } else {
      setLoading(false);
    }
  }, [adminPassword, statusFilter, periodFilter, startDate, endDate, recruiterFilter]);

  const handleApprove = async (candidateId: string) => {
    if (!adminPassword) return;
    try {
      const response = await fetch('/api/approve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': adminPassword
        },
        body: JSON.stringify({ resumeId: candidateId })
      });
      if (response.ok) {
        setCandidates(prev => prev.map(c => c.id === candidateId ? { ...c, status: 'approved', approved_at: new Date().toISOString() } : c));
        fetchStats();
      }
    } catch (err) {
      console.error("Failed to approve candidate:", err);
    }
  };

  const handleReject = async (candidateId: string) => {
    if (!adminPassword) return;
    try {
      const response = await fetch('/api/reject', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': adminPassword
        },
        body: JSON.stringify({ resumeId: candidateId })
      });
      if (response.ok) {
        setCandidates(prev => prev.map(c => c.id === candidateId ? { ...c, status: 'rejected', rejected_at: new Date().toISOString() } : c));
        fetchStats();
      }
    } catch (err) {
      console.error("Failed to decline candidate:", err);
    }
  };

  const handleExecuteMasterClean = async () => {
    if (!adminPassword) return;
    if (!masterKeyInput.trim()) {
      setMasterKeyError("Master Passcode is required to authorize database cleanup.");
      return;
    }
    
    try {
      setMasterCleanLoading(true);
      setMasterCleanError('');
      setMasterCleanSuccess('');
      
      const response = await fetch('/api/admin/purge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': adminPassword,
          'x-master-key': masterKeyInput.trim()
        },
        body: JSON.stringify({
          mode: masterCleanMode,
          master_key: masterKeyInput.trim()
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to purge database storage.");
      }

      setMasterCleanSuccess(data.message || `Successfully purged records from Firestore memory.`);
      await fetchStats();
      await fetchCandidates();

      setTimeout(() => {
        setShowMasterCleanModal(false);
        setMasterKeyInput('');
        setMasterCleanSuccess('');
      }, 2500);
    } catch (err: any) {
      setMasterCleanError(err.message || "Failed to execute database purge.");
    } finally {
      setMasterCleanLoading(false);
    }
  };

  // Filter candidates by client search term (candidate name, recruiter name, or IP address)
  const filteredCandidates = useMemo(() => {
    if (!searchQuery.trim()) return candidates;
    const query = searchQuery.toLowerCase().trim();
    return candidates.filter(c => 
      (c.candidate_name && c.candidate_name.toLowerCase().includes(query)) ||
      (c.recruiter_name && c.recruiter_name.toLowerCase().includes(query)) ||
      (c.ip_address && c.ip_address.toLowerCase().includes(query)) ||
      (c.device_info && c.device_info.toLowerCase().includes(query))
    );
  }, [candidates, searchQuery]);

  // Paginated candidates to prevent DOM overload and browser freeze
  const totalPages = Math.ceil(filteredCandidates.length / PAGE_SIZE) || 1;
  const paginatedCandidates = useMemo(() => {
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    return filteredCandidates.slice(startIndex, startIndex + PAGE_SIZE);
  }, [filteredCandidates, currentPage]);

  // Click card helper: select period & status
  const selectMetric = (period: TimePeriod, status: StatusFilter) => {
    setPeriodFilter(period);
    setStatusFilter(status);
    setStartDate('');
    setEndDate('');
    setCurrentPage(1);
  };

  // Format date helper
  const formatDate = (isoString?: string | null) => {
    if (!isoString) return 'N/A';
    try {
      const date = new Date(isoString);
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return isoString;
    }
  };

  // Quick preset helper
  const handleQuickPreset = (preset: 'today' | 'yesterday' | 'week' | 'month' | 'all') => {
    const now = new Date();
    setCurrentPage(1);
    if (preset === 'today') {
      const todayStr = now.toISOString().split('T')[0];
      setStartDate(todayStr);
      setEndDate(todayStr);
      setPeriodFilter('custom');
    } else if (preset === 'yesterday') {
      const y = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const yStr = y.toISOString().split('T')[0];
      setStartDate(yStr);
      setEndDate(yStr);
      setPeriodFilter('custom');
    } else if (preset === 'week') {
      const w = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      setStartDate(w.toISOString().split('T')[0]);
      setEndDate(now.toISOString().split('T')[0]);
      setPeriodFilter('custom');
    } else if (preset === 'month') {
      const m = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      setStartDate(m.toISOString().split('T')[0]);
      setEndDate(now.toISOString().split('T')[0]);
      setPeriodFilter('custom');
    } else {
      setStartDate('');
      setEndDate('');
      setPeriodFilter('all');
    }
  };

  if (!adminPassword) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="w-full max-w-7xl mx-auto p-4 md:p-6 text-slate-100 font-sans">
      
      {/* Header Bar - Clean Executive Style (No Delete/Purge Option) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-5 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-[0_0_20px_rgba(99,102,241,0.25)]">
            <Shield className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white font-display">
                Admin Dashboard
              </h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live Audit Log
              </span>
            </div>
            <p className="text-slate-400 text-xs mt-1">
              Real-time candidate approval & recruiter formatting tracker &bull; <span className="text-slate-500">Auto-expires pending after 5 mins</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => {
              setShowMasterCleanModal(true);
              setMasterKeyInput('');
              setMasterKeyError('');
              setMasterCleanSuccess('');
            }}
            className="flex items-center gap-1.5 px-3 py-2.5 bg-slate-800/80 hover:bg-rose-950/40 text-slate-300 hover:text-rose-300 rounded-xl transition-all border border-white/10 hover:border-rose-500/30 cursor-pointer shadow-sm active:scale-95 text-xs font-semibold group"
            title="Clean Firebase Memory & Storage (Master Passcode Protected)"
          >
            <Database className="w-3.5 h-3.5 text-slate-400 group-hover:text-rose-400 transition-colors" />
            <span className="hidden sm:inline">Storage Clean</span>
            <Lock className="w-2.5 h-2.5 text-amber-400/90" />
          </button>

          <button
            onClick={() => { fetchStats(); fetchCandidates(); }}
            className="flex items-center gap-2 px-3.5 py-2.5 bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl transition-all border border-white/10 cursor-pointer shadow-sm active:scale-95 text-xs font-semibold"
            title="Refresh Data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-indigo-400' : ''}`} />
            <span>Refresh</span>
          </button>

          {onClose && (
            <button
              onClick={onClose}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-white font-bold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-[0_0_20px_rgba(99,102,241,0.35)] active:scale-95"
              title="Exit Admin View"
            >
              Exit Admin
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center justify-between text-red-200 text-sm">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button 
            onClick={() => setError(null)} 
            className="text-red-400 hover:text-red-200 text-xs uppercase font-bold"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Top Metrics Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        
        {/* Pending Review Card (Primary focus when approving) */}
        <div className={`glassmorphic-card rounded-2xl p-5 border transition-all flex flex-col justify-between ${
          statusFilter === 'pending'
            ? 'border-amber-500/50 bg-amber-500/[0.08] shadow-[0_0_25px_rgba(245,158,11,0.18)]'
            : 'border-white/[0.06] bg-white/[0.015]'
        }`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-amber-400 animate-pulse" /> Pending Approvals
            </span>
            <span className="text-[10px] text-amber-400/90 font-mono font-bold bg-amber-500/20 px-2 py-0.5 rounded-full border border-amber-500/30">
              Active Focus
            </span>
          </div>
          <div className="mt-2">
            <div className="text-3xl font-black text-amber-300">{stats.pendingCount}</div>
            <p className="text-[11px] text-slate-400 mt-1">Pending approval (auto-declines in 5m)</p>
          </div>
          <button
            onClick={() => { setStatusFilter('pending'); setPeriodFilter('all'); setStartDate(''); setEndDate(''); }}
            className="mt-3 w-full py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm active:scale-95"
          >
            View Pending Only
          </button>
        </div>

        {/* Today Card */}
        <div className="glassmorphic-card rounded-2xl p-5 border border-white/[0.06] bg-white/[0.015] flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-indigo-400" /> Today
            </span>
            <span className="text-[10px] text-slate-500 font-mono">Last 24 Hours</span>
          </div>
          
          <div className="grid grid-cols-2 gap-2 mt-1">
            <button
              onClick={() => selectMetric('day', 'approved')}
              className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                periodFilter === 'day' && statusFilter === 'approved'
                  ? 'bg-emerald-500/20 border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.2)]'
                  : 'bg-emerald-500/5 border-emerald-500/15 hover:bg-emerald-500/10'
              }`}
            >
              <div className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                <Check className="w-3 h-3" /> Approved
              </div>
              <div className="text-xl font-black text-emerald-300 mt-1">{stats.approved.today}</div>
            </button>

            <button
              onClick={() => selectMetric('day', 'rejected')}
              className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                periodFilter === 'day' && statusFilter === 'rejected'
                  ? 'bg-rose-500/20 border-rose-500/50 shadow-[0_0_15px_rgba(244,63,94,0.2)]'
                  : 'bg-rose-500/5 border-rose-500/15 hover:bg-rose-500/10'
              }`}
            >
              <div className="text-[10px] font-semibold text-rose-400 uppercase tracking-wider flex items-center gap-1">
                <X className="w-3 h-3" /> Declined
              </div>
              <div className="text-xl font-black text-rose-300 mt-1">{stats.declined.today}</div>
            </button>
          </div>
        </div>

        {/* This Week Card */}
        <div className="glassmorphic-card rounded-2xl p-5 border border-white/[0.06] bg-white/[0.015] flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-indigo-400" /> This Week
            </span>
            <span className="text-[10px] text-slate-500 font-mono">Last 7 Days</span>
          </div>
          
          <div className="grid grid-cols-2 gap-2 mt-1">
            <button
              onClick={() => selectMetric('week', 'approved')}
              className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                periodFilter === 'week' && statusFilter === 'approved'
                  ? 'bg-emerald-500/20 border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.2)]'
                  : 'bg-emerald-500/5 border-emerald-500/15 hover:bg-emerald-500/10'
              }`}
            >
              <div className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                <Check className="w-3 h-3" /> Approved
              </div>
              <div className="text-xl font-black text-emerald-300 mt-1">{stats.approved.week}</div>
            </button>

            <button
              onClick={() => selectMetric('week', 'rejected')}
              className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                periodFilter === 'week' && statusFilter === 'rejected'
                  ? 'bg-rose-500/20 border-rose-500/50 shadow-[0_0_15px_rgba(244,63,94,0.2)]'
                  : 'bg-rose-500/5 border-rose-500/15 hover:bg-rose-500/10'
              }`}
            >
              <div className="text-[10px] font-semibold text-rose-400 uppercase tracking-wider flex items-center gap-1">
                <X className="w-3 h-3" /> Declined
              </div>
              <div className="text-xl font-black text-rose-300 mt-1">{stats.declined.week}</div>
            </button>
          </div>
        </div>

        {/* All-Time Card */}
        <div className="glassmorphic-card rounded-2xl p-5 border border-white/[0.06] bg-white/[0.015] flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <BarChart3 className="w-3.5 h-3.5 text-indigo-400" /> All-Time Records
            </span>
            <span className="text-[10px] text-slate-500 font-mono">Total Volume</span>
          </div>

          <div className="grid grid-cols-2 gap-2 mt-1">
            <button
              onClick={() => selectMetric('all', 'approved')}
              className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                periodFilter === 'all' && statusFilter === 'approved'
                  ? 'bg-emerald-500/20 border-emerald-500/50'
                  : 'bg-emerald-500/5 border-emerald-500/15 hover:bg-emerald-500/10'
              }`}
            >
              <div className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider">Approved</div>
              <div className="text-xl font-black text-emerald-300 mt-1">{stats.approved.allTime}</div>
            </button>

            <button
              onClick={() => selectMetric('all', 'all')}
              className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                periodFilter === 'all' && statusFilter === 'all'
                  ? 'bg-indigo-500/20 border-indigo-500/50'
                  : 'bg-indigo-500/5 border-indigo-500/15 hover:bg-indigo-500/10'
              }`}
            >
              <div className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wider">Total Resumes</div>
              <div className="text-xl font-black text-indigo-300 mt-1">{stats.approved.allTime + stats.declined.allTime + stats.pendingCount}</div>
            </button>
          </div>
        </div>

      </div>

      {/* Recruiter Leaderboard Bar (Showcases top recruiters by total submissions) */}
      {stats.topRecruiters && stats.topRecruiters.length > 0 && (
        <div className="glassmorphic-card rounded-2xl p-4 md:p-5 border border-cyan-500/25 bg-gradient-to-r from-cyan-950/20 via-slate-900/40 to-indigo-950/20 mb-6 shadow-[0_4px_25px_rgba(6,182,212,0.1)]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 mb-3.5">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-300">
                <Award className="w-4 h-4 text-cyan-400" />
              </div>
              <div>
                <span className="text-xs font-extrabold text-cyan-300 uppercase tracking-wider flex items-center gap-1.5">
                  Recruiter Formatting Leaderboard
                </span>
                <p className="text-[10px] text-slate-400">Click a recruiter to filter candidate records</p>
              </div>
            </div>
            {recruiterFilter !== 'all' && (
              <button
                onClick={() => setRecruiterFilter('all')}
                className="flex items-center gap-1 px-3 py-1 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/50 text-cyan-200 text-xs font-semibold cursor-pointer transition-all active:scale-95 shadow-sm"
              >
                <span>Filter Active: <strong className="text-white">{recruiterFilter}</strong></span>
                <X className="w-3.5 h-3.5 ml-1" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2.5 overflow-x-auto pb-1 scrollbar-thin">
            {stats.topRecruiters.map((r, idx) => {
              const isSelected = recruiterFilter.toLowerCase() === r.name.toLowerCase();
              return (
                <button
                  key={r.name}
                  onClick={() => setRecruiterFilter(isSelected ? 'all' : r.name)}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs whitespace-nowrap transition-all cursor-pointer shrink-0 ${
                    isSelected
                      ? 'bg-cyan-500/30 border-cyan-400 text-white shadow-[0_0_15px_rgba(6,182,212,0.4)] scale-105'
                      : 'bg-slate-900/70 border-white/10 hover:border-cyan-500/40 text-slate-300 hover:text-white hover:bg-slate-850'
                  }`}
                >
                  <span className={`w-5 h-5 rounded-full text-[11px] font-black flex items-center justify-center shadow-sm ${
                    idx === 0 
                      ? 'bg-gradient-to-br from-amber-300 to-amber-500 text-slate-950 font-bold' 
                      : idx === 1 
                      ? 'bg-gradient-to-br from-slate-200 to-slate-400 text-slate-950 font-bold' 
                      : idx === 2 
                      ? 'bg-gradient-to-br from-amber-600 to-amber-800 text-white font-bold' 
                      : 'bg-slate-800 text-slate-300 border border-white/10'
                  }`}>
                    {idx === 0 ? '1' : idx === 1 ? '2' : idx === 2 ? '3' : idx + 1}
                  </span>
                  <span className="font-bold tracking-tight">{r.name}</span>
                  <span className="px-2 py-0.5 rounded-md bg-white/10 text-[10.5px] font-mono font-bold text-cyan-300 border border-white/5">
                    {r.total}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Drill-Down Section: Search, Filters & Candidate Records */}
      <div className="glassmorphic-card rounded-2xl p-5 border border-white/[0.08] bg-white/[0.01]">
        
        {/* Active Filter Headline & Search Controls */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-white/10">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <User className="w-4 h-4 text-indigo-400" />
                <span>Candidate Submissions</span>
              </h2>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-white/10 text-slate-200 font-mono font-bold border border-white/10">
                {filteredCandidates.length} matches
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Status: <span className="text-indigo-300 font-medium capitalize">{statusFilter === 'all' ? 'All (Historical)' : statusFilter}</span>
              {' • '}
              Period: <span className="text-indigo-300 font-medium">
                {startDate && endDate 
                  ? `${startDate} to ${endDate}` 
                  : periodFilter === 'day' ? 'Today' : periodFilter === 'week' ? 'This Week' : periodFilter === 'month' ? 'This Month' : 'All Time'}
              </span>
              {recruiterFilter !== 'all' && (
                <>
                  {' • '}
                  Recruiter: <span className="text-cyan-300 font-bold">{recruiterFilter}</span>
                </>
              )}
            </p>
          </div>

          {/* Search Input */}
          <div className="relative min-w-[260px] md:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              placeholder="Search candidate, recruiter or IP..."
              className="w-full pl-10 pr-8 py-2.5 bg-slate-900/70 border border-white/15 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all shadow-inner"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Date Filter & Preset Controls */}
        <div className="py-3.5 border-b border-white/10 flex flex-wrap items-center justify-between gap-3 text-xs">
          
          {/* Quick Date Presets */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-slate-400 text-[11px] font-bold uppercase mr-1 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-indigo-400" /> Filter Date:
            </span>
            <button
              onClick={() => handleQuickPreset('today')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                startDate === new Date().toISOString().split('T')[0] && endDate === new Date().toISOString().split('T')[0]
                  ? 'bg-indigo-600 text-white shadow-[0_0_12px_rgba(99,102,241,0.35)]'
                  : 'bg-white/5 hover:bg-white/10 text-slate-300'
              }`}
            >
              Today
            </button>
            <button
              onClick={() => handleQuickPreset('yesterday')}
              className="px-3 py-1.5 rounded-lg font-semibold bg-white/5 hover:bg-white/10 text-slate-300 transition-all cursor-pointer"
            >
              Yesterday
            </button>
            <button
              onClick={() => handleQuickPreset('week')}
              className="px-3 py-1.5 rounded-lg font-semibold bg-white/5 hover:bg-white/10 text-slate-300 transition-all cursor-pointer"
            >
              Last 7 Days
            </button>
            <button
              onClick={() => handleQuickPreset('month')}
              className="px-3 py-1.5 rounded-lg font-semibold bg-white/5 hover:bg-white/10 text-slate-300 transition-all cursor-pointer"
            >
              Last 30 Days
            </button>
            <button
              onClick={() => handleQuickPreset('all')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                !startDate && !endDate && periodFilter === 'all'
                  ? 'bg-indigo-600 text-white shadow-[0_0_12px_rgba(99,102,241,0.35)]'
                  : 'bg-white/5 hover:bg-white/10 text-slate-300'
              }`}
            >
              All Time
            </button>
          </div>

          {/* Custom Date Pickers */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 bg-slate-900/70 border border-white/15 px-3 py-1.5 rounded-xl shadow-inner">
              <span className="text-[10px] text-slate-400 uppercase font-mono font-bold">From</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => { setStartDate(e.target.value); setPeriodFilter('custom'); setCurrentPage(1); }}
                className="bg-transparent text-white text-xs focus:outline-none [color-scheme:dark] cursor-pointer"
              />
            </div>
            <div className="flex items-center gap-1.5 bg-slate-900/70 border border-white/15 px-3 py-1.5 rounded-xl shadow-inner">
              <span className="text-[10px] text-slate-400 uppercase font-mono font-bold">To</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => { setEndDate(e.target.value); setPeriodFilter('custom'); setCurrentPage(1); }}
                className="bg-transparent text-white text-xs focus:outline-none [color-scheme:dark] cursor-pointer"
              />
            </div>
            {(startDate || endDate) && (
              <button
                onClick={() => { setStartDate(''); setEndDate(''); setPeriodFilter('all'); }}
                className="p-1.5 text-slate-400 hover:text-white bg-white/10 hover:bg-white/20 rounded-lg cursor-pointer transition-colors"
                title="Clear date range"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Status Filter Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 py-3 border-b border-white/5 text-xs">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-slate-400 text-[11px] font-bold uppercase mr-1">Status:</span>
            {(['pending', 'approved', 'rejected', 'all'] as StatusFilter[]).map((st) => (
              <button
                key={st}
                onClick={() => { setStatusFilter(st); setCurrentPage(1); }}
                className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer capitalize text-xs ${
                  statusFilter === st
                    ? st === 'pending'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50 shadow-[0_0_12px_rgba(245,158,11,0.25)]'
                      : st === 'approved' 
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 shadow-[0_0_12px_rgba(16,185,129,0.25)]' 
                      : st === 'rejected' 
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/50 shadow-[0_0_12px_rgba(244,63,94,0.25)]' 
                      : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/50 shadow-[0_0_12px_rgba(99,102,241,0.25)]'
                    : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
              >
                {st === 'pending' ? 'Pending (Default)' : st === 'rejected' ? 'Declined' : st === 'all' ? 'All (Historical)' : st}
              </button>
            ))}
          </div>

          {/* Showing Count */}
          <div className="text-[11px] text-slate-400 font-mono">
            Showing {filteredCandidates.length > 0 ? (currentPage - 1) * PAGE_SIZE + 1 : 0} - {Math.min(currentPage * PAGE_SIZE, filteredCandidates.length)} of {filteredCandidates.length}
          </div>
        </div>

        {/* Candidate List Rows */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <RefreshCw className="w-8 h-8 animate-spin text-indigo-400 mb-3" />
            <p className="text-xs">Loading candidate records...</p>
          </div>
        ) : filteredCandidates.length === 0 ? (
          <div className="text-center py-16 px-4">
            <User className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <h3 className="text-base font-bold text-white mb-1">No candidate records found</h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto font-light">
              {statusFilter === 'pending'
                ? "No pending resumes waiting for approval. (Pending submissions automatically decline after 5 minutes of inactivity)."
                : searchQuery 
                ? `No submissions matched "${searchQuery}". Try clearing the search query.` 
                : `There are no candidate submissions under "${statusFilter}".`}
            </p>
            {(statusFilter !== 'pending' || periodFilter !== 'all' || startDate || endDate || recruiterFilter !== 'all' || searchQuery) && (
              <button
                onClick={() => { setStatusFilter('pending'); setPeriodFilter('all'); setStartDate(''); setEndDate(''); setRecruiterFilter('all'); setSearchQuery(''); }}
                className="mt-4 px-3.5 py-1.5 bg-white/10 hover:bg-white/15 rounded-lg text-xs font-semibold text-slate-200 transition-colors cursor-pointer"
              >
                Reset to Pending Submissions
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04] mt-2">
            {paginatedCandidates.map((candidate) => (
              <motion.div
                key={candidate.id}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className="py-4 px-3 hover:bg-white/[0.025] rounded-xl transition-all flex flex-col md:flex-row md:items-center justify-between gap-3 group"
              >
                {/* Candidate Info */}
                <div className="flex items-start sm:items-center gap-3.5">
                  <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 border ${
                    candidate.status === 'approved'
                      ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.15)]'
                      : candidate.status === 'rejected'
                      ? 'bg-rose-500/10 border-rose-500/25 text-rose-400 shadow-[0_0_12px_rgba(244,63,94,0.15)]'
                      : 'bg-amber-500/10 border-amber-500/25 text-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.15)]'
                  }`}>
                    <User className="w-5 h-5" />
                  </div>

                  <div>
                    {/* Candidate Name & Recruiter Pill */}
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="text-white font-extrabold text-[14px] tracking-wide">
                        {candidate.candidate_name || 'Candidate Submission'}
                      </span>
                      
                      {/* Recruiter Badge */}
                      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-cyan-300 bg-cyan-950/60 px-2.5 py-0.5 rounded-lg border border-cyan-500/30 shadow-sm">
                        <UserCheck className="w-3.5 h-3.5 text-cyan-400" />
                        <span>Recruiter: <strong className="text-white">{candidate.recruiter_name || 'Direct Recruiter'}</strong></span>
                      </span>

                      {/* Status Tag */}
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full border flex items-center gap-1 ${
                        candidate.status === 'approved'
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35'
                          : candidate.status === 'rejected'
                          ? 'bg-rose-500/15 text-rose-300 border-rose-500/35'
                          : 'bg-amber-500/15 text-amber-300 border-amber-500/35'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          candidate.status === 'approved' ? 'bg-emerald-400 animate-pulse' : candidate.status === 'rejected' ? 'bg-rose-400' : 'bg-amber-400 animate-pulse'
                        }`} />
                        {candidate.status === 'rejected' ? 'Declined' : candidate.status}
                      </span>
                    </div>

                    {/* Metadata: From IP & Date */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400 mt-1 font-sans">
                      <span className="flex items-center gap-1 text-indigo-300 font-mono text-[11px]">
                        <Globe className="w-3 h-3 text-indigo-400" />
                        From IP: {candidate.ip_address || 'Unknown IP'}
                      </span>
                      <span>•</span>
                      <span className="flex items-center gap-1 text-slate-400 text-[11px]">
                        <Calendar className="w-3 h-3 text-slate-500" />
                        {formatDate(
                          candidate.status === 'approved' 
                            ? (candidate.approved_at || candidate.created_at)
                            : candidate.status === 'rejected'
                            ? (candidate.rejected_at || candidate.created_at)
                            : candidate.created_at
                        )}
                      </span>
                      {candidate.device_info && (
                        <>
                          <span>•</span>
                          <span className="text-[11px] text-slate-500">{candidate.device_info}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right Action Controls - Approve/Decline for Pending only. NO DELETE BUTTON anywhere! */}
                <div className="flex items-center gap-2 self-end md:self-auto shrink-0">
                  {candidate.status === 'pending' && (
                    <>
                      <button
                        onClick={() => handleReject(candidate.id)}
                        className="px-4 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer active:scale-95 shadow-sm"
                      >
                        Decline
                      </button>
                      <button
                        onClick={() => handleApprove(candidate.id)}
                        className="btn-2026-neon px-5 py-2 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer active:scale-95 shadow-[0_0_20px_rgba(16,185,129,0.35)]"
                      >
                        Approve
                      </button>
                    </>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {/* Pagination Bar */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-4 mt-4 border-t border-white/10 text-xs">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className={`flex items-center gap-1 px-3.5 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                currentPage === 1 
                  ? 'border-white/5 text-slate-600 cursor-not-allowed' 
                  : 'border-white/15 text-slate-200 hover:bg-white/10 cursor-pointer active:scale-95'
              }`}
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Previous
            </button>

            <span className="text-slate-400 font-mono">
              Page <strong className="text-white font-bold">{currentPage}</strong> of <strong className="text-white font-bold">{totalPages}</strong>
            </span>

            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className={`flex items-center gap-1 px-3.5 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                currentPage === totalPages 
                  ? 'border-white/5 text-slate-600 cursor-not-allowed' 
                  : 'border-white/15 text-slate-200 hover:bg-white/10 cursor-pointer active:scale-95'
              }`}
            >
              Next <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

      </div>

      {/* Master Memory & Storage Clean Modal (Protected by Master Passcode) */}
      <AnimatePresence>
        {showMasterCleanModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xl"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              className="bg-slate-950/95 rounded-[28px] border border-rose-500/25 max-w-lg w-full p-6 text-white shadow-[0_0_60px_rgba(244,63,94,0.2)] relative overflow-hidden"
            >
              {/* Top Accent Gradient Bar */}
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-rose-500 via-amber-500 to-indigo-500" />

              {/* Close Button */}
              <button
                onClick={() => {
                  if (!masterCleanLoading) {
                    setShowMasterCleanModal(false);
                    setMasterKeyError('');
                    setMasterCleanSuccess('');
                  }
                }}
                className="absolute top-5 right-5 p-2 text-slate-400 hover:text-white rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>

              {/* Modal Header */}
              <div className="flex items-center gap-3.5 mb-5">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-rose-500/20 to-amber-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400 shadow-[0_0_20px_rgba(244,63,94,0.25)]">
                  <ShieldAlert className="w-6 h-6 text-rose-400" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white font-display flex items-center gap-2">
                    Database Storage Cleanup
                  </h3>
                  <p className="text-xs text-rose-300/80">
                    Super-Admin Authorization &bull; Reclaims Database Storage
                  </p>
                </div>
              </div>

              {/* Cleanup Scope Selection */}
              <div className="space-y-2 mb-5">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                  Select Cleanup Scope
                </label>
                
                {/* Option 1: Purge Processed History (Recommended) */}
                <div 
                  onClick={() => setMasterCleanMode('processed')}
                  className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${
                    masterCleanMode === 'processed' 
                      ? 'bg-indigo-950/40 border-indigo-500/80 text-white shadow-[0_0_20px_rgba(99,102,241,0.2)]' 
                      : 'bg-slate-900/40 border-white/10 text-slate-300 hover:border-white/20'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs flex items-center gap-2">
                      🧹 Purge Approved & Declined History
                      <span className="text-[9.5px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-bold">Recommended</span>
                    </span>
                    <input 
                      type="radio" 
                      name="cleanScope" 
                      checked={masterCleanMode === 'processed'} 
                      onChange={() => setMasterCleanMode('processed')} 
                      className="accent-indigo-500" 
                    />
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
                    Clears completed resumes and frees database memory. Active <strong>pending submissions stay safe</strong>.
                  </p>
                </div>

                {/* Option 2: Complete Factory Purge */}
                <div 
                  onClick={() => setMasterCleanMode('all')}
                  className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${
                    masterCleanMode === 'all' 
                      ? 'bg-rose-950/40 border-rose-500/80 text-white shadow-[0_0_20px_rgba(244,63,94,0.2)]' 
                      : 'bg-slate-900/40 border-white/10 text-slate-300 hover:border-white/20'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs flex items-center gap-2 text-rose-300">
                      ⚡ Complete Factory Purge (Wipe All Records)
                    </span>
                    <input 
                      type="radio" 
                      name="cleanScope" 
                      checked={masterCleanMode === 'all'} 
                      onChange={() => setMasterCleanMode('all')} 
                      className="accent-rose-500" 
                    />
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
                    Completely erases all candidate records, names, activity logs, and counters to reset database to 0.
                  </p>
                </div>

                {/* Option 3: Declined Only */}
                <div 
                  onClick={() => setMasterCleanMode('declined')}
                  className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${
                    masterCleanMode === 'declined' 
                      ? 'bg-amber-950/30 border-amber-500/80 text-white shadow-[0_0_20px_rgba(245,158,11,0.2)]' 
                      : 'bg-slate-900/40 border-white/10 text-slate-300 hover:border-white/20'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs flex items-center gap-2 text-amber-300">
                      ⏱️ Purge Expired & Declined Only
                    </span>
                    <input 
                      type="radio" 
                      name="cleanScope" 
                      checked={masterCleanMode === 'declined'} 
                      onChange={() => setMasterCleanMode('declined')} 
                      className="accent-amber-500" 
                    />
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
                    Removes all 5-minute timed-out and rejected candidate entries.
                  </p>
                </div>
              </div>

              {/* Master Passcode Input */}
              <div className="mb-5">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 mb-2">
                  <KeyRound className="w-3.5 h-3.5 text-rose-400" />
                  Enter Master Passcode
                </label>
                
                <div className="relative">
                  <input
                    type={showMasterKey ? "text" : "password"}
                    value={masterKeyInput}
                    onChange={(e) => {
                      setMasterKeyInput(e.target.value);
                      setMasterKeyError('');
                    }}
                    placeholder="Enter Master Passcode..."
                    className="w-full bg-slate-900/80 border border-white/15 focus:border-rose-400 rounded-2xl px-4 py-3 text-sm text-white placeholder-slate-500 outline-none pr-11 font-mono transition-colors shadow-inner"
                  />
                  <button
                    type="button"
                    onClick={() => setShowMasterKey(prev => !prev)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                  >
                    {showMasterKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Error Alert */}
              {masterCleanError && (
                <div className="p-3.5 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs mb-4 flex items-center gap-2.5">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                  <span>{masterCleanError}</span>
                </div>
              )}

              {/* Success Alert */}
              {masterCleanSuccess && (
                <div className="p-3.5 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs mb-4 flex items-center gap-2.5">
                  <CheckCircle className="w-4 h-4 shrink-0 text-emerald-400" />
                  <span>{masterCleanSuccess}</span>
                </div>
              )}

              {/* Modal Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-1">
                <button
                  type="button"
                  disabled={masterCleanLoading}
                  onClick={() => {
                    setShowMasterCleanModal(false);
                    setMasterKeyError('');
                    setMasterCleanSuccess('');
                  }}
                  className="px-5 py-2.5 rounded-xl border border-white/10 hover:bg-white/5 text-slate-300 text-xs font-semibold cursor-pointer transition-colors"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  disabled={masterCleanLoading || !masterKeyInput.trim()}
                  onClick={handleExecuteMasterClean}
                  className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider text-white transition-all shadow-lg cursor-pointer ${
                    masterCleanLoading || !masterKeyInput.trim()
                      ? 'bg-rose-900/50 border border-rose-500/20 text-rose-300 cursor-not-allowed opacity-50'
                      : 'bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 border border-rose-400/30 shadow-[0_0_20px_rgba(244,63,94,0.35)] active:scale-95'
                  }`}
                >
                  {masterCleanLoading ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-white" />
                      <span>Purging Storage...</span>
                    </>
                  ) : (
                    <>
                      <Flame className="w-3.5 h-3.5 text-white" />
                      <span>Purge Database Storage</span>
                    </>
                  )}
                </button>
              </div>

            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AdminDashboard;
