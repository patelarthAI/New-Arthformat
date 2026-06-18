import React from 'react';
import { motion } from 'framer-motion';

interface InteractiveLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'hero';
}

export const InteractiveLogo: React.FC<InteractiveLogoProps> = ({ size = 'md' }) => {
  const sizeClasses = {
    sm: { container: 'w-10 h-10', svgSize: 40, strokeWidth: 1.5, glow: '10px' },
    md: { container: 'w-16 h-16', svgSize: 64, strokeWidth: 2, glow: '15px' },
    lg: { container: 'w-24 h-24', svgSize: 96, strokeWidth: 2.5, glow: '20px' },
    xl: { container: 'w-20 h-20', svgSize: 80, strokeWidth: 2.2, glow: '16px' },
    hero: { container: 'w-36 h-36 md:w-40 md:h-40', svgSize: 160, strokeWidth: 3, glow: '35px' },
  };

  const config = sizeClasses[size];

  return (
    <div className={`relative ${config.container} select-none group flex items-center justify-center`}>
      {/* Dynamic ambient back-glow ring */}
      <div 
        className="absolute inset-0 rounded-full bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 opacity-20 blur-xl group-hover:opacity-40 group-hover:scale-110 transition-all duration-700 pointer-events-none"
        style={{ filter: `blur(${config.glow})` }}
      />

      {/* Rotating cybernetic outer tick-ring */}
      <svg 
        width="100%" 
        height="100%" 
        viewBox="0 0 100 100" 
        className="absolute top-0 left-0 text-indigo-500/30 group-hover:text-pink-500/40 transition-colors duration-500 pointer-events-none"
        style={{ transformOrigin: 'center' }}
      >
        <motion.circle 
          cx="50" 
          cy="50" 
          r="47"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.5"
          strokeDasharray="4, 12, 1, 12"
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 25, ease: 'linear' }}
        />
        <motion.circle 
          cx="50" 
          cy="50" 
          r="42"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.75"
          strokeDasharray="20, 6, 40, 6"
          className="text-purple-500/20 group-hover:text-indigo-400/30 transition-all"
          animate={{ rotate: -360 }}
          transition={{ repeat: Infinity, duration: 40, ease: 'linear' }}
        />
      </svg>

      {/* 3D Glassmorphic Capsule Shield */}
      <div className="absolute inset-[4%] rounded-full bg-[#0a0f25]/50 backdrop-blur-md border border-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.5),inset_0_1px_2px_rgba(255,255,255,0.15)] group-hover:border-indigo-500/30 group-hover:scale-[1.02] transition-all duration-500 flex items-center justify-center overflow-hidden">
        {/* Shimmering glass reflection */}
        <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/[0.03] to-white/[0.08] pointer-events-none" />
        
        {/* Animated dynamic line sweeping */}
        <motion.div 
          className="absolute inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-indigo-400/40 to-transparent pointer-events-none"
          initial={{ top: '-10%' }}
          animate={{ top: '110%' }}
          transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
        />

        {/* Scaled Core vector of a digital resume document layout being scanned and optimized */}
        <svg 
          width="82%" 
          height="82%" 
          viewBox="0 0 100 100" 
          fill="none" 
          xmlns="http://www.w3.org/2000/svg"
          className="relative z-10 drop-shadow-[0_0_12px_rgba(139,92,246,0.4)]"
        >
          <defs>
            <linearGradient id={`gradient-${size}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#6366f1" />
              <stop offset="50%" stopColor="#a855f7" />
              <stop offset="100%" stopColor="#ec4899" />
            </linearGradient>
            <linearGradient id={`doc-grad-${size}`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="rgba(99,102,241,0.25)" />
              <stop offset="100%" stopColor="rgba(236,72,153,0.05)" />
            </linearGradient>
            <filter id={`glow-filter-${size}`}>
              <feGaussianBlur stdDeviation="2.5" result="coloredBlur"/>
              <feMerge>
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
          </defs>

          {/* SKELETON DOCUMENT SHIELD (Sleek Rounded Paper Sheet) */}
          <motion.path 
            d="M32 20 H58 L68 30 V80 C68 82.2 66.2 84 64 84 H32 C29.8 84 28 82.2 28 80 V24 C28 21.8 29.8 20 32 20 Z" 
            fill={`url(#doc-grad-${size})`}
            stroke={`url(#gradient-${size})`}
            strokeWidth={size === 'hero' ? 2.5 : 2}
            strokeLinejoin="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 1.2, ease: "easeOut" }}
          />

          {/* Folded paper corner page-fold */}
          <motion.path 
            d="M58 20 V30 H68" 
            stroke={`url(#gradient-${size})`}
            strokeWidth={size === 'hero' ? 2.5 : 2}
            strokeLinejoin="round"
            fill="rgba(10, 15, 37, 0.9)"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.5 }}
          />

          {/* Profile Header Block inside doc */}
          <motion.rect 
            x="34" 
            y="32" 
            width="14" 
            height="4" 
            rx="1" 
            fill="#ffffff" 
            style={{ opacity: 0.85 }}
            initial={{ width: 0 }}
            animate={{ width: 14 }}
            transition={{ delay: 0.6, duration: 0.6 }}
          />

          {/* Horizontal Resume Segment Lines */}
          <motion.line 
            x1="34" 
            y1="43" 
            x2="52" 
            y2="43" 
            stroke="#ffffff" 
            strokeWidth="2.5" 
            strokeLinecap="round" 
            style={{ opacity: 0.7 }}
            initial={{ x2: 34 }}
            animate={{ x2: 52 }}
            transition={{ delay: 0.7, duration: 0.5 }}
          />
          
          <motion.line 
            x1="34" 
            y1="51" 
            x2="62" 
            y2="51" 
            stroke={`url(#gradient-${size})`}
            strokeWidth="2.5" 
            strokeLinecap="round" 
            initial={{ x2: 34 }}
            animate={{ x2: 62 }}
            transition={{ delay: 0.8, duration: 0.6 }}
          />

          <motion.line 
            x1="34" 
            y1="59" 
            x2="58" 
            y2="59" 
            stroke="#ffffff" 
            strokeWidth="2" 
            strokeLinecap="round" 
            style={{ opacity: 0.6 }}
            initial={{ x2: 34 }}
            animate={{ x2: 58 }}
            transition={{ delay: 0.9, duration: 0.5 }}
          />

          <motion.line 
            x1="34" 
            y1="67" 
            x2="48" 
            y2="67" 
            stroke="#ffffff" 
            strokeWidth="2" 
            strokeLinecap="round" 
            style={{ opacity: 0.6 }}
            initial={{ x2: 34 }}
            animate={{ x2: 48 }}
            transition={{ delay: 1, duration: 0.4 }}
          />

          <motion.line 
            x1="34" 
            y1="75" 
            x2="54" 
            y2="75" 
            stroke={`url(#gradient-${size})`}
            strokeWidth="2" 
            strokeLinecap="round" 
            initial={{ x2: 34 }}
            animate={{ x2: 54 }}
            transition={{ delay: 1.1, duration: 0.5 }}
          />

          {/* AI OPTIMIZATION MAGIC BRIGHT CHECKMARK/SPARK SYMBOL ON TOP */}
          <motion.path 
            d="M58 48 L65 55 L82 34" 
            stroke="#10b981"
            strokeWidth={size === 'hero' ? 6 : 4.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            filter={`url(#glow-filter-${size})`}
            initial={{ pathLength: 0, scale: 0.8 }}
            animate={{ pathLength: 1, scale: 1 }}
            transition={{ delay: 1.2, duration: 0.8, ease: "easeOut" }}
          />

          {/* Mini floating smart spark accent */}
          <motion.path
            d="M78 22 L80 26 L84 28 L80 30 L78 34 L76 30 L72 28 L76 26 Z"
            fill="#a855f7"
            initial={{ scale: 0, rotate: -45 }}
            animate={{ scale: [1, 1.2, 1], rotate: [0, 15, 0] }}
            transition={{ repeat: Infinity, duration: 3, delay: 1.5 }}
          />

          {/* Moving Dynamic Laser Scanning Beam */}
          <motion.line
            x1="26"
            y1="30"
            x2="70"
            y2="30"
            stroke="#ec4899"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.8"
            animate={{ 
              y1: [24, 80, 24],
              y2: [24, 80, 24]
            }}
            transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
          />
        </svg>
      </div>
    </div>
  );
};
