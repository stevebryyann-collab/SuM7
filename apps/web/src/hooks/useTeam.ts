'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { InviteTeamMemberInput, TeamMemberRole } from '@b2b/shared/schemas';
import { merchantFetch } from '@/lib/api/merchant';
import type { TeamMember } from '@/types/api';

const BASE = '/api/v1/team';

export const teamKeys = {
  all: ['team'] as const,
};

/** Merchant team list (owner only). */
export function useTeam(): UseQueryResult<TeamMember[]> {
  return useQuery({
    queryKey: teamKeys.all,
    queryFn: ({ signal }) => merchantFetch<TeamMember[]>(BASE, { signal }),
  });
}

/** Change a member's role (admin/staff). */
export function useChangeTeamRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: TeamMemberRole }) =>
      merchantFetch<TeamMember>(`${BASE}/${id}`, { method: 'PATCH', body: { role } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: teamKeys.all });
    },
  });
}

/** Remove a team member (owner only; cannot remove owner or self). */
export function useRemoveTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => merchantFetch<void>(`${BASE}/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: teamKeys.all });
    },
  });
}

/** Send a team invitation (v1 stub — acknowledged but no email is sent). */
export function useInviteTeamMember() {
  return useMutation({
    mutationFn: (input: InviteTeamMemberInput) =>
      merchantFetch<{ invited: boolean; comingSoon: boolean; email: string }>(`${BASE}/invite`, {
        method: 'POST',
        body: input,
      }),
  });
}
