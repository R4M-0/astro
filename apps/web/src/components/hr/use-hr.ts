'use client';

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import type { EmployeeRow, SkillRow } from './hr-meta';

interface Site {
  id: string;
  name: string;
  departments: { id: string; name: string }[];
}

/** Flat list of departments (across sites) with a name resolver. */
export function useDepartments() {
  const { data } = useQuery({
    queryKey: ['org', 'sites'],
    queryFn: () => apiGet<Site[]>('/organizations/current/sites'),
    staleTime: 300_000,
  });
  const departments = (data ?? []).flatMap((s) =>
    s.departments.map((d) => ({ ...d, siteName: s.name })),
  );
  const nameOf = (id: string | null | undefined) =>
    id ? (departments.find((d) => d.id === id)?.name ?? '—') : '—';
  return { departments, nameOf };
}

/** All employees for selectors, with a name resolver. */
export function useEmployees() {
  const { data } = useQuery({
    queryKey: ['hr', 'employees', 'all'],
    queryFn: () => apiGet<{ data: EmployeeRow[] }>('/hr/employees?pageSize=500&sortBy=lastName&sortOrder=asc'),
    staleTime: 60_000,
  });
  const employees = data?.data ?? [];
  const nameOf = (id: string | null | undefined) => {
    if (!id) return '—';
    const e = employees.find((x) => x.id === id);
    return e ? `${e.firstName} ${e.lastName}` : '—';
  };
  return { employees, nameOf };
}

/** All skills, optionally filtered by type. */
export function useSkills() {
  const { data } = useQuery({
    queryKey: ['hr', 'skills', 'all'],
    queryFn: () => apiGet<SkillRow[]>('/hr/skills'),
    staleTime: 60_000,
  });
  const skills = data ?? [];
  return { skills };
}
