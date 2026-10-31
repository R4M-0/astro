'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search, Trash2, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { EmptyState } from '@/components/layout/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { EmployeeFormDialog } from '@/components/hr/employee-form-dialog';
import { DepartmentFilter } from '@/components/departments/department-select';
import { useDepartments } from '@/components/hr/use-hr';
import type { EmployeeRow } from '@/components/hr/hr-meta';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ApiError, apiDelete, apiGet } from '@/lib/api';
import { useHasPermission } from '@/stores/session';

const ALL = '__all__';

export default function EmployeesPage() {
  const t = useTranslations('hr.employees');
  const tc = useTranslations('common');
  const router = useRouter();
  const queryClient = useQueryClient();
  const { nameOf } = useDepartments();
  const hasPermission = useHasPermission();
  const canCreate = hasPermission('employees:create');
  const canEdit = hasPermission('employees:update');
  const canDelete = hasPermission('employees:delete');

  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [status, setStatus] = useState(ALL);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<EmployeeRow | null>(null);

  const params = new URLSearchParams({ pageSize: '200' });
  if (search) params.set('search', search);
  if (department) params.set('departmentId', department);
  if (status !== ALL) params.set('active', status === 'active' ? 'true' : 'false');

  const { data, isLoading } = useQuery({
    queryKey: ['hr', 'employees', 'list', params.toString()],
    queryFn: () => apiGet<{ data: EmployeeRow[]; meta: { total: number } }>(`/hr/employees?${params.toString()}`),
  });
  const rows = data?.data ?? [];
  const activeFilters = !!search || !!department || status !== ALL;

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/hr/employees/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr', 'employees'] });
      toast.success(t('deletedToast'));
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : tc('error')),
  });

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 p-4 sm:p-6">
      <PageHeader
        title={t('title')}
        description={t('desc')}
        actions={
          canCreate ? (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> {t('new')}
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <DepartmentFilter value={department} onChange={setDepartment} className="w-48" />
        <div className="relative w-full sm:w-auto">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="w-full pl-8 sm:w-64" placeholder={t('search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger size="sm" className="w-40"><SelectValue placeholder={t('filters.allStatuses')} /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('filters.allStatuses')}</SelectItem>
            <SelectItem value="active">{t('status.active')}</SelectItem>
            <SelectItem value="inactive">{t('status.inactive')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <Skeleton className="h-96" />
      ) : !rows.length ? (
        <EmptyState
          icon={Users}
          title={activeFilters ? t('noResults') : t('empty')}
          description={activeFilters ? t('noResultsDesc') : t('emptyDesc')}
          action={canCreate && !activeFilters ? <Button onClick={() => setCreateOpen(true)}><Plus className="size-4" /> {t('new')}</Button> : undefined}
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('cols.reference')}</TableHead>
                <TableHead>{t('cols.name')}</TableHead>
                <TableHead>{t('cols.contact')}</TableHead>
                <TableHead>{t('cols.email')}</TableHead>
                <TableHead>{t('cols.cin')}</TableHead>
                <TableHead>{t('cols.department')}</TableHead>
                <TableHead className="text-center">{t('cols.status')}</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((e) => (
                <TableRow
                  key={e.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/hr/employees/${e.id}`)}
                >
                  <TableCell className="font-mono text-xs text-muted-foreground">{e.reference}</TableCell>
                  <TableCell className="font-medium">
                    {e.firstName} {e.lastName}
                    {e.jobTitle && <div className="text-xs font-normal text-muted-foreground">{e.jobTitle}</div>}
                  </TableCell>
                  <TableCell className="text-sm">{e.contact ?? '—'}</TableCell>
                  <TableCell className="text-sm">{e.email ?? '—'}</TableCell>
                  <TableCell className="text-sm">{e.cin ?? '—'}</TableCell>
                  <TableCell className="text-sm">{nameOf(e.departmentId)}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant={e.active ? 'secondary' : 'outline'} className="text-[11px]">
                      {e.active ? t('status.active') : t('status.inactive')}
                    </Badge>
                  </TableCell>
                  <TableCell onClick={(ev) => ev.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      {canEdit && (
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditing(e)}>
                          <Pencil className="size-4" />
                        </Button>
                      )}
                      {canDelete && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-destructive"
                          onClick={() => confirm(t('deleteConfirm', { name: `${e.firstName} ${e.lastName}` })) && remove.mutate(e.id)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <EmployeeFormDialog open={createOpen} onOpenChange={setCreateOpen} onSaved={(id) => router.push(`/hr/employees/${id}`)} />
      <EmployeeFormDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} employee={editing} />
    </div>
  );
}
