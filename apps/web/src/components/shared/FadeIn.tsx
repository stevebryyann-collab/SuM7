import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface FadeInProps {
  children: ReactNode;
  /** Stagger in ms — KPIs 0, charts 50, tables 100 — for a subtle cascade. */
  delay?: number;
  className?: string;
}

/**
 * Fades its children in on mount (opacity + a 12px rise, 350ms calm spring) to
 * soften the skeleton → content swap — the Apple-Weather page choreography
 * (CLAUDE.md → Page Transitions / Cards). The `fade-in` class lets
 * `prefers-reduced-motion` disable it (see globals.css, where the keyframes live).
 */
export function FadeIn({ children, delay = 0, className }: FadeInProps): JSX.Element {
  const style: CSSProperties = {
    animation: `fadeIn 350ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms both`,
  };
  return (
    <div className={cn('fade-in', className)} style={style}>
      {children}
    </div>
  );
}
