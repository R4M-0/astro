'use client';

import { useQuery } from '@tanstack/react-query';
import { Check, Copy, ExternalLink, Send } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { EmptyState } from '@/components/layout/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiGet } from '@/lib/api';
import { cn } from '@/lib/utils';

interface TrainingWithTokens {
  id: string;
  code: string;
  theme: string;
  hotToken: string | null;
  coldToken: string | null;
}
interface PerTraining {
  id: string;
  hot: { count: number; rate: number | null };
  cold: { count: number; rate: number | null };
}

function LinkCell({ token, count }: { token: string | null; count: number }) {
  const t = useTranslations('hr.trainingEvaluation');
  const [copied, setCopied] = useState(false);
  if (!token) return <span className="text-xs tabular-nums text-muted-foreground">{count}</span>;
  const url = typeof window !== 'undefined' ? `${window.location.origin}/f/${token}` : `/f/${token}`;
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        onClick={() => {
          navigator.clipboard.writeText(url);
          setCopied(true);
          toast.success(t('copied'));
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
      </Button>
      <Button variant="ghost" size="icon" className="size-7" asChild>
        <a href={url} target="_blank" rel="noreferrer"><ExternalLink className="size-3.5" /></a>
      </Button>
    </div>
  );
}

export default function TrainingEvaluationHubPage() {
  const t = useTranslations('hr.trainingEvaluation');

  const { data: list, isLoading } = useQuery({
    queryKey: ['hr', 'trainings', 'list', 'tokens'],
    queryFn: () => apiGet<{ data: TrainingWithTokens[] }>('/hr/trainings?pageSize=300'),
  });
  const { data: dash } = useQuery({
    queryKey: ['hr', 'trainings', 'dashboard'],
    queryFn: () => apiGet<{ perTraining: PerTraining[] }>('/hr/trainings/dashboard'),
  });

  const rows = list?.data ?? [];
  const perById = new Map((dash?.perTraining ?? []).map((p) => [p.id, p]));

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-4 p-4 sm:p-6">
      <PageHeader title={t('title')} description={t('desc')} />

      {isLoading ? (
        <Skeleton className="h-80" />
      ) : !rows.length ? (
        <EmptyState icon={Send} title={t('empty')} description={t('emptyDesc')} />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('training')}</TableHead>
                <TableHead>{t('hot')}</TableHead>
                <TableHead>{t('cold')}</TableHead>
                <TableHead className="text-center">{t('rate')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((tr) => {
                const p = perById.get(tr.id);
                const rates = p ? [p.hot.rate, p.cold.rate].filter((r): r is number => r != null) : [];
                const avgRate = rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : null;
                return (
                  <TableRow key={tr.id}>
                    <TableCell>
                      <div className="font-medium">{tr.theme}</div>
                      <div className="font-mono text-xs text-muted-foreground">{tr.code}</div>
                    </TableCell>
                    <TableCell><LinkCell token={tr.hotToken} count={p?.hot.count ?? 0} /></TableCell>
                    <TableCell><LinkCell token={tr.coldToken} count={p?.cold.count ?? 0} /></TableCell>
                    <TableCell className="text-center">
                      {avgRate != null ? (
                        <span className={cn('rounded-md px-2 py-0.5 text-sm font-semibold', avgRate >= 60 ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/15 text-amber-600 dark:text-amber-400')}>{avgRate}%</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
