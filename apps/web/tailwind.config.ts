import type { Config } from 'tailwindcss';

/**
 * Tailwind config for the B2B wholesale portal.
 *
 * Design system (see CLAUDE.md + PART 1 token spec): minimalism governs layout;
 * skeuomorphic depth cues are shadow-only and applied solely to interactive
 * elements. A SINGLE accent color (blue #2563EB) drives every CTA — there are
 * deliberately no secondary accents. Status colors (success/warning/danger/
 * neutral) are semantic, not accents.
 *
 * Tokens below are the single source of truth: no component may use a hardcoded
 * hex, an arbitrary Tailwind value, or a shadow that does not exist here.
 * Legacy keys (background/panel/muted/input, accent.dark/fg) are retained so
 * previously-shipped markup keeps resolving while the new token names roll out.
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
        // ── Surfaces ────────────────────────────────────────────────────────
        bg: '#FAFAFA',
        surface: '#FFFFFF',
        border: '#E4E4E7',
        'border-strong': '#D4D4D8',
        // Legacy surface aliases (kept for already-shipped markup).
        background: '#FAFAFA',
        panel: '#FFFFFF',
        muted: '#F4F4F5',
        input: '#D4D4D8',
        // ── Text ────────────────────────────────────────────────────────────
        text: {
          primary: '#18181B',
          secondary: '#71717A',
          tertiary: '#A1A1AA',
          inverse: '#FFFFFF',
        },
        // ── The one and only accent ─────────────────────────────────────────
        accent: {
          DEFAULT: '#2563EB',
          hover: '#1D4ED8',
          subtle: '#EFF6FF',
          border: '#BFDBFE',
          // Legacy aliases.
          dark: '#1D4ED8',
          fg: '#FFFFFF',
        },
        // ── Semantic status ─────────────────────────────────────────────────
        success: {
          DEFAULT: '#16A34A',
          bg: '#F0FDF4',
          border: '#BBF7D0',
        },
        warning: {
          DEFAULT: '#D97706',
          bg: '#FFFBEB',
          border: '#FDE68A',
        },
        danger: {
          DEFAULT: '#DC2626',
          bg: '#FEF2F2',
          border: '#FECACA',
        },
        neutral: {
          DEFAULT: '#71717A',
          bg: '#F4F4F5',
        },
        // ── AR aging buckets ────────────────────────────────────────────────
        aging: {
          current: '#16A34A',
          '1-30': '#D97706',
          '31-60': '#EA580C',
          '61-90': '#DC2626',
          '90-plus': '#991B1B',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      fontSize: {
        '2xs': ['11px', { lineHeight: '1.4', letterSpacing: '0.04em' }],
        xs: ['12px', { lineHeight: '1.5' }],
        sm: ['13px', { lineHeight: '1.5' }],
        base: ['14px', { lineHeight: '1.5' }],
        md: ['15px', { lineHeight: '1.5' }],
        lg: ['16px', { lineHeight: '1.4' }],
        xl: ['18px', { lineHeight: '1.35' }],
        '2xl': ['22px', { lineHeight: '1.3', letterSpacing: '-0.01em' }],
        '3xl': ['28px', { lineHeight: '1.2', letterSpacing: '-0.02em' }],
        '4xl': ['36px', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
        kpi: ['28px', { lineHeight: '1.2', letterSpacing: '-0.02em' }],
        // Legacy: the 11px uppercase label used by already-shipped panels.
        label: ['11px', { lineHeight: '1rem', letterSpacing: '0.05em' }],
      },
      boxShadow: {
        sm: '0 1px 2px 0 rgba(0,0,0,0.04)',
        md: '0 2px 8px 0 rgba(0,0,0,0.06)',
        lg: '0 4px 24px 0 rgba(0,0,0,0.08)',
        'inner-sm': 'inset 0 1px 2px 0 rgba(0,0,0,0.04)',
        none: 'none',
      },
      borderRadius: {
        sm: '4px',
        md: '6px',
        lg: '8px',
        xl: '12px',
      },
      transitionDuration: {
        fast: '80ms',
        base: '150ms',
        slow: '300ms',
      },
      keyframes: {
        // Used only by Radix-driven overlays/sheets. <=100ms per design rules.
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
        'fade-in': 'fade-in 100ms ease-out',
        'fade-out': 'fade-out 100ms ease-in',
        'slide-in-right': 'slide-in-right 100ms ease-out',
        'slide-out-right': 'slide-out-right 100ms ease-in',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
