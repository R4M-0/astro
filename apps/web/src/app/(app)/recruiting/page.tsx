'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Briefcase, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { EmptyState } from '@/components/layout/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { RANKING_TONE, type RankingStatus } from '@/components/recruiting/recruiting-meta';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FormDialog } from '@/components/ui/form-dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useHasPermission } from '@/stores/session';

interface OpeningRow {
  id: string;
  title: string;
  status: 'OPEN' | 'CLOSED';
  rankingStatus: RankingStatus;
  rankedAt: string | null;
  candidates: number;
  shortlisted: number;
}

export default function OpeningsPage() {
  const t = useTranslations('recruiting');
  const tc = useTranslations('common');
  const router = useRouter();
  const queryClient = useQueryClient();
  const canCreate = useHasPermission()('recruiting:create');
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['recruiting', 'openings'],
    queryFn: () => apiGet<OpeningRow[]>('/recruiting/openings'),
  });
  const rows = data ?? [];

  const create = useMutation({
    mutationFn: () => apiPost<{ id: string }>('/recruiting/openings', { title: title.trim(), description: description.trim() }),
    onSuccess: (o) => {
      queryClient.invalidateQueries({ queryKey: ['recruiting', 'openings'] });
      toast.success(t('created'));
      router.push(`/recruiting/${o.id}?tab=criteria`);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : tc('error')),
  });

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-4 p-4 sm:p-6">
      <PageHeader
        title={t('title')}
        description={t('desc')}
        actions={canCreate && <Button size="sm" onClick={() => setOpen(true)}><Plus className="size-4" /> {t('new')}</Button>}
      />

      {isLoading ? (
        <Skeleton className="h-80" />
      ) : !rows.length ? (
        <EmptyState
          icon={Briefcase}
          title={t('empty')}
          description={t('emptyDesc')}
          action={canCreate ? <Button onClick={() => setOpen(true)}><Plus className="size-4" /> {t('new')}</Button> : undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('cols.title')}</TableHead>
                <TableHead>{t('cols.status')}</TableHead>
                <TableHead className="text-center">{t('cols.candidates')}</TableHead>
                <TableHead className="text-center">{t('cols.shortlisted')}</TableHead>
                <TableHead>{t('cols.ranking')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((o) => (
                <TableRow key={o.id} className="cursor-pointer" onClick={() => router.push(`/recruiting/${o.id}`)}>
                  <TableCell className="font-medium">{o.title}</TableCell>
                  <TableCell className="text-sm">{t(`statuses.${o.status}`)}</TableCell>
                  <TableCell className="text-center tabular-nums">{o.candidates}</TableCell>
                  <TableCell className="text-center tabular-nums">{o.shortlisted}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={cn('text-[11px]', RANKING_TONE[o.rankingStatus])}>
                      {t(`rankingStatuses.${o.rankingStatus}`)}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t('new')}
        submitLabel={tc('create')}
        onSubmit={() => create.mutate()}
        submitting={create.isPending}
        disabled={!title.trim() || !description.trim()}
      >
        <Field label={t('fields.title')} required>
          <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={t('fields.description')} required>
          <Textarea rows={12} value={description} maxLength={20000} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </FormDialog>
    </div>
  );
}
