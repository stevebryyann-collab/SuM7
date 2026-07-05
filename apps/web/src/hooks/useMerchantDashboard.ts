'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { merchantGraphQL } from '@/lib/api/graphql';
import type { ArAgingReport, MerchantDashboard } from '@/types/api';

/** The merchant dashboard KPI query (single GraphQL roundtrip). */
const DASHBOARD_QUERY = /* GraphQL */ `
  query GetMerchantDashboard {
    getMerchantDashboard {
      gmvCurrentMonth
      gmvPreviousMonth
      allTimeGmv
      gmvChangePercent
      outstandingArBalance
      overdueInvoiceCount
      overdueInvoiceAmount
      newBuyersThisMonth
      pendingApplicationCount
    }
  }
`;

const AR_AGING_QUERY = /* GraphQL */ `
  query GetArAging {
    getArAging {
      current { bucket invoiceCount outstandingAmount }
      overdue_1_30 { bucket invoiceCount outstandingAmount }
      overdue_31_60 { bucket invoiceCount outstandingAmount }
      overdue_61_90 { bucket invoiceCount outstandingAmount }
      overdue_90_plus { bucket invoiceCount outstandingAmount }
    }
  }
`;

export const merchantDashboardKeys = {
  all: ['merchant-dashboard'] as const,
  kpis: () => [...merchantDashboardKeys.all, 'kpis'] as const,
  arAging: () => [...merchantDashboardKeys.all, 'ar-aging'] as const,
};

/**
 * Merchant dashboard KPIs. 60s staleTime — the figures are aggregates that
 * tolerate brief staleness and the query is relatively expensive.
 */
export function useMerchantDashboard(): UseQueryResult<MerchantDashboard> {
  return useQuery({
    queryKey: merchantDashboardKeys.kpis(),
    staleTime: 60_000,
    queryFn: async () => {
      const data = await merchantGraphQL<{ getMerchantDashboard: MerchantDashboard }>(DASHBOARD_QUERY);
      return data.getMerchantDashboard;
    },
  });
}

/** AR-aging buckets for the dashboard chart. */
export function useArAging(): UseQueryResult<ArAgingReport> {
  return useQuery({
    queryKey: merchantDashboardKeys.arAging(),
    staleTime: 60_000,
    queryFn: async () => {
      const data = await merchantGraphQL<{ getArAging: ArAgingReport }>(AR_AGING_QUERY);
      return data.getArAging;
    },
  });
}
