/**
 * SnapDeploy AI — Formal Design Tokens & System Constants
 * 
 * Establishes consistent, type-safe semantic tokens for surface hierarchy,
 * text contrast, borders, status indicators, and radius scale across the app.
 */

export const DESIGN_TOKENS = {
  // Surfaces
  surface: {
    canvas: 'bg-[#090D16]',
    panel: 'bg-[#0B0F17]',
    subtle: 'bg-[#111827]/40',
    elevated: 'bg-[#111827]',
    highlight: 'bg-slate-900/60',
    hover: 'hover:bg-slate-800',
    modal: 'bg-[#0F172A]',
    modalOverlay: 'bg-black/80 backdrop-blur-md',
    header: 'bg-[#0B0F17]/95 backdrop-blur-md'
  },

  // Borders
  border: {
    subtle: 'border-white/5',
    default: 'border-white/10',
    strong: 'border-white/20',
    accent: 'border-violet-500/40',
    hover: 'hover:border-white/20'
  },

  // Text Hierarchy
  text: {
    primary: 'text-slate-100',
    secondary: 'text-slate-300',
    muted: 'text-slate-400',
    dimmed: 'text-slate-500',
    disabled: 'text-slate-600',
    accent: 'text-violet-300',
    accentBold: 'text-violet-400'
  },

  // Status Indicators
  status: {
    ready: {
      bg: 'bg-emerald-500/10',
      border: 'border-emerald-500/30',
      text: 'text-emerald-400',
      dot: 'bg-emerald-400'
    },
    running: {
      bg: 'bg-emerald-500/10',
      border: 'border-emerald-500/30',
      text: 'text-emerald-400',
      dot: 'bg-emerald-400 animate-pulse'
    },
    building: {
      bg: 'bg-violet-500/10',
      border: 'border-violet-500/30',
      text: 'text-violet-300',
      dot: 'bg-violet-400 animate-pulse'
    },
    warning: {
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/30',
      text: 'text-amber-300',
      dot: 'bg-amber-400'
    },
    error: {
      bg: 'bg-rose-500/10',
      border: 'border-rose-500/30',
      text: 'text-rose-300',
      dot: 'bg-rose-400 animate-pulse'
    },
    idle: {
      bg: 'bg-slate-800/60',
      border: 'border-white/10',
      text: 'text-slate-400',
      dot: 'bg-slate-500'
    }
  },

  // Radius Scale
  radius: {
    sm: 'rounded-md',   // 6px
    md: 'rounded-lg',   // 8px
    lg: 'rounded-xl',   // 12px
    xl: 'rounded-2xl',  // 16px
    full: 'rounded-full'
  }
} as const;
