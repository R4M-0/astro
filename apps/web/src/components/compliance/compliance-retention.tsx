'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Loader2, Play } from 'lucide-react';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { format } from 'date-fns';
import { enUS, fr as frLocale } from 'date-fns/locale';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { ApiError, apiGet, apiPatch, apiPost } from '@/lib/api';
import { useHasPermission } from '@/stores/session';
import { RETENTION_MIN_DAYS, type RetentionCategory, type RetentionPolicy, type RetentionRun } from './types';

export function ComplianceRetention() {
  const t = useTranslations('compliance.retention');
  const tc = useTranslations('common');
  const locale = useLocale();
  const dateLocale = locale === 'fr' ? frLocale : enUS;
  const can = useHasPermission();
  const qc = useQueryClient();
  const [preview, setPreview] = useState<RetentionRun | null>(null);
  const [confirmRun, setConfirmRun] = useState(false);
  const [days, setDays] = useState<Partial<Record<RetentionCategory, string>>>({});
  const canEdit = can('compliance:update');

  const { data, isLoading } = useQuery({
    queryKey: ['compliance', 'retention'],
    queryFn: () => apiGet<{ policies: RetentionPolicy[]; runs: RetentionRun[] }>('/compliance/retention'),
  });
  const onError = (e: unknown) => toast.error(e instanceof ApiError ? e.message : tc('error'));

  const update = useMutation({
    mutationFn: ({ category, body }: { category: RetentionCategory; body: { enabled?: boolean; retentionDays?: number } }) =>
      apiPatch(`/compliance/retention/${category}`, body),
    onSuccess: () => {
      toast.success(t('saved'));
      qc.invalidateQueries({ queryKey: ['compliance'] });
    },
    onError,
  });
  const dryRun = useMutation({
    mutationFn: () => apiPost<RetentionRun>('/compliance/retention/preview'),
    onSuccess: (run) => {
      setPreview(run);
      qc.invalidateQueries({ queryKey: ['compliance', 'retention'] });
    },
    onError,
  });
  const runNow = useMutation({
    mutationFn: () => apiPost<RetentionRun>('/compliance/retention/run'),
    onSuccess: (run) => {
      const applied = Object.values(run.results).reduce((n, r) => n + (r?.applied ?? 0), 0);
      toast.success(t('ran', { count: applied }));
      setConfirmRun(false);
      qc.invalidateQueries({ queryKey: ['compliance'] });
    },
    onError,
  });

  if (isLoading || !data) return <Skeleton className="h-80" />;
  const latest = preview ?? data.runs.find((r) => r.dryRun) ?? null;
  const years = (d: number) => (d % 365 === 0 ? t('years', { count: d / 365 }) : t('days', { count: d }));

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t('intro')}</p>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">{t('columns.category')}</th>
              <th className="px-3 py-2 text-left font-medium">{t('columns.duration')}</th>
              <th className="px-3 py-2 text-left font-medium">{t('columns.action')}</th>
              <th className="px-3 py-2 text-left font-medium">{t('columns.due')}</th>
              <th className="px-3 py-2 text-left font-medium">{t('columns.enabled')}</th>
            </tr>
          </thead>
          <tbody>
            {data.policies.map((p) => {
              const r = latest?.results[p.category];
              const draft = days[p.category];
              return (
                <tr key={p.category} className="border-t align-top">
                  <td className="px-3 py-2.5">
                    <p className="font-medium">{t(`categories.${p.category}.name`)}</p>
                    <p className="text-xs text-muted-foreground">{t(`categories.${p.category}.clock`)}</p>
                  </td>
                  <td className="px-3 py-2.5">
                    {canEdit ? (
                      <div className="flex items-center gap-1.5">
                        <Input
                          type="number"
                          className="h-8 w-24"
                          min={RETENTION_MIN_DAYS[p.category]}
                          value={draft ?? String(p.retentionDays)}
                          onChange={(e) => setDays((d) => ({ ...d, [p.category]: e.target.value }))}
                          onBlur={() => {
                            const v = Number(draft);
                            if (draft !== undefined && v !== p.retentionDays && Number.isInteger(v)) {
                              update.mutate({ category: p.category, body: { retentionDays: v } });
                            }
                            setDays((d) => ({ ...d, [p.category]: undefined }));
                          }}
                        />
                        <span className="text-xs text-muted-foreground">{t('daysUnit')}</span>
                      </div>
                    ) : (
                      years(p.retentionDays)
                    )}
                    <p className="mt-0.5 text-xs text-muted-foreground">{years(p.retentionDays)}</p>
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge variant="outline">{t(`action.${p.action}`)}</Badge>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">
                    {r ? (
                      <span>
                        {r.due}
                        {r.held > 0 && <span className="text-xs text-muted-foreground"> · {t('held', { count: r.held })}</span>}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {canEdit ? (
                      <Switch
                        checked={p.enabled}
                        onCheckedChange={(enabled) => update.mutate({ category: p.category, body: { enabled } })}
                        aria-label={t('columns.enabled')}
                      />
                    ) : (
                      <span>{p.enabled ? t('on') : t('off')}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => dryRun.mutate()} disabled={dryRun.isPending}>
          {dryRun.isPending ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
          {t('preview')}
        </Button>
        {can('compliance:approve') && (
          <Button size="sm" onClick={() => setConfirmRun(true)} disabled={!data.policies.some((p) => p.enabled)}>
            <Play className="size-4" /> {t('runNow')}
          </Button>
        )}
        {latest && (
          <span className="text-xs text-muted-foreground">
            {t('previewAt', { date: format(new Date(latest.startedAt), 'd MMM yyyy HH:mm', { locale: dateLocale }) })}
          </span>
        )}
      </div>

      <section>
        <h3 className="mb-2 text-sm font-semibold">{t('history')}</h3>
        {!data.runs.filter((r) => !r.dryRun).length ? (
          <p className="text-sm text-muted-foreground">{t('noRuns')}</p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {data.runs.filter((r) => !r.dryRun).map((r) => {
              const sum = (k: 'applied' | 'held') => Object.values(r.results).reduce((n, x) => n + (x?.[k] ?? 0), 0);
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 px-3 py-2">
                  <span className="tabular-nums">{format(new Date(r.startedAt), 'd MMM yyyy HH:mm', { locale: dateLocale })}</span>
                  <span className="text-muted-foreground">{r.triggeredById ? t('manual') : t('daily')}</span>
                  <span>{t('applied', { count: sum('applied') })}</span>
                  {sum('held') > 0 && <span className="text-muted-foreground">{t('held', { count: sum('held') })}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Dialog open={confirmRun} onOpenChange={setConfirmRun}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('confirmTitle')}</DialogTitle>
            <DialogDescription>{t('confirmDesc')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRun(false)}>{tc('cancel')}</Button>
            <Button variant="destructive" onClick={() => runNow.mutate()} disabled={runNow.isPending}>
              {runNow.isPending && <Loader2 className="size-4 animate-spin" />}
              {t('runNow')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
