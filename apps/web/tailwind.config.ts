import type { Config } from 'tailwindcss';

/**
 * Tailwind config for the B2B wholesale portal.
 *
 * Design system (see CLAUDE.md): minimalism governs layout; skeuomorphic depth
 * cues are shadow-only and applied solely to interactive elements. A SINGLE
 * accent color (blue) drives every CTA — there are deliberately no secondary
 * accents. Only `shadow-sm`/`shadow-inner` are used; the larger shadow scales
 * are intentionally left at Tailwind defaults but never referenced in markup.
 */
const config: Config = {
  darkMode: ['class'],
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/hooks/**/*.{ts,tsx}',
    './src/lib/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '1.5rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      colors: {
        // The one and only accent. Used for every primary CTA + active nav.
        accent: {
          DEFAULT: '#2563eb', // blue-600
          dark: '#1d4ed8', // blue-700 (CTA border)
          fg: '#ffffff',
        },
        border: '#e5e7eb', // gray-200
        input: '#d1d5db', // gray-300
        background: '#f9fafb', // gray-50 page background
        panel: '#ffffff', // content panels
        muted: '#f3f4f6', // gray-100 secondary panels
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        // Three sizes max per view: label / body / heading.
        label: ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.05em' }], // 11px
      },
      borderRadius: {
        lg: '0.5rem',
        md: '0.375rem',
        sm: '0.25rem',
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
