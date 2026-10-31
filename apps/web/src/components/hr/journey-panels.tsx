'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, BadgeCheck, CheckCircle2, ShieldOff, UserCheck } from 'lucide-react';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useMembers } from '@/components/hr/use-members';
import { Panel } from '@/components/layout/stat';
import { isReauthError, useESign } from '@/components/signatures/esign-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/form-dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useHasPermission, useSession } from '@/stores/session';
import { TRIAL_DECISIONS, toDateInput, type JourneyDetail, type TrialDecision } from './hr-meta';

const DECISION_TONE: Record<TrialDecision, string> = {
  CONFIRMED: 'border-emerald-500/50 bg-emerald-500/10',
  EXTENDED: 'border-amber-500/50 bg-amber-500/10',
  TERMINATED: 'border-rose-500/50 bg-rose-500/10',
};

function useJourneyCache(id: string) {
  const qc = useQueryClient();
  return (j: JourneyDetail) => {
    qc.setQueryData(['hr', 'journeys', 'detail', id], j);
    qc.invalidateQueries({ queryKey: ['hr'] });
  };
}

/** End of trial period: e-signed decision (confirm / extend / end). */
export function TrialSignOffPanel({ journey, canEdit }: { journey: JourneyDetail; canEdit: boolean }) {
  const t = useTranslations('hr.journeys');
  const tc = useTranslations('common');
  const locale = useLocale();
  const me = useSession((s) => s.user?.id);
  const esign = useESign();
  const update = useJourneyCache(journey.id);
  const [decision, setDecision] = useState<TrialDecision>('CONFIRMED');
  const [comment, setComment] = useState('');
  const [extendedUntil, setExtendedUntil] = useState('');
  const self = !!journey.employee.userId && journey.employee.userId === me;
  const open = journey.status === 'IN_PROGRESS';
  const needsComment = decision !== 'CONFIRMED';
  const valid = (!needsComment || !!comment.trim()) && (decision !== 'EXTENDED' || !!extendedUntil);
  const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString(locale) : '—');

  const sign = () =>
    esign.request({
      title: t('trial.signTitle'),
      description: t('trial.signDesc', { name: `${journey.employee.firstName} ${journey.employee.lastName}` }),
      summary: t(`decisions.${decision}`),
      confirmLabel: t('trial.sign'),
      onSign: async (payload) => {
        try {
          const j = await apiPost<JourneyDetail>(`/hr/journeys/${journey.id}/trial-signoff`, {
            decision,
            comment: comment.trim() || undefined,
            extendedUntil: decision === 'EXTENDED' ? extendedUntil : undefined,
            esign: payload,
          });
          update(j);
          setComment('');
          toast.success(t('trial.signedToast'));
        } catch (e) {
          if (!isReauthError(e)) toast.error(e instanceof ApiError ? e.message : tc('error'));
          throw e;
        }
      },
    });

  return (
    <div className="flex flex-col gap-4">
      {journey.trialDecision && (
        <Panel title={t('trial.lastDecision')} icon={BadgeCheck}>
          <div className={cn('rounded-lg border p-3', DECISION_TONE[journey.trialDecision])}>
            <p className="text-sm font-semibold">{t(`decisions.${journey.trialDecision}`)}</p>
            {journey.trialComment && <p className="mt-1 whitespace-pre-wrap text-sm">{journey.trialComment}</p>}
            <p className="mt-2 text-xs text-muted-foreground">
              {t('trial.signedBy', {
                name: journey.trialSignatureView?.signer?.name ?? '—',
                date: fmt(journey.trialSignedAt),
              })}
            </p>
          </div>
        </Panel>
      )}

      {open && (
        <Panel title={t('trial.title')} icon={UserCheck}>
          <p className="mb-3 text-sm text-muted-foreground">
            {t('trial.endsOn', { date: fmt(journey.targetDate) })} · {t('trial.progress', { done: journey.progress.done, total: journey.progress.total })}
          </p>
          {!canEdit ? (
            <p className="text-sm text-muted-foreground">{t('trial.readOnly')}</p>
          ) : self ? (
            <p className="text-sm text-muted-foreground">{t('trial.selfForbidden')}</p>
          ) : (
            <div className="flex max-w-2xl flex-col gap-3">
              <div className="grid gap-2 sm:grid-cols-3">
                {TRIAL_DECISIONS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDecision(d)}
                    className={cn(
                      'rounded-lg border p-3 text-left text-sm transition-colors',
                      decision === d ? DECISION_TONE[d] : 'hover:bg-accent',
                    )}
                  >
                    <p className="font-medium">{t(`decisions.${d}`)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t(`decisionHints.${d}`)}</p>
                  </button>
                ))}
              </div>
              {decision === 'EXTENDED' && (
                <Field label={t('trial.extendedUntil')} required>
                  <Input type="date" value={extendedUntil} min={toDateInput(journey.targetDate) || undefined} onChange={(e) => setExtendedUntil(e.target.value)} />
                </Field>
              )}
              <Field label={t('trial.comment')} required={needsComment}>
                <Textarea rows={3} value={comment} maxLength={4000} onChange={(e) => setComment(e.target.value)} placeholder={t('trial.commentPlaceholder')} />
              </Field>
              {journey.progress.done < journey.progress.total && (
                <p className="text-xs text-amber-600 dark:text-amber-400">{t('trial.stepsPending', { count: journey.progress.total - journey.progress.done })}</p>
              )}
              <div>
                <Button disabled={!valid} onClick={sign}>
                  <BadgeCheck className="size-4" /> {t('trial.sign')}
                </Button>
              </div>
            </div>
          )}
        </Panel>
      )}
      {esign.dialog}
    </div>
  );
}

