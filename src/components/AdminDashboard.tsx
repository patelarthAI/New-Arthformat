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
      
      {/* Header Bar - Clean Executive Style */}
      <div className="flex items-center justify-between pb-5 mb-6 border-b border-white/[0.08]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.15)]">
            <Shield className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-white font-display">
                Admin Console
              </h1>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" title="System Live" />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setShowMasterCleanModal(true);
              setMasterKeyInput('');
              setMasterKeyError('');
              setMasterCleanSuccess('');
            }}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-900/80 hover:bg-rose-950/30 text-slate-400 hover:text-rose-300 rounded-xl transition-all border border-white/10 hover:border-rose-500/30 text-xs font-medium cursor-pointer shadow-sm active:scale-95 group"
            title="Purge Storage (Master Protected)"
          >
            <Database className="w-3.5 h-3.5 text-slate-400 group-hover:text-rose-400 transition-colors" />
            <span className="hidden sm:inline">Purge</span>
            <Lock className="w-2.5 h-2.5 opacity-60" />
          </button>

          <button
            onClick={() => { fetchStats(); fetchCandidates(); }}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-900/80 hover:bg-slate-800 text-slate-300 hover:text-white rounded-xl transition-all border border-white/10 text-xs font-medium cursor-pointer shadow-sm active:scale-95"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-indigo-400' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>

          {onClose && (
            <button
              onClick={onClose}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold tracking-wide transition-all cursor-pointer shadow-[0_0_15px_rgba(99,102,241,0.25)] active:scale-95"
            >
              Exit
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

      {/* Top Metrics Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {/* Pending Card */}
        <button
          onClick={() => { setStatusFilter('pending'); setPeriodFilter('all'); setStartDate(''); setEndDate(''); }}
          className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
            statusFilter === 'pending'
              ? 'bg-amber-500/[0.08] border-amber-500/40 shadow-[0_0_20px_rgba(245,158,11,0.15)]'
              : 'bg-slate-900/40 border-white/[0.06] hover:border-white/15'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-400 mb-1">
            <span className="flex items-center gap-1.5">
              <Clock className={`w-3.5 h-3.5 ${stats.pendingCount > 0 ? 'text-amber-400 animate-pulse' : 'text-slate-500'}`} />
              Pending
            </span>
            {stats.pendingCount > 0 && (
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
            )}
          </div>
          <div className="text-2xl font-bold font-mono text-amber-300 tracking-tight">
            {stats.pendingCount}
          </div>
        </button>

        {/* Today */}
        <div className="p-4 rounded-2xl border border-white/[0.06] bg-slate-900/40 text-left">
          <div className="text-xs font-medium text-slate-400 mb-1 flex items-center justify-between">
            <span>Today</span>
            <span className="text-[10px] font-mono text-slate-500">24h</span>
          </div>
          <div className="flex items-baseline gap-2 text-xl font-mono">
            <span className="text-emerald-400 font-bold">{stats.approved.today}</span>
            <span className="text-slate-600 text-xs">/</span>
            <span className="text-rose-400/80 text-sm">{stats.declined.today}</span>
            <span className="text-[10px] text-slate-500 font-sans ml-auto">Appr / Decl</span>
          </div>
        </div>

        {/* 7 Days */}
        <div className="p-4 rounded-2xl border border-white/[0.06] bg-slate-900/40 text-left">
          <div className="text-xs font-medium text-slate-400 mb-1 flex items-center justify-between">
            <span>7 Days</span>
            <span className="text-[10px] font-mono text-slate-500">Week</span>
          </div>
          <div className="flex items-baseline gap-2 text-xl font-mono">
            <span className="text-emerald-400 font-bold">{stats.approved.week}</span>
            <span className="text-slate-600 text-xs">/</span>
            <span className="text-rose-400/80 text-sm">{stats.declined.week}</span>
            <span className="text-[10px] text-slate-500 font-sans ml-auto">Appr / Decl</span>
          </div>
        </div>

        {/* All-Time */}
        <div className="p-4 rounded-2xl border border-white/[0.06] bg-slate-900/40 text-left">
          <div className="text-xs font-medium text-slate-400 mb-1 flex items-center justify-between">
            <span>All Time</span>
            <span className="text-[10px] font-mono text-slate-500">Total</span>
          </div>
          <div className="flex items-baseline gap-2 text-xl font-mono">
            <span className="text-indigo-400 font-bold">{stats.approved.allTime}</span>
            <span className="text-slate-600 text-xs">/</span>
            <span className="text-slate-400 text-sm">{stats.approved.allTime + stats.declined.allTime + stats.pendingCount}</span>
            <span className="text-[10px] text-slate-500 font-sans ml-auto">Passed / Total</span>
          </div>
        </div>
      </div>

      {/* Recruiter Leaderboard Strip */}
      {stats.topRecruiters && stats.topRecruiters.length > 0 && (
        <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-1 scrollbar-none">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider shrink-0 mr-1 flex items-center gap-1.5">
            <Award className="w-3.5 h-3.5 text-cyan-400" />
            Recruiters:
          </span>
          {stats.topRecruiters.map((r, idx) => {
            const isSelected = recruiterFilter.toLowerCase() === r.name.toLowerCase();
            return (
              <button
                key={r.name}
                onClick={() => setRecruiterFilter(isSelected ? 'all' : r.name)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs whitespace-nowrap transition-all cursor-pointer shrink-0 ${
                  isSelected
                    ? 'bg-cyan-500/20 border-cyan-400 text-white shadow-[0_0_12px_rgba(6,182,212,0.3)]'
                    : 'bg-slate-900/60 border-white/10 hover:border-white/20 text-slate-300 hover:text-white'
                }`}
              >
                <span className="w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center bg-white/10 font-mono">
                  {idx + 1}
                </span>
                <span className="font-medium">{r.name}</span>
                <span className="px-1.5 py-0.5 rounded bg-white/10 text-[10px] font-mono text-cyan-300">
                  {r.total}
                </span>
              </button>
            );
          })}
          {recruiterFilter !== 'all' && (
            <button
              onClick={() => setRecruiterFilter('all')}
              className="px-2 py-1 text-[11px] text-slate-400 hover:text-white underline cursor-pointer shrink-0"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Candidates Management Console */}
      <div className="bg-slate-950/40 border border-white/[0.08] rounded-2xl p-5">
        
        {/* Filter & Search Toolbar */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-4 border-b border-white/[0.06]">
          {/* Status Tabs */}
          <div className="flex items-center gap-1 p-1 bg-slate-900/80 rounded-xl border border-white/[0.06]">
            {(['pending', 'approved', 'rejected', 'all'] as StatusFilter[]).map((st) => (
              <button
                key={st}
                onClick={() => { setStatusFilter(st); setCurrentPage(1); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all cursor-pointer ${
                  statusFilter === st
                    ? st === 'pending'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                      : st === 'approved'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                      : st === 'rejected'
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-sm'
                      : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {st === 'rejected' ? 'Declined' : st === 'all' ? 'All' : st}
              </button>
            ))}
          </div>

          {/* Quick Dates & Search */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Quick Date Presets */}
            <div className="flex items-center gap-1 text-xs">
              {(['today', 'week', 'month', 'all'] as const).map((pr) => {
                const label = pr === 'today' ? 'Today' : pr === 'week' ? '7D' : pr === 'month' ? '30D' : 'All Time';
                const isActive = (pr === 'all' && !startDate && !endDate && periodFilter === 'all') ||
                  (pr === 'today' && startDate === new Date().toISOString().split('T')[0] && endDate === new Date().toISOString().split('T')[0]);
                return (
                  <button
                    key={pr}
                    onClick={() => handleQuickPreset(pr)}
                    className={`px-2.5 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
                      isActive
                        ? 'bg-white/15 text-white'
                        : 'text-slate-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Search Input */}
            <div className="relative min-w-[200px] sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                placeholder="Search..."
                className="w-full pl-8 pr-7 py-1.5 bg-slate-900/60 border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Candidates List Rows */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <RefreshCw className="w-6 h-6 animate-spin text-indigo-400 mb-2" />
            <p className="text-xs">Loading...</p>
          </div>
        ) : filteredCandidates.length === 0 ? (
          <div className="py-16 text-center">
            <div className="w-12 h-12 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center text-slate-500 mx-auto mb-3">
              <CheckCircle className="w-5 h-5 text-slate-500" />
            </div>
            <p className="text-sm font-semibold text-slate-300">Queue is clear</p>
            <p className="text-xs text-slate-500 mt-0.5">No candidate authorizations found.</p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {paginatedCandidates.map((candidate) => (
              <motion.div
                key={candidate.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="py-3.5 px-2 hover:bg-white/[0.02] rounded-xl transition-all flex flex-col md:flex-row md:items-center justify-between gap-3"
              >
                {/* Candidate Info */}
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
                    candidate.status === 'approved'
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                      : candidate.status === 'rejected'
                      ? 'bg-rose-500/10 border-rose-500/20 text-rose-400'
                      : 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                  }`}>
                    <User className="w-4 h-4" />
                  </div>

                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white font-bold text-sm tracking-tight">
                        {candidate.candidate_name || 'Candidate Submission'}
                      </span>
                      
                      <span className="text-[11px] text-cyan-300 bg-cyan-950/40 px-2 py-0.5 rounded-md border border-cyan-500/20">
                        {candidate.recruiter_name || 'Direct Recruiter'}
                      </span>

                      <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border flex items-center gap-1 ${
                        candidate.status === 'approved'
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                          : candidate.status === 'rejected'
                          ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                          : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          candidate.status === 'approved' ? 'bg-emerald-400' : candidate.status === 'rejected' ? 'bg-rose-400' : 'bg-amber-400 animate-pulse'
                        }`} />
                        {candidate.status === 'rejected' ? 'Declined' : candidate.status}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5 font-mono">
                      <span>{candidate.ip_address || 'IP N/A'}</span>
                      <span>&bull;</span>
                      <span>
                        {formatDate(
                          candidate.status === 'approved' 
                            ? (candidate.approved_at || candidate.created_at)
                            : candidate.status === 'rejected'
                            ? (candidate.rejected_at || candidate.created_at)
                            : candidate.created_at
                        )}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right Action Controls */}
                <div className="flex items-center gap-2 shrink-0 self-end md:self-auto">
                  {candidate.status === 'pending' && (
                    <>
                      <button
                        onClick={() => handleReject(candidate.id)}
                        className="px-3.5 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/20 rounded-lg text-xs font-semibold cursor-pointer transition-colors"
                      >
                        Decline
                      </button>
                      <button
                        onClick={() => handleApprove(candidate.id)}
                        className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold cursor-pointer shadow-sm transition-all"
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
          <div className="flex items-center justify-between pt-4 mt-3 border-t border-white/[0.06] text-xs">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className={`flex items-center gap-1 px-3 py-1 rounded-lg border text-xs font-medium transition-all ${
                currentPage === 1 
                  ? 'border-white/5 text-slate-600 cursor-not-allowed' 
                  : 'border-white/10 text-slate-300 hover:bg-white/5 cursor-pointer'
              }`}
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Prev
            </button>

            <span className="text-slate-500 font-mono text-[11px]">
              {currentPage} / {totalPages}
            </span>

            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className={`flex items-center gap-1 px-3 py-1 rounded-lg border text-xs font-medium transition-all ${
                currentPage === totalPages 
                  ? 'border-white/5 text-slate-600 cursor-not-allowed' 
                  : 'border-white/10 text-slate-300 hover:bg-white/5 cursor-pointer'
              }`}
            >
              Next <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

      </div>

      {/* Master Purge Modal (Ultra-Clean, Zero Wordy Junk) */}
      <AnimatePresence>
        {showMasterCleanModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              className="bg-slate-950 border border-white/15 rounded-2xl max-w-sm w-full p-5 text-white shadow-2xl relative"
            >
              <button
                onClick={() => {
                  if (!masterCleanLoading) {
                    setShowMasterCleanModal(false);
                    setMasterKeyError('');
                    setMasterCleanSuccess('');
                  }
                }}
                className="absolute top-4 right-4 text-slate-500 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>

              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-8 h-8 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
                  <Flame className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Database Purge</h3>
                  <p className="text-[11px] text-slate-400">Master Passcode Required</p>
                </div>
              </div>

              {/* Scope Segmented Options */}
              <div className="space-y-1.5 mb-4">
                {[
                  { id: 'processed', label: 'Completed (Keeps Pending)' },
                  { id: 'all', label: 'Factory Reset (All Records)' },
                  { id: 'declined', label: 'Declined & Expired Only' }
                ].map(opt => (
                  <div
                    key={opt.id}
                    onClick={() => setMasterCleanMode(opt.id as any)}
                    className={`px-3 py-2.5 rounded-xl border text-xs font-medium flex items-center justify-between cursor-pointer transition-all ${
                      masterCleanMode === opt.id
                        ? 'bg-indigo-600/20 border-indigo-500 text-white'
                        : 'bg-slate-900/60 border-white/5 text-slate-400 hover:border-white/15'
                    }`}
                  >
                    <span>{opt.label}</span>
                    <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                      masterCleanMode === opt.id ? 'border-indigo-400' : 'border-slate-600'
                    }`}>
                      {masterCleanMode === opt.id && <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />}
                    </div>
                  </div>
                ))}
              </div>

              {/* Passcode Input - ZERO hints or visible passwords */}
              <div className="mb-4">
                <div className="relative">
                  <input
                    type={showMasterKey ? "text" : "password"}
                    value={masterKeyInput}
                    onChange={(e) => {
                      setMasterKeyInput(e.target.value);
                      setMasterKeyError('');
                    }}
                    placeholder="Master Passcode"
                    className="w-full bg-slate-900 border border-white/15 focus:border-rose-400 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 outline-none pr-9 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowMasterKey(prev => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white cursor-pointer"
                  >
                    {showMasterKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Feedback Alerts */}
              {masterCleanError && (
                <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs mb-3 flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-rose-400" />
                  <span>{masterCleanError}</span>
                </div>
              )}
              {masterCleanSuccess && (
                <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs mb-3 flex items-center gap-2">
                  <CheckCircle className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                  <span>{masterCleanSuccess}</span>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={masterCleanLoading}
                  onClick={() => {
                    setShowMasterCleanModal(false);
                    setMasterKeyError('');
                    setMasterCleanSuccess('');
                  }}
                  className="px-3.5 py-2 rounded-xl border border-white/10 hover:bg-white/5 text-slate-400 hover:text-white text-xs font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={masterCleanLoading || !masterKeyInput.trim()}
                  onClick={handleExecuteMasterClean}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold text-white transition-all cursor-pointer ${
                    masterCleanLoading || !masterKeyInput.trim()
                      ? 'bg-rose-900/40 text-rose-400/50 cursor-not-allowed'
                      : 'bg-rose-600 hover:bg-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.3)]'
                  }`}
                >
                  {masterCleanLoading ? 'Purging...' : 'Purge'}
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
