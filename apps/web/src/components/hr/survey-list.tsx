'use client';

import { useQuery } from '@tanstack/react-query';
import { ClipboardList, Plus, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { format } from 'date-fns';
import { enUS, fr as frLocale } from 'date-fns/locale';
import { EmptyState } from '@/components/layout/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiGet } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useHasPermission } from '@/stores/session';
import { SurveyCreateDialog } from './survey-create-dialog';
import { SURVEY_STATUSES, SURVEY_STATUS_TONE, type SurveyRow } from './survey-meta';
import { useSurveyScope } from './survey-scope';

const ALL = '__all__';

/** Survey register (search + status filter + table + create dialog) for the current survey scope. */
export function SurveyList() {
  const t = useTranslations('hrSurveys');
  const cfg = useSurveyScope();
  const tc = useTranslations('common');
  const router = useRouter();
  const locale = useLocale();
  const dl = locale === 'fr' ? frLocale : enUS;
  const hasPermission = useHasPermission();
  const canCreate = hasPermission(cfg.perms.create);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(ALL);
  const [createOpen, setCreateOpen] = useState(false);

  const params = new URLSearchParams({ pageSize: '200' });
  if (search) params.set('search', search);
  if (status !== ALL) params.set('status', status);

  const { data, isLoading } = useQuery({
    queryKey: [...cfg.queryKey, 'list', params.toString()],
    queryFn: () => apiGet<{ data: SurveyRow[] }>(`${cfg.api}?${params.toString()}`),
  });
  const rows = data?.data ?? [];
  const activeFilters = !!search || status !== ALL;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-auto">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="w-full pl-8 sm:w-64" placeholder={t('search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger size="sm" className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('allStatuses')}</SelectItem>
            {SURVEY_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{t(`statuses.${s}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canCreate && (
          <Button size="sm" className="ml-auto" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> {t('new')}
          </Button>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-80" />
      ) : !rows.length ? (
        <EmptyState
          icon={ClipboardList}
          title={activeFilters ? tc('noResults') : t('empty')}
          description={activeFilters ? '' : t('emptyDesc')}
          action={
            canCreate && !activeFilters ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" /> {t('new')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">{t('cols.reference')}</TableHead>
                <TableHead>{t('cols.title')}</TableHead>
                <TableHead className="text-center">{t('cols.status')}</TableHead>
                <TableHead className="text-center">{t('cols.questions')}</TableHead>
                <TableHead className="text-center">{t('cols.responses')}</TableHead>
                <TableHead>{t('cols.updated')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => (
                <TableRow key={s.id} className="cursor-pointer" onClick={() => router.push(cfg.route(s.id))}>
                  <TableCell className="font-mono text-xs text-muted-foreground">{s.reference}</TableCell>
                  <TableCell>
                    <div className="font-medium">{s.title}</div>
                    <div className="mt-0.5 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                      <span>{s.anonymous ? t('anonymousShort') : t('identifiedShort')}</span>
                      {s.closesAt && (
                        <span>· {t('closesOn', { date: format(new Date(s.closesAt), 'dd/MM/yyyy HH:mm', { locale: dl }) })}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="secondary" className={cn('text-[11px]', SURVEY_STATUS_TONE[s.status])}>
                      {s.expired ? t('expired') : t(`statuses.${s.status}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center text-sm tabular-nums">{s.questionCount}</TableCell>
                  <TableCell className="text-center text-sm tabular-nums">{s.responseCount}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(s.updatedAt), 'dd/MM/yyyy', { locale: dl })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <SurveyCreateDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(id) => router.push(cfg.route(id))} />
    </div>
  );
}
