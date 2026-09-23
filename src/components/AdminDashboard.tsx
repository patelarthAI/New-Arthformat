import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  CheckCircle, 
  XCircle, 
  Clock, 
  User, 
  Search, 
  RefreshCw, 
  Trash2, 
  Globe, 
  Calendar, 
  AlertTriangle,
  Filter,
  Check,
  X
} from 'lucide-react';
import Login from './Login';
import { safeStorage } from '@/utils/safeStorage';

export interface CandidateRecord {
  id: string;
  candidate_name: string;
  status: 'pending' | 'approved' | 'rejected';
  ip_address: string;
  device_info?: string;
  created_at: string;
  approved_at?: string | null;
  rejected_at?: string | null;
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
}

export type TimePeriod = 'all' | 'day' | 'week' | 'month';
export type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected';

interface AdminDashboardProps {
  onClose?: () => void;
}

const AdminDashboard: React.FC<AdminDashboardProps> = ({ onClose }) => {
  const [adminPassword, setAdminPassword] = useState<string | null>(() => {
    return safeStorage.getItem('adminPassword');
  });

  const [candidates, setCandidates] = useState<CandidateRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Filters
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [periodFilter, setPeriodFilter] = useState<TimePeriod>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Stats
  const [stats, setStats] = useState<DashboardStats>({
    pendingCount: 0,
    approved: { today: 0, week: 0, month: 0, allTime: 0 },
    declined: { today: 0, week: 0, month: 0, allTime: 0 }
  });

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
      if (response.ok) {
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
          }
        });
      }
    } catch (err) {
      console.error("Failed to fetch dashboard stats:", err);
    }
  };

  const fetchCandidates = async () => {
    if (!adminPassword) return;
    try {
      setLoading(true);
      setError(null);
      
      const queryParams = new URLSearchParams();
      if (statusFilter !== 'all') queryParams.append('status', statusFilter);
      if (periodFilter !== 'all') queryParams.append('period', periodFilter);
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
      setCandidates(data.resumes || []);
      fetchStats().catch(console.error);
    } catch (err: any) {
      setError(err.message || 'Failed to load candidates');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (adminPassword) {
      fetchCandidates();
    } else {
      setLoading(false);
    }
  }, [adminPassword, statusFilter, periodFilter]);

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

  const handleDeleteCandidate = async (candidateId: string) => {
    if (!adminPassword) return;
    if (!window.confirm("Remove this candidate record from the audit log?")) return;
    try {
      const response = await fetch(`/api/resumes/${candidateId}`, {
        method: 'DELETE',
        headers: {
          'x-admin-password': adminPassword
        }
      });
      if (response.ok) {
        setCandidates(prev => prev.filter(c => c.id !== candidateId));
        fetchStats();
      }
    } catch (err) {
      console.error("Failed to delete record:", err);
    }
  };

  const handlePurgeAll = async () => {
    if (!adminPassword) return;
    if (!window.confirm("Are you sure you want to purge all candidate logs and reset counts? This cannot be undone.")) return;
    try {
      setLoading(true);
      const response = await fetch('/api/admin/purge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': adminPassword
        }
      });
      if (response.ok) {
        setCandidates([]);
        fetchStats();
      }
    } catch (err) {
      console.error("Failed to purge logs:", err);
    } finally {
      setLoading(false);
    }
  };

  // Filter candidates by client search term (candidate name or IP address)
  const filteredCandidates = useMemo(() => {
    if (!searchQuery.trim()) return candidates;
    const query = searchQuery.toLowerCase().trim();
    return candidates.filter(c => 
      (c.candidate_name && c.candidate_name.toLowerCase().includes(query)) ||
      (c.ip_address && c.ip_address.toLowerCase().includes(query)) ||
      (c.device_info && c.device_info.toLowerCase().includes(query))
    );
  }, [candidates, searchQuery]);

  // Click card helper: select period & status
  const selectMetric = (period: TimePeriod, status: StatusFilter) => {
    setPeriodFilter(period);
    setStatusFilter(status);
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

  if (!adminPassword) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="w-full max-w-7xl mx-auto p-4 md:p-6 text-slate-100 font-sans">
      
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 pb-5 border-b border-white/10">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white flex items-center gap-2.5 font-display">
            Admin Dashboard
          </h1>
          <p className="text-slate-400 text-xs mt-1">
            Real-time candidate approval & decline tracking
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => { fetchStats(); fetchCandidates(); }}
            className="p-2.5 bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl transition-all border border-white/10 cursor-pointer shadow-sm active:scale-95"
            title="Refresh Data"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={handlePurgeAll}
            className="px-3.5 py-2 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/25 text-rose-300 hover:text-rose-200 rounded-xl text-xs font-semibold transition-all cursor-pointer shadow-sm active:scale-95"
            title="Purge all submission history"
          >
            Purge History
          </button>

          {onClose && (
            <button
              onClick={onClose}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-white font-bold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-[0_0_15px_rgba(99,102,241,0.25)] active:scale-95"
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

      {/* Analytics Metric Cards: Day, Week, Month & All-Time */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        
        {/* Today Card */}
        <div className="glassmorphic-card rounded-2xl p-5 border border-white/[0.06] bg-white/[0.015] flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-indigo-400" /> Today
            </span>
            <span className="text-[10px] text-slate-500 font-mono">Day Count</span>
          </div>
          
          <div className="grid grid-cols-2 gap-2 mt-1">
            <button
              onClick={() => selectMetric('day', 'approved')}
              className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                periodFilter === 'day' && statusFilter === 'approved'
                  ? 'bg-emerald-500/20 border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.2)]'
                  : 'bg-emerald-500/5 border-emerald-500/15 hover:bg-emerald-500/10'
              }`}
            >
              <div className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                <Check className="w-3 h-3" /> Approved
              </div>
              <div className="text-2xl font-black text-emerald-300 mt-1">{stats.approved.today}</div>
              <div className="text-[9px] text-emerald-400/60 mt-0.5">Click to view</div>
            </button>

            <button
              onClick={() => selectMetric('day', 'rejected')}
              className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                periodFilter === 'day' && statusFilter === 'rejected'
                  ? 'bg-rose-500/20 border-rose-500/50 shadow-[0_0_15px_rgba(244,63,94,0.2)]'
                  : 'bg-rose-500/5 border-rose-500/15 hover:bg-rose-500/10'
              }`}
            >
              <div className="text-[10px] font-semibold text-rose-400 uppercase tracking-wider flex items-center gap-1">
                <X className="w-3 h-3" /> Declined
              </div>
              <div className="text-2xl font-black text-rose-300 mt-1">{stats.declined.today}</div>
              <div className="text-[9px] text-rose-400/60 mt-0.5">Click to view</div>
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
              className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                periodFilter === 'week' && statusFilter === 'approved'
                  ? 'bg-emerald-500/20 border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.2)]'
                  : 'bg-emerald-500/5 border-emerald-500/15 hover:bg-emerald-500/10'
              }`}
            >
              <div className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                <Check className="w-3 h-3" /> Approved
              </div>
              <div className="text-2xl font-black text-emerald-300 mt-1">{stats.approved.week}</div>
              <div className="text-[9px] text-emerald-400/60 mt-0.5">Click to view</div>
            </button>

            <button
              onClick={() => selectMetric('week', 'rejected')}
              className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                periodFilter === 'week' && statusFilter === 'rejected'
                  ? 'bg-rose-500/20 border-rose-500/50 shadow-[0_0_15px_rgba(244,63,94,0.2)]'
                  : 'bg-rose-500/5 border-rose-500/15 hover:bg-rose-500/10'
              }`}
            >
              <div className="text-[10px] font-semibold text-rose-400 uppercase tracking-wider flex items-center gap-1">
                <X className="w-3 h-3" /> Declined
              </div>
              <div className="text-2xl font-black text-rose-300 mt-1">{stats.declined.week}</div>
              <div className="text-[9px] text-rose-400/60 mt-0.5">Click to view</div>
            </button>
          </div>
        </div>

        {/* This Month Card */}
        <div className="glassmorphic-card rounded-2xl p-5 border border-white/[0.06] bg-white/[0.015] flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-indigo-400" /> This Month
            </span>
            <span className="text-[10px] text-slate-500 font-mono">Last 30 Days</span>
          </div>
          
          <div className="grid grid-cols-2 gap-2 mt-1">
            <button
              onClick={() => selectMetric('month', 'approved')}
              className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                periodFilter === 'month' && statusFilter === 'approved'
                  ? 'bg-emerald-500/20 border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.2)]'
                  : 'bg-emerald-500/5 border-emerald-500/15 hover:bg-emerald-500/10'
              }`}
            >
              <div className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                <Check className="w-3 h-3" /> Approved
              </div>
              <div className="text-2xl font-black text-emerald-300 mt-1">{stats.approved.month}</div>
              <div className="text-[9px] text-emerald-400/60 mt-0.5">Click to view</div>
            </button>

            <button
              onClick={() => selectMetric('month', 'rejected')}
              className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                periodFilter === 'month' && statusFilter === 'rejected'
                  ? 'bg-rose-500/20 border-rose-500/50 shadow-[0_0_15px_rgba(244,63,94,0.2)]'
                  : 'bg-rose-500/5 border-rose-500/15 hover:bg-rose-500/10'
              }`}
            >
              <div className="text-[10px] font-semibold text-rose-400 uppercase tracking-wider flex items-center gap-1">
                <X className="w-3 h-3" /> Declined
              </div>
              <div className="text-2xl font-black text-rose-300 mt-1">{stats.declined.month}</div>
              <div className="text-[9px] text-rose-400/60 mt-0.5">Click to view</div>
            </button>
          </div>
        </div>

        {/* All-Time & Pending Review Card */}
        <div className="glassmorphic-card rounded-2xl p-5 border border-white/[0.06] bg-white/[0.015] flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-amber-400" /> Overall Status
            </span>
            <span className="text-[10px] text-slate-500 font-mono">All Records</span>
          </div>

          <div className="grid grid-cols-2 gap-2 mt-1">
            <button
              onClick={() => selectMetric('all', 'pending')}
              className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                statusFilter === 'pending'
                  ? 'bg-amber-500/20 border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.2)]'
                  : 'bg-amber-500/5 border-amber-500/15 hover:bg-amber-500/10'
              }`}
            >
              <div className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-1">
                <Clock className="w-3 h-3" /> Pending
              </div>
              <div className="text-2xl font-black text-amber-300 mt-1">{stats.pendingCount}</div>
              <div className="text-[9px] text-amber-400/60 mt-0.5">Awaiting review</div>
            </button>

            <button
              onClick={() => selectMetric('all', 'all')}
              className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                periodFilter === 'all' && statusFilter === 'all'
                  ? 'bg-indigo-500/20 border-indigo-500/50 shadow-[0_0_15px_rgba(99,102,241,0.2)]'
                  : 'bg-indigo-500/5 border-indigo-500/15 hover:bg-indigo-500/10'
              }`}
            >
              <div className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wider flex items-center gap-1">
                Total
              </div>
              <div className="text-2xl font-black text-indigo-300 mt-1">{stats.approved.allTime + stats.declined.allTime}</div>
              <div className="text-[9px] text-indigo-400/60 mt-0.5">
                {stats.approved.allTime} apr / {stats.declined.allTime} dec
              </div>
            </button>
          </div>
        </div>

      </div>

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
              <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-slate-300 font-mono font-bold">
                {filteredCandidates.length}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Viewing: <span className="text-indigo-300 font-medium capitalize">{statusFilter === 'all' ? 'All Statuses' : statusFilter}</span>
              {' • '}
              <span className="text-indigo-300 font-medium capitalize">
                {periodFilter === 'day' ? 'Today' : periodFilter === 'week' ? 'This Week' : periodFilter === 'month' ? 'This Month' : 'All Time'}
              </span>
            </p>
          </div>

          {/* Search Input */}
          <div className="relative min-w-[260px] md:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by candidate name or IP..."
              className="w-full pl-9 pr-8 py-2 bg-slate-900/60 border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
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

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center justify-between gap-3 py-3 border-b border-white/5 text-xs">
          
          {/* Status Filter Tabs */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-slate-500 text-[11px] font-semibold uppercase mr-1">Status:</span>
            {(['all', 'pending', 'approved', 'rejected'] as StatusFilter[]).map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer capitalize text-xs ${
                  statusFilter === st
                    ? st === 'approved' 
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' 
                      : st === 'rejected' 
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40' 
                      : st === 'pending'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40'
                    : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
              >
                {st === 'rejected' ? 'Declined' : st}
              </button>
            ))}
          </div>

          {/* Timeframe Period Filter Tabs */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-slate-500 text-[11px] font-semibold uppercase mr-1">Period:</span>
            {[
              { id: 'all', label: 'All Time' },
              { id: 'day', label: 'Today' },
              { id: 'week', label: 'This Week' },
              { id: 'month', label: 'This Month' }
            ].map((p) => (
              <button
                key={p.id}
                onClick={() => setPeriodFilter(p.id as TimePeriod)}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer text-xs ${
                  periodFilter === p.id
                    ? 'bg-white/15 text-white border border-white/20'
                    : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
              >
                {p.label}
              </button>
            ))}
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
            <h3 className="text-base font-bold text-white mb-1">No candidates found</h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto font-light">
              {searchQuery 
                ? `No submissions matched "${searchQuery}". Try clearing the search query.` 
                : `There are no candidate submissions under "${statusFilter}" for "${periodFilter}".`}
            </p>
            {(statusFilter !== 'all' || periodFilter !== 'all' || searchQuery) && (
              <button
                onClick={() => { setStatusFilter('all'); setPeriodFilter('all'); setSearchQuery(''); }}
                className="mt-4 px-3 py-1.5 bg-white/10 hover:bg-white/15 rounded-lg text-xs font-semibold text-slate-200 transition-colors cursor-pointer"
              >
                Reset All Filters
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04] mt-2">
            {filteredCandidates.map((candidate) => (
              <motion.div
                key={candidate.id}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className="py-4 px-2 sm:px-3 hover:bg-white/[0.02] rounded-xl transition-all flex flex-col md:flex-row md:items-center justify-between gap-3 group"
              >
                {/* Candidate Info */}
                <div className="flex items-start sm:items-center gap-3.5">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                    candidate.status === 'approved'
                      ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
                      : candidate.status === 'rejected'
                      ? 'bg-rose-500/10 border-rose-500/25 text-rose-400'
                      : 'bg-amber-500/10 border-amber-500/25 text-amber-400'
                  }`}>
                    <User className="w-5 h-5" />
                  </div>

                  <div>
                    {/* Candidate Name */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white font-bold text-sm tracking-wide">
                        {candidate.candidate_name || 'Candidate Submission'}
                      </span>
                      
                      {/* Status Tag */}
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                        candidate.status === 'approved'
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                          : candidate.status === 'rejected'
                          ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                          : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                      }`}>
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

                {/* Right Action Controls */}
                <div className="flex items-center gap-2 self-end md:self-auto shrink-0">
                  {candidate.status === 'pending' && (
                    <>
                      <button
                        onClick={() => handleReject(candidate.id)}
                        className="px-3.5 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer active:scale-95"
                      >
                        Decline
                      </button>
                      <button
                        onClick={() => handleApprove(candidate.id)}
                        className="btn-2026-neon px-4 py-1.5 text-white rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer active:scale-95"
                      >
                        Approve
                      </button>
                    </>
                  )}

                  <button
                    onClick={() => handleDeleteCandidate(candidate.id)}
                    className="p-2 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
                    title="Delete record"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
};

export default AdminDashboard;
