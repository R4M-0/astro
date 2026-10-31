'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GraduationCap, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { format } from 'date-fns';
import { enUS, fr as frLocale } from 'date-fns/locale';
import { toast } from 'sonner';
import { DepartmentFilter } from '@/components/departments/department-select';
import { EmptyState } from '@/components/layout/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { TrainingFormDialog } from '@/components/hr/training-form-dialog';
import {
  HR_TRAINING_TYPES,
  TRAINING_STATUSES,
  TRAINING_STATUS_TONE,
  type TrainingRow,
} from '@/components/hr/hr-meta';
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

export default function TrainingsPage() {
  const t = useTranslations('hr.trainings');
  const tc = useTranslations('common');
  const router = useRouter();
  const queryClient = useQueryClient();
  const locale = useLocale();
  const dl = locale === 'fr' ? frLocale : enUS;
  const hasPermission = useHasPermission();
  const canCreate = hasPermission('hr-trainings:create');
  const canEdit = hasPermission('hr-trainings:update');
  const canDelete = hasPermission('hr-trainings:delete');

  const [search, setSearch] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [status, setStatus] = useState(ALL);
  const [type, setType] = useState(ALL);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<TrainingRow | null>(null);

  const params = new URLSearchParams({ pageSize: '200' });
  if (search) params.set('search', search);
  if (status !== ALL) params.set('status', status);
  if (type !== ALL) params.set('type', type);
  if (departmentId) params.set('departmentId', departmentId);

  const { data, isLoading } = useQuery({
    queryKey: ['hr', 'trainings', 'list', params.toString()],
    queryFn: () => apiGet<{ data: TrainingRow[] }>(`/hr/trainings?${params.toString()}`),
  });
  const rows = data?.data ?? [];
  const activeFilters = !!search || !!departmentId || status !== ALL || type !== ALL;

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/hr/trainings/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr', 'trainings'] });
      toast.success(t('deletedToast'));
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : tc('error')),
  });

  const fmtDates = (a: string | null, b: string | null) => {
    if (!a && !b) return '—';
    const f = (d: string | null) => (d ? format(new Date(d), 'dd/MM/yy', { locale: dl }) : '…');
    return `${f(a)} → ${f(b)}`;
  };

  return (
    <div className="mx-auto flex max-w-[1300px] flex-col gap-4 p-4 sm:p-6">
      <PageHeader
        title={t('title')}
        description={t('desc')}
        actions={canCreate ? <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="size-4" /> {t('new')}</Button> : undefined}
      />

      <div className="flex flex-wrap items-center gap-2">
        <DepartmentFilter value={departmentId} onChange={setDepartmentId} className="w-48" />
        <div className="relative w-full sm:w-auto">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="w-full pl-8 sm:w-64" placeholder={t('search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger size="sm" className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('filters.allStatuses')}</SelectItem>
            {TRAINING_STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`statuses.${s}`)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger size="sm" className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('filters.allTypes')}</SelectItem>
            {HR_TRAINING_TYPES.map((s) => <SelectItem key={s} value={s}>{t(`types.${s}`)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <Skeleton className="h-80" />
      ) : !rows.length ? (
        <EmptyState
          icon={GraduationCap}
          title={activeFilters ? tc('noResults') : t('empty')}
          description={activeFilters ? '' : t('emptyDesc')}
          action={canCreate && !activeFilters ? <Button onClick={() => setCreateOpen(true)}><Plus className="size-4" /> {t('new')}</Button> : undefined}
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('cols.code')}</TableHead>
                <TableHead>{t('cols.theme')}</TableHead>
                <TableHead>{t('cols.type')}</TableHead>
                <TableHead>{t('cols.dates')}</TableHead>
                <TableHead className="text-center">{t('cols.participants')}</TableHead>
                <TableHead className="text-center">{t('cols.responses')}</TableHead>
                <TableHead className="text-center">{t('cols.status')}</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((tr) => (
                <TableRow key={tr.id} className="cursor-pointer" onClick={() => router.push(`/hr/trainings/${tr.id}`)}>
                  <TableCell className="font-mono text-xs text-muted-foreground">{tr.code}</TableCell>
                  <TableCell className="font-medium">{tr.theme}</TableCell>
                  <TableCell className="text-sm">{t(`types.${tr.type}`)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{fmtDates(tr.startDate, tr.endDate)}</TableCell>
                  <TableCell className="text-center text-sm tabular-nums">{tr.participantCount ?? 0}</TableCell>
                  <TableCell className="text-center text-sm tabular-nums">{tr.feedbackCount ?? 0}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant="secondary" className={cn('text-[11px]', TRAINING_STATUS_TONE[tr.status])}>{t(`statuses.${tr.status}`)}</Badge>
                  </TableCell>
                  <TableCell onClick={(ev) => ev.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      {canEdit && (
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditing(tr)}>
                          <Pencil className="size-4" />
                        </Button>
                      )}
                      {canDelete && (
                        <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => confirm(t('deleteConfirm', { theme: tr.theme })) && remove.mutate(tr.id)}>
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

      <TrainingFormDialog open={createOpen} onOpenChange={setCreateOpen} onSaved={(id) => router.push(`/hr/trainings/${id}`)} />
      <TrainingFormDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} training={editing} />
    </div>
  );
}
