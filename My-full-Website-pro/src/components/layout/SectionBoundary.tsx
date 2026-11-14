import type { ReactNode } from 'react';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { SectionErrorFallback } from '@/components/ui/ErrorFallbacks';

/** Wraps a page section so a crash in it shows a small message instead of breaking the page. */
export const SectionBoundary = ({ name, children }: { name: string; children: ReactNode }) => (
  <ErrorBoundary name={name} fallback={SectionErrorFallback}>
    {children}
  </ErrorBoundary>
);
