import type { Config } from 'tailwindcss';

/**
 * Tailwind config for the B2B wholesale portal.
 *
 * Design system (see CLAUDE.md → "WHOLESALE PORTAL DESIGN SYSTEM"): the
 * Apple-Weather-inspired premium glass language. Every surface is translucent
 * glass floating over a large, slow, atmospheric morning-sky gradient. Corners
 * are soft (16–32px), shadows are wide/diffuse/blue-gray (never black), and
 * everything animates with spring easing.
 *
 * Tokens below are the single source of truth: no component may use a hardcoded
 * hex, an arbitrary Tailwind value, or a shadow that does not exist here. The
 * legacy semantic keys (bg/surface/panel/muted/input, accent.dark/fg,
 * success/warning/danger/neutral) are retained so previously-shipped markup
 * keeps resolving — their VALUES were retuned into the glass palette so the
 * whole app shifts language the moment tokens change.
 *
 * Palette (CLAUDE.md): Ocean Blue (primary), Sky Blue (highlight),
 * Mint Green (success), Cloud White (glass), Fog Gray (secondary text),
 * Coral (danger), Amber (warning). No other accents exist.
 */
const config: Config = {
  darkMode: ['class'],
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/hooks/**/*.{ts,tsx}',
    './src/lib/**/*.{ts,tsx}',
    './src/styles/**/*.{ts,tsx,css}',
  ],
  theme: {
    container: {
      center: true,
      padding: '1.5rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      colors: {
        // ── Atmosphere / surfaces ───────────────────────────────────────────
        // `bg` is a fallback only — the real page background is the animated
        // gradient painted on <body> in globals.css. Surfaces are glass.
        bg: '#EAF3FF',
        surface: '#FFFFFF',
        border: '#DCE7F3',
        'border-strong': '#C6D6E7',
        // Legacy surface aliases (kept for already-shipped markup).
        background: '#EAF3FF',
        panel: '#FFFFFF',
        muted: '#EDF3FA',
        input: '#C6D6E7',

        // ── Cloud White glass (rgba — for bg-glass / border-glass-*) ─────────
        glass: {
          DEFAULT: 'rgba(255,255,255,0.72)',
          strong: 'rgba(255,255,255,0.85)',
          subtle: 'rgba(255,255,255,0.55)',
          faint: 'rgba(255,255,255,0.40)',
          border: 'rgba(255,255,255,0.85)',
          'border-soft': 'rgba(255,255,255,0.60)',
        },

        // ── Text (deep slate over glass, never harsh black) ─────────────────
        text: {
          primary: '#172536',
          secondary: '#5A6B7E',
          tertiary: '#8A9AAC',
          inverse: '#FFFFFF',
        },

        // ── Ocean Blue — the one primary accent ─────────────────────────────
        ocean: {
          DEFAULT: '#0A84FF',
          deep: '#0060DF',
          bright: '#3D9BFF',
          soft: '#E8F2FF',
          tint: '#DCEBFF',
        },
        // Semantic `accent.*` maps onto Ocean so existing CTAs shift language.
        accent: {
          DEFAULT: '#0A84FF',
          hover: '#0060DF',
          subtle: '#E8F2FF',
          border: '#B9DBFF',
          dark: '#0060DF',
          fg: '#FFFFFF',
        },

        // ── Sky Blue — highlights ───────────────────────────────────────────
        sky: {
          DEFAULT: '#5AC8FA',
          soft: '#EAF7FF',
          deep: '#32ADE6',
        },

        // ── Mint Green — success ────────────────────────────────────────────
        mint: {
          DEFAULT: '#34C759',
          soft: '#E7F9ED',
          deep: '#248A3D',
        },
        success: {
          DEFAULT: '#248A3D',
          bg: '#E7F9ED',
          border: '#B7EDC6',
        },

        // ── Amber — warning ─────────────────────────────────────────────────
        amber: {
          DEFAULT: '#FF9F0A',
          soft: '#FFF4E1',
          deep: '#B26A00',
        },
        warning: {
          DEFAULT: '#B26A00',
          bg: '#FFF4E1',
          border: '#FFE0A3',
        },

        // ── Coral — danger ──────────────────────────────────────────────────
        coral: {
          DEFAULT: '#FF453A',
          soft: '#FFECEA',
          deep: '#C42B22',
        },
        danger: {
          DEFAULT: '#C42B22',
          bg: '#FFECEA',
          border: '#FFC7C2',
        },

        // ── Fog Gray — secondary text / neutral chips ───────────────────────
        fog: {
          DEFAULT: '#8A9AAC',
          soft: '#EDF3FA',
          deep: '#5A6B7E',
        },
        neutral: {
          DEFAULT: '#5A6B7E',
          bg: '#EDF3FA',
        },

        // ── AR aging buckets (palette-aligned) ──────────────────────────────
        aging: {
          current: '#34C759',
          '1-30': '#FF9F0A',
          '31-60': '#FF7A1A',
          '61-90': '#FF453A',
          '90-plus': '#C42B22',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      fontSize: {
        '2xs': ['11px', { lineHeight: '1.4', letterSpacing: '0.04em' }],
        xs: ['12px', { lineHeight: '1.5' }],
        sm: ['13px', { lineHeight: '1.55' }],
        base: ['14px', { lineHeight: '1.6' }],
        md: ['15px', { lineHeight: '1.6' }],
        lg: ['17px', { lineHeight: '1.5' }],
        xl: ['20px', { lineHeight: '1.4' }],
        '2xl': ['24px', { lineHeight: '1.3', letterSpacing: '-0.01em' }],
        '3xl': ['32px', { lineHeight: '1.2', letterSpacing: '-0.02em' }],
        '4xl': ['44px', { lineHeight: '1.08', letterSpacing: '-0.025em' }],
        '5xl': ['56px', { lineHeight: '1.04', letterSpacing: '-0.03em' }],
        kpi: ['36px', { lineHeight: '1.1', letterSpacing: '-0.025em' }],
        // Legacy: the 11px uppercase label used by already-shipped panels.
        label: ['11px', { lineHeight: '1rem', letterSpacing: '0.06em' }],
      },
      boxShadow: {
        // Soft, wide, diffuse, blue-gray (base #1E3A5F). Never black, never harsh.
        sm: '0 1px 3px 0 rgba(30,58,95,0.06), 0 1px 2px 0 rgba(30,58,95,0.04)',
        md: '0 6px 20px -4px rgba(30,58,95,0.12), 0 2px 8px -2px rgba(30,58,95,0.07)',
        lg: '0 18px 48px -12px rgba(30,58,95,0.20), 0 6px 18px -6px rgba(30,58,95,0.10)',
        // Named glass surfaces (float higher as they rise).
        glass: '0 8px 30px -8px rgba(30,58,95,0.16), 0 2px 10px -3px rgba(30,58,95,0.08)',
        'glass-lg':
          '0 24px 64px -16px rgba(30,58,95,0.24), 0 8px 24px -8px rgba(30,58,95,0.12)',
        'glass-hover':
          '0 30px 80px -18px rgba(30,58,95,0.30), 0 12px 32px -10px rgba(30,58,95,0.16)',
        // Ocean glow for primary CTAs.
        glow: '0 6px 20px -4px rgba(10,132,255,0.40), 0 2px 8px -2px rgba(10,132,255,0.30)',
        'glow-hover':
          '0 10px 30px -6px rgba(10,132,255,0.52), 0 4px 14px -4px rgba(10,132,255,0.38)',
        // Soft recess for pressed/inset affordances.
        'inner-sm': 'inset 0 1px 2px 0 rgba(30,58,95,0.06)',
        none: 'none',
      },
      borderRadius: {
        // Everything soft (CLAUDE.md corner-radius scale). rounded-md = buttons/
        // inputs (16), rounded-lg = secondary cards (22), rounded-xl = primary
        // cards (28), rounded-2xl = modals (32). Redefined so shipped markup
        // (rounded-lg panels, rounded-md buttons) turns soft automatically.
        none: '0',
        sm: '10px',
        md: '16px',
        lg: '22px',
        xl: '28px',
        '2xl': '32px',
        '3xl': '40px',
        full: '9999px',
      },
      transitionDuration: {
        fast: '150ms',
        base: '250ms',
        slow: '350ms',
        atmosphere: '30000ms',
      },
      transitionTimingFunction: {
        // Overshoot spring for lifts/presses; calm ease for surfaces/pages.
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        calm: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      backdropBlur: {
        xs: '4px',
        sm: '12px',
        nav: '20px',
        glass: '28px',
      },
      keyframes: {
        // Atmospheric cloud drift — very slow, barely perceptible (CLAUDE.md).
        float: {
          '0%': { transform: 'translate3d(0,0,0) scale(1)' },
          '100%': { transform: 'translate3d(4%, -3%, 0) scale(1.08)' },
        },
        'float-alt': {
          '0%': { transform: 'translate3d(0,0,0) scale(1.05)' },
          '100%': { transform: 'translate3d(-5%, 4%, 0) scale(1)' },
        },
        drift: {
          '0%': { transform: 'translateX(-3%)' },
          '100%': { transform: 'translateX(3%)' },
        },
        // Content choreography — cards fade up 12px (CLAUDE.md).
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        // Modals — scale + opacity + blur settle (CLAUDE.md).
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'scale-out': {
          from: { opacity: '1', transform: 'scale(1)' },
          to: { opacity: '0', transform: 'scale(0.96)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        'glow-pulse': {
          '0%,100%': { opacity: '0.6' },
          '50%': { opacity: '1' },
        },
        // Radix-driven overlays/sheets (retained, lengthened to spring feel).
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'fade-out': { from: { opacity: '1' }, to: { opacity: '0' } },
        'slide-in-right': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        'slide-out-right': {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(100%)' },
        },
      },
      animation: {
        float: 'float 34s ease-in-out infinite alternate',
        'float-alt': 'float-alt 42s ease-in-out infinite alternate',
        drift: 'drift 28s ease-in-out infinite alternate',
        'fade-up': 'fade-up 350ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'scale-in': 'scale-in 250ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        'scale-out': 'scale-out 180ms cubic-bezier(0.22, 1, 0.36, 1)',
        shimmer: 'shimmer 1.8s infinite',
        'glow-pulse': 'glow-pulse 4s ease-in-out infinite',
        'fade-in': 'fade-in 250ms cubic-bezier(0.22, 1, 0.36, 1)',
        'fade-out': 'fade-out 180ms cubic-bezier(0.22, 1, 0.36, 1)',
        'slide-in-right': 'slide-in-right 300ms cubic-bezier(0.22, 1, 0.36, 1)',
        'slide-out-right': 'slide-out-right 240ms cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