interface HandoverPreview {
  userId: string | null;
  membership: { id: string; isActive: boolean; deactivatedAt: string | null } | null;
  categories: { key: string; count: number }[];
}

/** Offboarding: hand over open records, deactivate the account, close the departure. */
export function OffboardingPanel({ journey, canEdit }: { journey: JourneyDetail; canEdit: boolean }) {
  const t = useTranslations('hr.journeys');
  const tc = useTranslations('common');
  const locale = useLocale();
  const has = useHasPermission();
  const { members, nameOf } = useMembers();
  const update = useJourneyCache(journey.id);
  const open = journey.status === 'IN_PROGRESS';
  const canHandover = has('employees:approve') && open;
  const canDeactivate = has('users:admin') && canEdit;
  const [toUserId, setToUserId] = useState('');
  const [selected, setSelected] = useState<Set<string> | null>(null);

  const { data: preview, refetch } = useQuery({
    queryKey: ['hr', 'journeys', 'handover', journey.id],
    queryFn: () => apiGet<HandoverPreview>(`/hr/journeys/${journey.id}/handover`),
  });
  const withItems = (preview?.categories ?? []).filter((c) => c.count > 0);
  const chosen = selected ?? new Set(withItems.map((c) => c.key));
  const total = withItems.reduce((n, c) => n + c.count, 0);
  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : tc('error'));
  const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString(locale) : '—');

  const handover = useMutation({
    mutationFn: () => apiPost<JourneyDetail>(`/hr/journeys/${journey.id}/handover`, { toUserId, categories: [...chosen] }),
    onSuccess: (j) => {
      update(j);
      setSelected(null);
      refetch();
      toast.success(t('handover.doneToast', { name: nameOf(toUserId) }));
    },
    onError: onErr,
  });
  const deactivate = useMutation({
    mutationFn: () => apiPost<JourneyDetail>(`/hr/journeys/${journey.id}/deactivate-account`),
    onSuccess: (j) => {
      update(j);
      refetch();
      toast.success(t('account.deactivatedToast'));
    },
    onError: onErr,
  });
  const complete = useMutation({
    mutationFn: () => apiPost<JourneyDetail>(`/hr/journeys/${journey.id}/complete`),
    onSuccess: (j) => {
      update(j);
      toast.success(t('completedToast'));
    },
    onError: onErr,
  });

  const toggle = (key: string, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(key);
    else next.delete(key);
    setSelected(next);
  };

  return (
    <div className="flex flex-col gap-4">
      <Panel title={t('handover.title')} icon={ArrowRightLeft}>
        {!preview ? null : !preview.userId ? (
          <p className="text-sm text-muted-foreground">{t('handover.noAccount')}</p>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">{total ? t('handover.desc', { count: total }) : t('handover.nothing')}</p>
            {withItems.length > 0 && (
              <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {withItems.map((c) => (
                  <li key={c.key}>
                    <label className={cn('flex items-center gap-2 rounded-md border p-2 text-sm', canHandover && 'cursor-pointer hover:bg-accent')}>
                      {canHandover && <Checkbox checked={chosen.has(c.key)} onCheckedChange={(v) => toggle(c.key, v === true)} />}
                      <span className="flex-1">{t(`handover.categories.${c.key}`)}</span>
                      <span className="rounded bg-muted px-1.5 text-xs font-semibold tabular-nums">{c.count}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {withItems.length > 0 && canHandover && (
              <div className="flex flex-wrap items-end gap-2">
                <Field label={t('handover.to')} required className="w-full max-w-xs">
                  <Select value={toUserId || undefined} onValueChange={setToUserId}>
                    <SelectTrigger size="sm"><SelectValue placeholder={t('handover.choose')} /></SelectTrigger>
                    <SelectContent>
                      {members
                        .filter((m) => m.user.id !== preview.userId)
                        .map((m) => (
                          <SelectItem key={m.user.id} value={m.user.id}>{m.user.firstName} {m.user.lastName}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Button
                  disabled={!toUserId || !chosen.size || handover.isPending}
                  onClick={() => window.confirm(t('handover.confirm', { name: nameOf(toUserId) })) && handover.mutate()}
                >
                  <ArrowRightLeft className="size-4" /> {t('handover.submit')}
                </Button>
              </div>
            )}
            {withItems.length > 0 && !has('employees:approve') && <p className="text-xs text-muted-foreground">{t('handover.forbidden')}</p>}
            {journey.handoverAt && (
              <p className="text-xs text-muted-foreground">
                {t('handover.last', {
                  name: nameOf(journey.handoverToUserId),
                  date: fmt(journey.handoverAt),
                  count: Object.values(journey.handoverSummary ?? {}).reduce((a, b) => a + b, 0),
                })}
              </p>
            )}
          </div>
        )}
      </Panel>

      <Panel title={t('account.title')} icon={ShieldOff}>
        {!preview?.userId ? (
          <p className="text-sm text-muted-foreground">{t('handover.noAccount')}</p>
        ) : preview.membership && !preview.membership.isActive ? (
          <p className="flex items-center gap-2 text-sm"><CheckCircle2 className="size-4 text-emerald-500" /> {t('account.deactivated', { date: fmt(preview.membership.deactivatedAt) })}</p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">{t('account.desc')}</p>
            {canDeactivate ? (
              <div>
                <Button
                  variant="outline"
                  className="text-destructive"
                  disabled={deactivate.isPending}
                  onClick={() => window.confirm(t('account.confirm')) && deactivate.mutate()}
                >
                  <ShieldOff className="size-4" /> {t('account.deactivate')}
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{t('account.forbidden')}</p>
            )}
          </div>
        )}
      </Panel>

      {open && canEdit && (
        <Panel title={t('closeDeparture')} icon={CheckCircle2}>
          <p className="mb-3 text-sm text-muted-foreground">{t('closeDepartureDesc')}</p>
          {journey.progress.done < journey.progress.total && (
            <p className="mb-3 text-xs text-amber-600 dark:text-amber-400">{t('trial.stepsPending', { count: journey.progress.total - journey.progress.done })}</p>
          )}
          <Button disabled={complete.isPending} onClick={() => window.confirm(t('closeDepartureConfirm')) && complete.mutate()}>
            <CheckCircle2 className="size-4" /> {t('closeDeparture')}
          </Button>
        </Panel>
      )}
    </div>
  );
}
