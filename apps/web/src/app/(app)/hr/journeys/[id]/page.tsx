'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CalendarClock, ListChecks, RotateCcw, Trash2, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useMembers } from '@/components/hr/use-members';
import { HistoryPanel } from '@/components/history/history-panel';
import { JOURNEY_STATUS_TONE, toDateInput, type JourneyDetail } from '@/components/hr/hr-meta';
import { JourneyChecklist } from '@/components/hr/journey-checklist';
import { OffboardingPanel, TrialSignOffPanel } from '@/components/hr/journey-panels';
import { useEmployees } from '@/components/hr/use-hr';
import { DetailPage } from '@/components/layout/detail-page';
import { StatTile } from '@/components/layout/stat';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FormGrid } from '@/components/ui/form-dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useNow } from '@/lib/use-now';
import { ApiError, apiDelete, apiGet, apiPatch } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useHasPermission } from '@/stores/session';

const NONE = '__none__';

export default function JourneyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations('hr.journeys');
  const tc = useTranslations('common');
  const th = useTranslations('history');
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const has = useHasPermission();
  const canEdit = has('employees:update');
  const canDelete = has('employees:delete');
  const { members, nameOf } = useMembers();
  const { employees, nameOf: employeeName } = useEmployees();
  const [tab, setTab] = useState(searchParams.get('tab') ?? 'steps');
  const changeTab = (next: string) => {
    setTab(next);
    const qs = new URLSearchParams(searchParams.toString());
    qs.set('tab', next);
    router.replace(`?${qs.toString()}`, { scroll: false });
  };

  const key = ['hr', 'journeys', 'detail', id];
  const { data: j, isLoading } = useQuery({ queryKey: key, queryFn: () => apiGet<JourneyDetail>(`/hr/journeys/${id}`) });

  const [form, setForm] = useState({ startDate: '', targetDate: '', ownerId: '', buddyId: '', notes: '', exitReason: '' });
  const [prevJ, setPrevJ] = useState<JourneyDetail | undefined>(undefined);
  if (j && j !== prevJ) {
    setPrevJ(j);
    setForm({
      startDate: toDateInput(j.startDate),
      targetDate: toDateInput(j.targetDate),
      ownerId: j.ownerId ?? '',
      buddyId: j.buddyId ?? '',
      notes: j.notes ?? '',
      exitReason: j.exitReason ?? '',
    });
  }
  const now = useNow();
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const onErr = (e: unknown) => toast.error(e instanceof ApiError ? e.message : tc('error'));
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiPatch<JourneyDetail>(`/hr/journeys/${id}`, body),
    onSuccess: (res) => {
      qc.setQueryData(key, res);
      qc.invalidateQueries({ queryKey: ['hr'] });
      toast.success(t('savedToast'));
    },
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: () => apiDelete(`/hr/journeys/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr', 'journeys'] });
      toast.success(tc('deletedToast'));
      router.push(`/hr/journeys?kind=${j?.kind ?? 'ONBOARDING'}`);
    },
    onError: onErr,
  });

  const fmt = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString(locale) : '—');
  const onboarding = j?.kind === 'ONBOARDING';
  const open = j?.status === 'IN_PROGRESS';
  const datesInvalid = !!form.startDate && !!form.targetDate && form.targetDate < form.startDate;
  const daysLeft = j?.targetDate ? Math.ceil((new Date(j.targetDate).getTime() - now) / 86_400_000) : null;

  return (
    <DetailPage
      backHref={`/hr/journeys?kind=${j?.kind ?? 'ONBOARDING'}`}
      backLabel={t('title')}
      loading={isLoading || !j}
      reference={j?.reference}
      title={j ? t(onboarding ? 'onboardingOf' : 'offboardingOf', { name: `${j.employee.firstName} ${j.employee.lastName}` }) : undefined}
      subtitle={j?.employee.jobTitle ?? undefined}
      badges={
        j && (
          <>
            <Badge variant="secondary" className={cn('text-[11px]', JOURNEY_STATUS_TONE[j.status])}>{t(`statuses.${j.status}`)}</Badge>
            {j.trialDecision && <Badge variant="outline" className="text-[11px]">{t(`decisions.${j.trialDecision}`)}</Badge>}
          </>
        )
      }
      actions={
        j && (
          <>
            {canEdit && open && (
              <Button size="sm" variant="outline" onClick={() => window.confirm(t('cancelConfirm')) && patch.mutate({ status: 'CANCELLED' })}>
                <Ban className="size-4" /> {t('cancel')}
              </Button>
            )}
            {canEdit && !open && (
              <Button size="sm" variant="outline" onClick={() => patch.mutate({ status: 'IN_PROGRESS' })}>
                <RotateCcw className="size-4" /> {t('reopen')}
              </Button>
            )}
            {canDelete && (
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => window.confirm(tc('deleteConfirm')) && remove.mutate()}>
                <Trash2 className="size-4" /> {tc('delete')}
              </Button>
            )}
          </>
        )
      }
    >
      {j && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Link href={`/hr/employees/${j.employee.id}`} className="block">
              <StatTile s={{ label: t('fields.employee'), value: <span className="text-lg">{j.employee.firstName} {j.employee.lastName}</span>, icon: UserRound, hint: j.employee.reference, hintTone: 'muted' }} />
            </Link>
            <StatTile s={{ label: onboarding ? t('fields.startDate') : t('fields.announcedAt'), value: <span className="text-lg">{fmt(j.startDate)}</span>, icon: CalendarClock }} />
            <StatTile
              s={{
                label: onboarding ? t('fields.trialEnd') : t('fields.exitDate'),
                value: <span className="text-lg">{fmt(j.targetDate)}</span>,
                icon: CalendarClock,
                hint: open && daysLeft != null ? (daysLeft >= 0 ? t('daysLeft', { count: daysLeft }) : t('daysLate', { count: -daysLeft })) : undefined,
                hintTone: daysLeft != null && daysLeft < 0 ? 'destructive' : daysLeft != null && daysLeft <= 14 ? 'warn' : 'muted',
              }}
            />
            <StatTile
              s={{
                label: t('fields.progress'),
                value: `${j.progress.pct} %`,
                icon: ListChecks,
                gauge: j.progress.pct,
                hint: j.progress.overdue ? t('overdueSteps', { count: j.progress.overdue }) : t('stepsDone', { done: j.progress.done, total: j.progress.total }),
                hintTone: j.progress.overdue ? 'destructive' : 'muted',
              }}
            />
          </div>

          <Tabs value={tab} onValueChange={changeTab}>
            <TabsList className="max-w-full overflow-x-auto overflow-y-hidden">
              <TabsTrigger value="steps">{t('tabs.steps')}</TabsTrigger>
              {onboarding ? <TabsTrigger value="trial">{t('tabs.trial')}</TabsTrigger> : <TabsTrigger value="departure">{t('tabs.departure')}</TabsTrigger>}
              <TabsTrigger value="details">{t('tabs.details')}</TabsTrigger>
              <TabsTrigger value="history">{th('title')}</TabsTrigger>
            </TabsList>

            <TabsContent value="steps" className="max-w-5xl">
              <JourneyChecklist journey={j} canEdit={canEdit} />
            </TabsContent>

            {onboarding ? (
              <TabsContent value="trial" className="max-w-5xl">
                <TrialSignOffPanel journey={j} canEdit={canEdit} />
              </TabsContent>
            ) : (
              <TabsContent value="departure" className="max-w-5xl">
                <OffboardingPanel journey={j} canEdit={canEdit} />
              </TabsContent>
            )}

            <TabsContent value="details" className="max-w-3xl">
              <div className="flex flex-col gap-4">
                <FormGrid>
                  <Field label={onboarding ? t('fields.startDate') : t('fields.announcedAt')} required>
                    <Input type="date" disabled={!canEdit || !open} value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
                  </Field>
                  <Field label={onboarding ? t('fields.trialEnd') : t('fields.exitDate')} error={datesInvalid ? t('datesInvalid') : undefined}>
                    <Input type="date" disabled={!canEdit || !open} value={form.targetDate} min={form.startDate || undefined} onChange={(e) => set('targetDate', e.target.value)} />
                  </Field>
                  <Field label={t('fields.owner')}>
                    <Select disabled={!canEdit} value={form.ownerId || NONE} onValueChange={(v) => set('ownerId', v === NONE ? '' : v)}>
                      <SelectTrigger size="sm"><SelectValue>{form.ownerId ? nameOf(form.ownerId) : '—'}</SelectValue></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>—</SelectItem>
                        {members.map((m) => (
                          <SelectItem key={m.user.id} value={m.user.id}>{m.user.firstName} {m.user.lastName}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  {onboarding ? (
                    <Field label={t('fields.buddy')}>
                      <Select disabled={!canEdit} value={form.buddyId || NONE} onValueChange={(v) => set('buddyId', v === NONE ? '' : v)}>
                        <SelectTrigger size="sm"><SelectValue>{form.buddyId ? employeeName(form.buddyId) : '—'}</SelectValue></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>—</SelectItem>
                          {employees
                            .filter((e) => e.active && e.id !== j.employeeId)
                            .map((e) => (
                              <SelectItem key={e.id} value={e.id}>{e.firstName} {e.lastName}</SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  ) : (
                    <Field label={t('fields.exitReason')}>
                      <Input disabled={!canEdit} value={form.exitReason} maxLength={1000} onChange={(e) => set('exitReason', e.target.value)} />
                    </Field>
                  )}
                </FormGrid>
                <Field label={t('fields.notes')}>
                  <Textarea disabled={!canEdit} rows={4} value={form.notes} maxLength={4000} onChange={(e) => set('notes', e.target.value)} />
                </Field>
                {canEdit && (
                  <div>
                    <Button
                      disabled={patch.isPending || datesInvalid || !form.startDate}
                      onClick={() =>
                        patch.mutate({
                          ...(open ? { startDate: form.startDate, targetDate: form.targetDate || null } : {}),
                          ownerId: form.ownerId,
                          ...(onboarding ? { buddyId: form.buddyId } : { exitReason: form.exitReason }),
                          notes: form.notes,
                        })
                      }
                    >
                      {tc('save')}
                    </Button>
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="history" className="max-w-4xl">
              <HistoryPanel
                entityType="EmployeeJourney"
                entityId={j.id}
                fieldLabels={{
                  status: t('fields.status'),
                  startDate: onboarding ? t('fields.startDate') : t('fields.announcedAt'),
                  targetDate: onboarding ? t('fields.trialEnd') : t('fields.exitDate'),
                  ownerId: t('fields.owner'),
                  buddyId: t('fields.buddy'),
                  notes: t('fields.notes'),
                  exitReason: t('fields.exitReason'),
                  trialDecision: t('trial.decision'),
                  trialComment: t('trial.comment'),
                  handoverToUserId: t('handover.to'),
                }}
                hiddenFields={['trialSignature', 'trialSignedById', 'updatedById', 'handoverSummary']}
                formatField={(field, value) => {
                  if (typeof value !== 'string') return undefined;
                  if (field === 'ownerId' || field === 'handoverToUserId') return nameOf(value);
                  if (field === 'buddyId') return employeeName(value);
                  if (field === 'status') return t(`statuses.${value}`);
                  if (field === 'trialDecision') return t(`decisions.${value}`);
                  return undefined;
                }}
              />
            </TabsContent>
          </Tabs>
        </>
      )}
    </DetailPage>
  );
}
