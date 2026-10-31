'use client';

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';

interface Member {
  user: { id: string; firstName: string; lastName: string };
}

/** Org members with a helper to resolve a user id to a display name. */
export function useMembers() {
  const { data } = useQuery({
    queryKey: ['users', 'directory'],
    queryFn: () => apiGet<{ data: Member[] }>('/users/directory'),
    staleTime: 300_000,
  });
  const members = data?.data ?? [];
  const nameOf = (id: string | null | undefined) => {
    if (!id) return '—';
    const m = members.find((x) => x.user.id === id);
    return m ? `${m.user.firstName} ${m.user.lastName}` : '—';
  };
  const initialsOf = (id: string | null | undefined) => {
    if (!id) return '·';
    const m = members.find((x) => x.user.id === id);
    return m ? `${m.user.firstName[0] ?? ''}${m.user.lastName[0] ?? ''}`.toUpperCase() : '·';
  };
  return { members, nameOf, initialsOf };
}
