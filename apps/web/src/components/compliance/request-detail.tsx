'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Download, Eraser, Loader2, Lock, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { differenceInCalendarDays, format } from 'date-fns';
import { enUS, fr as frLocale } from 'date-fns/locale';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/form-dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, apiDownload, apiGet, apiPost } from '@/lib/api';
import { useHasPermission } from '@/stores/session';
import { DsrStatusBadge } from './compliance-requests';
import type { Dsr } from './types';

type Pending = 'complete' | 'reject' | 'execute' | null;

export function RequestDetail({ id }: { id: string }) {
  const t = useTranslations('compliance.request');
  const tr = useTranslations('compliance.requests');
  const tc = useTranslations('common');
  const locale = useLocale();
  const dateLocale = locale === 'fr' ? frLocale : enUS;
  const can = useHasPermission();
  const qc = useQueryClient();
  const [pending, setPending] = useState<Pending>(null);
  const [resolution, setResolution] = useState('');
  const [confirmText, setConfirmText] = useState('');

  const { data: dsr, isLoading } = useQuery({
    queryKey: ['compliance', 'request', id],
    queryFn: () => apiGet<Dsr>(`/compliance/requests/${id}`),
  });
  const onError = (e: unknown) => toast.error(e instanceof ApiError ? e.message : tc('error'));
  const done = (msg: string) => {
    toast.success(msg);
    setPending(null);
    setResolution('');
    setConfirmText('');
    qc.invalidateQueries({ queryKey: ['compliance'] });
  };

  const exportData = useMutation({
    mutationFn: () => apiDownload(`/compliance/requests/${id}/export`, `${dsr?.reference ?? 'export'}.json`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['compliance', 'request', id] }),
    onError,
  });
  const act = useMutation({
    mutationFn: (action: Exclude<Pending, null>) =>
      apiPost(`/compliance/requests/${id}/${action}`, action === 'execute' ? undefined : { resolution: resolution.trim() || undefined }),
    onSuccess: (_r, action) => done(t(`done.${action}`)),
    onError,
  });

  if (isLoading || !dsr) return <div className="p-6"><Skeleton className="h-96" /></div>;

  const open = dsr.status === 'OPEN';
  const daysLeft = differenceInCalendarDays(new Date(dsr.dueAt), new Date());
  const fmt = (iso: string) => format(new Date(iso), 'd MMMM yyyy', { locale: dateLocale });
  const result = dsr.result ?? {};

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4 sm:p-6">
      <Link href="/compliance?tab=requests" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:underline">
        <ArrowLeft className="size-4" /> {t('back')}
      </Link>
      <PageHeader title={`${dsr.reference} · ${tr(`type.${dsr.type}`)}`} description={dsr.subjectLabel} />

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <DsrStatusBadge dsr={dsr} />
        {open && (
          <span className={daysLeft < 0 ? 'text-destructive' : daysLeft <= 7 ? 'text-warning-ink' : 'text-muted-foreground'}>
            {daysLeft < 0 ? t('lateBy', { count: -daysLeft }) : t('daysLeft', { count: daysLeft })}
          </span>
        )}
      </div>

      {dsr.legalHold && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          <Lock className="mt-0.5 size-4 shrink-0 text-warning-ink" />
          <div>
            <p className="font-medium">{t('holdTitle')}</p>
            <p className="text-muted-foreground">{dsr.legalHold.reason}</p>
          </div>
        </div>
      )}

      <section className="rounded-lg border p-4">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
          <dt className="text-muted-foreground">{t('subject')}</dt>
          <dd>{dsr.subjectLabel} · {t(`subjectType.${dsr.subjectType}`)}</dd>
          <dt className="text-muted-foreground">{t('received')}</dt>
          <dd>{fmt(dsr.receivedAt)}{dsr.channel && <> · {dsr.channel}</>}</dd>
          <dt className="text-muted-foreground">{t('due')}</dt>
          <dd>{fmt(dsr.dueAt)}</dd>
          {dsr.requesterEmail && (
            <>
              <dt className="text-muted-foreground">{t('requester')}</dt>
              <dd>{dsr.requesterEmail}</dd>
            </>
          )}
          {dsr.notes && (
            <>
              <dt className="text-muted-foreground">{t('notes')}</dt>
              <dd className="whitespace-pre-wrap">{dsr.notes}</dd>
            </>
          )}
          {dsr.completedAt && (
            <>
              <dt className="text-muted-foreground">{t('closed')}</dt>
              <dd>{fmt(dsr.completedAt)}</dd>
            </>
          )}
          {dsr.resolution && (
            <>
              <dt className="text-muted-foreground">{t('resolution')}</dt>
              <dd className="whitespace-pre-wrap">{dsr.resolution}</dd>
            </>
          )}
        </dl>
      </section>

      {dsr.type === 'ACCESS' && (
        <section className="flex flex-col gap-3 rounded-lg border p-4">
          <h3 className="text-sm font-semibold">{t('accessTitle')}</h3>
          <p className="text-sm text-muted-foreground">{t('accessDesc')}</p>
          {typeof result.exportedAt === 'string' && (
            <p className="text-xs text-muted-foreground">
              {t('lastExport', { date: format(new Date(result.exportedAt), 'd MMM yyyy HH:mm', { locale: dateLocale }) })}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {can('compliance:export') && (
              <Button size="sm" variant="outline" onClick={() => exportData.mutate()} disabled={exportData.isPending}>
                {exportData.isPending ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                {t('export')}
              </Button>
            )}
            {open && can('compliance:update') && (
              <Button size="sm" onClick={() => setPending('complete')}>
                <Check className="size-4" /> {t('complete')}
              </Button>
            )}
          </div>
        </section>
      )}

      {dsr.type === 'ERASURE' && (
        <section className="flex flex-col gap-3 rounded-lg border p-4">
          <h3 className="text-sm font-semibold">{t('erasureTitle')}</h3>
          <p className="text-sm text-muted-foreground">{t('erasureDesc')}</p>
          {dsr.status === 'COMPLETED' && typeof result.historyScrubbed === 'number' && (
            <ul className="list-inside list-disc text-sm text-muted-foreground">
              <li>{t('result.history', { count: result.historyScrubbed })}</li>
              <li>{t('result.audit', { count: Number(result.auditRedacted ?? 0) })}</li>
              <li>{t('result.files', { count: Number(result.filesDeleted ?? 0) })}</li>
            </ul>
          )}
          {open && can('compliance:approve') && !dsr.legalHold && (
            <div>
              <Button size="sm" variant="destructive" onClick={() => setPending('execute')}>
                <Eraser className="size-4" /> {t('execute')}
              </Button>
            </div>
          )}
        </section>
      )}

      {open && can('compliance:update') && (
        <div>
          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setPending('reject')}>
            <X className="size-4" /> {t('reject')}
          </Button>
        </div>
      )}

      <Dialog open={pending !== null} onOpenChange={(v) => !v && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pending ? t(`confirm.${pending}.title`) : ''}</DialogTitle>
            <DialogDescription>{pending ? t(`confirm.${pending}.desc`, { reference: dsr.reference }) : ''}</DialogDescription>
          </DialogHeader>
          {pending === 'execute' ? (
            <Field label={t('confirm.execute.type', { reference: dsr.reference })}>
              <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={dsr.reference} />
            </Field>
          ) : (
            <Field label={t('resolution')} required={pending === 'reject'}>
              <Textarea rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} />
            </Field>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>{tc('cancel')}</Button>
            <Button
              variant={pending === 'complete' ? 'default' : 'destructive'}
              disabled={
                act.isPending ||
                (pending === 'execute' && confirmText.trim() !== dsr.reference) ||
                (pending === 'reject' && resolution.trim().length < 3)
              }
              onClick={() => pending && act.mutate(pending)}
            >
              {act.isPending && <Loader2 className="size-4 animate-spin" />}
              {pending ? t(`confirm.${pending}.cta`) : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
