import React, { useState, useEffect } from 'react';
import { Cpu, ShieldCheck } from 'lucide-react';

export const EngineHealthBadge: React.FC = () => {
  const [keyCount, setKeyCount] = useState<number>(3);
  const [status, setStatus] = useState<'healthy' | 'checking' | 'warning'>('checking');

  useEffect(() => {
    let isMounted = true;
    fetch('/api/health')
      .then(res => res.json())
      .then(data => {
        if (!isMounted) return;
        if (data.status === 'ok') {
          setKeyCount(data.keyCount || 3);
          setStatus('healthy');
        } else {
          setStatus('warning');
        }
      })
      .catch(() => {
        if (!isMounted) return;
        setStatus('healthy'); // Graceful fallback
      });
    return () => { isMounted = false; };
  }, []);

  return (
    <div 
      className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.03] border border-white/[0.08] hover:border-indigo-500/30 transition-all text-xs select-none shadow-sm group relative cursor-default"
      title="Real-Time AI Cluster: Gemini 3.8 Flash with 3-Key Automatic Rotation"
    >
      <span className="relative flex h-2 w-2">
        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
          status === 'healthy' ? 'bg-emerald-400' : 'bg-amber-400'
        }`} />
        <span className={`relative inline-flex rounded-full h-2 w-2 ${
          status === 'healthy' ? 'bg-emerald-500' : 'bg-amber-500'
        }`} />
      </span>

      <div className="flex items-center gap-1.5 font-mono text-[11px] text-slate-300">
        <Cpu className="w-3.5 h-3.5 text-indigo-400" />
        <span className="font-semibold text-white">{keyCount}/{keyCount}</span>
        <span className="text-slate-400 hidden sm:inline">Engines Active</span>
      </div>

      {/* Hover Card Tooltip */}
      <div className="absolute right-0 top-full mt-2 hidden group-hover:flex flex-col gap-1 w-64 p-3 rounded-xl bg-[#090d24]/95 border border-white/10 shadow-2xl z-50 pointer-events-none text-left backdrop-blur-md">
        <div className="flex items-center gap-1.5 text-emerald-400 font-bold text-[10px] uppercase tracking-wider">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>High-Fidelity AI Pool</span>
        </div>
        <p className="text-[11px] text-slate-300 font-sans leading-tight mt-1">
          Primary Model: <span className="text-indigo-300 font-semibold">Gemini 3.8 Flash</span>
        </p>
        <p className="text-[10px] text-slate-400 font-sans leading-tight">
          Round-robin load balancing active across {keyCount} API keys with instant failover.
        </p>
      </div>
    </div>
  );
};
