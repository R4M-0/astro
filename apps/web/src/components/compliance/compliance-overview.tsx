'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Download, Link2, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { formatDistanceToNow } from 'date-fns';
import { enUS, fr as frLocale } from 'date-fns/locale';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, apiDownload, apiGet } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useHasPermission } from '@/stores/session';
import type { CheckStatus, Overview, VerifyResult } from './types';

const STATUS: Record<CheckStatus, { icon: typeof CheckCircle2; cls: string }> = {
  ok: { icon: CheckCircle2, cls: 'text-success' },
  warn: { icon: AlertTriangle, cls: 'text-warning-ink' },
  fail: { icon: XCircle, cls: 'text-destructive' },
};

export function ComplianceOverview() {
  const t = useTranslations('compliance.overview');
  const tc = useTranslations('common');
  const locale = useLocale();
  const dateLocale = locale === 'fr' ? frLocale : enUS;
  const qc = useQueryClient();
  const can = useHasPermission();

  const { data, isLoading } = useQuery({
    queryKey: ['compliance', 'overview'],
    queryFn: () => apiGet<Overview>('/compliance/overview'),
  });

  const verify = useMutation({
    mutationFn: () => apiGet<VerifyResult>('/compliance/audit/verify'),
    onSuccess: (r) => {
      if (r.ok) toast.success(t('verifyOk', { entries: r.entries }));
      else toast.error(t('verifyBroken', { seq: r.firstBreak?.seq ?? 0, reason: t(`reasons.${r.firstBreak?.reason ?? 'hash'}`) }));
      qc.invalidateQueries({ queryKey: ['compliance', 'overview'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc('error')),
  });

  const exportAudit = useMutation({
    mutationFn: (format: 'csv' | 'json') => apiDownload(`/compliance/audit/export?format=${format}`, `audit.${format}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['compliance', 'overview'] }),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc('error')),
  });

  if (isLoading || !data) return <Skeleton className="h-96" />;
  const ago = (iso: string) => formatDistanceToNow(new Date(iso), { addSuffix: true, locale: dateLocale });

  const checkText = (c: Overview['checks'][number]) => {
    const d = c.data;
    switch (c.key) {
      case 'chain':
        if (!d.verifiedAt) return t('checks.chainNever');
        return c.status === 'ok'
          ? t('checks.chainOk', { entries: d.entries ?? 0, when: ago(d.verifiedAt) })
          : t('checks.chainBroken', { seq: d.firstBreak?.seq ?? 0, reason: t(`reasons.${d.firstBreak?.reason ?? 'hash'}`) });
      case 'seal':
        return d.ageHours == null ? t('checks.sealNever') : t('checks.seal', { hours: d.ageHours, seq: d.seq ?? 0 });
      case 'writes':
        return d.failures ? t('checks.writesFailed', { count: d.failures }) : t('checks.writesOk');
      case 'retention':
        return t('checks.retention', { enabled: d.enabled ?? 0, total: d.total ?? 0 });
      case 'requests':
        return d.overdue ? t('checks.requestsOverdue', { count: d.overdue }) : t('checks.requests', { open: d.open ?? 0, dueSoon: d.dueSoon ?? 0 });
    }
  };

  const tiles = [
    { label: t('tiles.activeEmployees'), value: data.personalData.activeEmployees },
    { label: t('tiles.formerEmployees'), value: data.personalData.formerEmployees },
    { label: t('tiles.candidates'), value: data.personalData.candidates },
    { label: t('tiles.anonymized'), value: data.personalData.anonymized },
    { label: t('tiles.openRequests'), value: data.requests.open },
    { label: t('tiles.legalHolds'), value: data.legalHolds },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {tiles.map((tile) => (
          <Card key={tile.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{tile.label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{tile.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <section className="rounded-lg border">
          <h3 className="border-b px-4 py-2.5 text-sm font-semibold">{t('checksTitle')}</h3>
          <ul>
            {data.checks.map((c) => {
              const s = STATUS[c.status];
              return (
                <li key={c.key} className="flex items-start gap-3 border-b px-4 py-3 last:border-b-0">
                  <s.icon className={cn('mt-0.5 size-4 shrink-0', s.cls)} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{t(`checks.${c.key}Title`)}</p>
                    <p className="text-sm text-muted-foreground">{checkText(c)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="flex flex-col gap-3 rounded-lg border p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">{t('chainTitle')}</h3>
          </div>
          <p className="text-sm text-muted-foreground">{t('chainIntro')}</p>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">{t('head')}</dt>
            <dd className="flex items-center gap-1 font-mono">
              <Link2 className="size-3" />#{data.audit.head.seq} · {data.audit.head.hash.slice(0, 20)}…
            </dd>
            <dt className="text-muted-foreground">{t('lastSeal')}</dt>
            <dd className="font-mono">
              {data.audit.lastSeal ? `#${data.audit.lastSeal.seq} · ${ago(data.audit.lastSeal.createdAt)}` : '—'}
            </dd>
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => verify.mutate()} disabled={verify.isPending}>
              {verify.isPending ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
              {t('verify')}
            </Button>
            {can('compliance:export') && (
              <>
                <Button size="sm" variant="outline" onClick={() => exportAudit.mutate('csv')} disabled={exportAudit.isPending}>
                  <Download className="size-4" /> CSV
                </Button>
                <Button size="sm" variant="outline" onClick={() => exportAudit.mutate('json')} disabled={exportAudit.isPending}>
                  <Download className="size-4" /> JSON
                </Button>
              </>
            )}
          </div>
          {can('compliance:export') && <p className="text-xs text-muted-foreground">{t('exportHint')}</p>}
        </section>
      </div>
    </div>
  );
}
