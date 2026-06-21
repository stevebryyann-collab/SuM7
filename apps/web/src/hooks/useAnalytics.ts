'use client';

import { useMutation, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { format } from 'date-fns';
import type { AnalyticsExportType } from '@b2b/shared/schemas';
import { merchantFetch } from '@/lib/api/merchant';
import type { AnalyticsData } from '@/types/api';

export const analyticsKeys = {
  all: ['analytics'] as const,
  range: (from: string, to: string) => [...analyticsKeys.all, from, to] as const,
};

/** Analytics-page payload for a date window (ISO strings, inclusive). */
export function useAnalytics(range: { from: string; to: string }): UseQueryResult<AnalyticsData> {
  return useQuery({
    queryKey: analyticsKeys.range(range.from, range.to),
    staleTime: 60_000,
    queryFn: ({ signal }) =>
      merchantFetch<AnalyticsData>(
        `/api/v1/analytics?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
        { signal },
      ),
  });
}

/** Trigger a client-side download of a CSV blob. */
function downloadCsv(csv: string, name: string): void {
  if (typeof window === 'undefined') return;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Acknowledgement returned by the GDPR (async) export branch. */
interface GdprAck {
  queued: true;
  message: string;
}

/**
 * Data export. `orders|invoices|buyers` download a CSV immediately; `gdpr`
 * enqueues an async per-merchant export and resolves with the API's
 * acknowledgement (the page surfaces the message as a toast).
 */
export function useAnalyticsExport() {
  return useMutation<string | GdprAck, Error, AnalyticsExportType>({
    mutationFn: (type) =>
      merchantFetch<string | GdprAck>(`/api/v1/analytics/export?type=${type}`, { method: 'GET' }),
    onSuccess: (data, type) => {
      if (type === 'gdpr') return; // handled by the caller's onSuccess (toast)
      if (typeof data === 'string') {
        downloadCsv(data, `${type}_export_${format(new Date(), 'yyyy-MM-dd')}.csv`);
      }
    },
  });
}
