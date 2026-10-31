'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ScrollText, Search, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { EmptyState } from '@/components/layout/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { DepartmentFilter } from '@/components/departments/department-select';
import { useDepartments } from '@/components/hr/use-hr';
import { JD_STATUSES, JD_STATUS_TONE, type JobDescriptionRow } from '@/components/hr/hr-meta';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ApiError, apiDelete, apiGet } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useHasPermission } from '@/stores/session';

const ALL = '__all__';

export default function JobDescriptionsPage() {
  const t = useTranslations('hr.jobDescriptions');
  const tc = useTranslations('common');
  const router = useRouter();
  const queryClient = useQueryClient();
  const { nameOf } = useDepartments();
  const hasPermission = useHasPermission();
  const canCreate = hasPermission('job-descriptions:create');
  const canDelete = hasPermission('job-descriptions:delete');

  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [status, setStatus] = useState(ALL);

  const params = new URLSearchParams({ pageSize: '200' });
  if (search) params.set('search', search);
  if (department) params.set('departmentId', department);
  if (status !== ALL) params.set('status', status);

  const { data, isLoading } = useQuery({
    queryKey: ['hr', 'job-descriptions', 'list', params.toString()],
    queryFn: () => apiGet<{ data: JobDescriptionRow[] }>(`/hr/job-descriptions?${params.toString()}`),
  });
  const rows = data?.data ?? [];
  const activeFilters = !!search || !!department || status !== ALL;

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/hr/job-descriptions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr', 'job-descriptions'] });
      toast.success(t('deletedToast'));
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : tc('error')),
  });

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-4 p-4 sm:p-6">
      <PageHeader
        title={t('title')}
        description={t('desc')}
        actions={canCreate ? <Button size="sm" onClick={() => router.push('/hr/job-descriptions/new')}><Plus className="size-4" /> {t('new')}</Button> : undefined}
      />

      <div className="flex flex-wrap items-center gap-2">
        <DepartmentFilter value={department} onChange={setDepartment} className="w-48" />
        <div className="relative w-full sm:w-auto">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="w-full pl-8 sm:w-64" placeholder={t('search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger size="sm" className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('filters.allStatuses')}</SelectItem>
            {JD_STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`statuses.${s}`)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <Skeleton className="h-80" />
      ) : !rows.length ? (
        <EmptyState
          icon={ScrollText}
          title={activeFilters ? tc('noResults') : t('empty')}
          description={activeFilters ? '' : t('emptyDesc')}
          action={canCreate && !activeFilters ? <Button onClick={() => router.push('/hr/job-descriptions/new')}><Plus className="size-4" /> {t('new')}</Button> : undefined}
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('cols.reference')}</TableHead>
                <TableHead>{t('cols.jobTitle')}</TableHead>
                <TableHead>{t('cols.version')}</TableHead>
                <TableHead>{t('cols.department')}</TableHead>
                <TableHead className="text-center">{t('cols.assigned')}</TableHead>
                <TableHead className="text-center">{t('cols.status')}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((j) => (
                <TableRow key={j.id} className="cursor-pointer" onClick={() => router.push(`/hr/job-descriptions/${j.id}`)}>
                  <TableCell className="font-mono text-xs text-muted-foreground">{j.reference}</TableCell>
                  <TableCell>
                    <div className="font-medium">{j.jobTitle}</div>
                    {j.authority && (
                      <div className="max-w-md truncate text-xs text-muted-foreground" title={j.authority}>
                        {t('fields.authority')} : {j.authority}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">v{j.version}</TableCell>
                  <TableCell className="text-sm">{nameOf(j.departmentId)}</TableCell>
                  <TableCell className="text-center text-sm tabular-nums">{j.assignedCount ?? 0}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant="secondary" className={cn('text-[11px]', JD_STATUS_TONE[j.status])}>{t(`statuses.${j.status}`)}</Badge>
                  </TableCell>
                  <TableCell onClick={(ev) => ev.stopPropagation()}>
                    {canDelete && (
                      <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => confirm(t('deleteConfirm', { title: j.jobTitle })) && remove.mutate(j.id)}>
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
