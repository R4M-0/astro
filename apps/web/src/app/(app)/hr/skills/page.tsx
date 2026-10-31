'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { EmptyState } from '@/components/layout/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { SKILL_TYPES, SKILL_TYPE_TONE, type SkillRow } from '@/components/hr/hr-meta';
import { SkillDialog } from '@/components/hr/skill-dialog';
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

export default function SkillsPage() {
  const t = useTranslations('hr.skills');
  const tc = useTranslations('common');
  const queryClient = useQueryClient();
  const router = useRouter();
  const hasPermission = useHasPermission();
  const canCreate = hasPermission('skills:create');
  const canEdit = hasPermission('skills:update');
  const canDelete = hasPermission('skills:delete');

  const [search, setSearch] = useState('');
  const [type, setType] = useState(ALL);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<SkillRow | null>(null);

  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (type !== ALL) params.set('type', type);

  const { data, isLoading } = useQuery({
    queryKey: ['hr', 'skills', 'list', params.toString()],
    queryFn: () => apiGet<SkillRow[]>(`/hr/skills?${params.toString()}`),
  });
  const rows = data ?? [];
  const activeFilters = !!search || type !== ALL;

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/hr/skills/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr', 'skills'] });
      toast.success(t('deletedToast'));
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : tc('error')),
  });

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-4 p-4 sm:p-6">
      <PageHeader
        title={t('title')}
        description={t('desc')}
        actions={
          <div className="flex items-center gap-2">
            {canCreate && <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="size-4" /> {t('new')}</Button>}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-auto">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="w-full pl-8 sm:w-64" placeholder={t('search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger size="sm" className="w-44"><SelectValue placeholder={t('filters.allTypes')} /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('filters.allTypes')}</SelectItem>
            {SKILL_TYPES.map((s) => <SelectItem key={s} value={s}>{t(`types.${s}`)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <Skeleton className="h-80" />
      ) : !rows.length ? (
        <EmptyState
          icon={Award}
          title={activeFilters ? tc('noResults') : t('empty')}
          description={activeFilters ? '' : t('emptyDesc')}
          action={canCreate && !activeFilters ? <Button onClick={() => setCreateOpen(true)}><Plus className="size-4" /> {t('new')}</Button> : undefined}
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('cols.name')}</TableHead>
                <TableHead>{t('cols.type')}</TableHead>
                <TableHead>{t('cols.description')}</TableHead>
                <TableHead className="text-center">{t('cols.usage')}</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => (
                <TableRow key={s.id} className="cursor-pointer" onClick={() => router.push(`/hr/skills/${s.id}`)}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={cn('text-[11px]', SKILL_TYPE_TONE[s.type])}>{t(`types.${s.type}`)}</Badge>
                  </TableCell>
                  <TableCell className="max-w-md truncate text-sm text-muted-foreground">{s.description ?? '—'}</TableCell>
                  <TableCell className="text-center text-xs text-muted-foreground">
                    {t('usage', { jobs: s._count?.requirements ?? 0, evals: s._count?.evaluations ?? 0 })}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                      {canEdit && (
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditing(s)}>
                          <Pencil className="size-4" />
                        </Button>
                      )}
                      {canDelete && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-destructive"
                          onClick={() => confirm(t('deleteConfirm', { name: s.name })) && remove.mutate(s.id)}
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

      <SkillDialog open={createOpen} onOpenChange={setCreateOpen} />
      <SkillDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} skill={editing} />
    </div>
  );
}
