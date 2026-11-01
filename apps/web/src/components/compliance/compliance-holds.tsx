'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Plus, Unlock } from 'lucide-react';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { format } from 'date-fns';
import { enUS, fr as frLocale } from 'date-fns/locale';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, FormDialog } from '@/components/ui/form-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import { useHasPermission } from '@/stores/session';
import { SubjectPicker } from './subject-picker';
import type { LegalHold, Subject } from './types';

export function ComplianceHolds() {
  const t = useTranslations('compliance.holds');
  const tc = useTranslations('common');
  const locale = useLocale();
  const dateLocale = locale === 'fr' ? frLocale : enUS;
  const can = useHasPermission();
  const qc = useQueryClient();
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState<Subject | null>(null);
  const [reason, setReason] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['compliance', 'holds', all],
    queryFn: () => apiGet<LegalHold[]>(`/compliance/legal-holds?all=${all}`),
  });
  const onError = (e: unknown) => toast.error(e instanceof ApiError ? e.message : tc('error'));
  const create = useMutation({
    mutationFn: () => apiPost('/compliance/legal-holds', { subjectType: subject!.type, subjectId: subject!.id, reason: reason.trim() }),
    onSuccess: () => {
      toast.success(t('created'));
      setOpen(false);
      qc.invalidateQueries({ queryKey: ['compliance'] });
    },
    onError,
  });
  const release = useMutation({
    mutationFn: (id: string) => apiPost(`/compliance/legal-holds/${id}/release`),
    onSuccess: () => {
      toast.success(t('released'));
      qc.invalidateQueries({ queryKey: ['compliance'] });
    },
    onError,
  });

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={all} onCheckedChange={setAll} /> {t('showReleased')}
        </label>
        <div className="flex-1" />
        {can('compliance:update') && (
          <Button size="sm" onClick={() => { setSubject(null); setReason(''); setOpen(true); }}>
            <Plus className="size-4" /> {t('new')}
          </Button>
        )}
      </div>
      {isLoading ? (
        <Skeleton className="h-40" />
      ) : !data?.length ? (
        <p className="rounded-lg border py-10 text-center text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {data.map((h) => (
            <li key={h.id} className="flex items-start gap-3 px-4 py-3">
              {h.releasedAt ? <Unlock className="mt-0.5 size-4 text-muted-foreground" /> : <Lock className="mt-0.5 size-4 text-warning-ink" />}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{h.subjectLabel}</p>
                <p className="text-sm text-muted-foreground">{h.reason}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t('since', { date: format(new Date(h.createdAt), 'd MMM yyyy', { locale: dateLocale }) })}
                  {h.releasedAt && <> · {t('releasedOn', { date: format(new Date(h.releasedAt), 'd MMM yyyy', { locale: dateLocale }) })}</>}
                </p>
              </div>
              {!h.releasedAt && can('compliance:update') && (
                <Button size="sm" variant="outline" onClick={() => release.mutate(h.id)} disabled={release.isPending}>
                  {t('release')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t('new')}
        description={t('newDesc')}
        submitLabel={t('create')}
        onSubmit={() => create.mutate()}
        submitting={create.isPending}
        disabled={!subject || reason.trim().length < 3}
      >
        <Field label={t('subject')} required>
          <SubjectPicker value={subject} onChange={setSubject} />
        </Field>
        <Field label={t('reason')} required hint={t('reasonHint')}>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </FormDialog>
    </div>
  );
}
