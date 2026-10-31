'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useMembers } from '@/components/hr/use-members';
import { Field, FormDialog, FormGrid } from '@/components/ui/form-dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, apiPost } from '@/lib/api';
import { useSession } from '@/stores/session';
import { toDateInput, type JourneyDetail, type JourneyKind } from './hr-meta';
import { useEmployees } from './use-hr';

const NONE = '__none__';

/** Starts an onboarding or offboarding plan; the onboarding checklist is copied from the employee's job description. */
export function JourneyCreateDialog({
  open,
  onOpenChange,
  kind,
  employeeId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  kind: JourneyKind;
  /** pre-selected (from the employee page) */
  employeeId?: string;
}) {
  const t = useTranslations('hr.journeys');
  const tc = useTranslations('common');
  const router = useRouter();
  const qc = useQueryClient();
  const me = useSession((s) => s.user?.id);
  const { members } = useMembers();
  const { employees } = useEmployees();
  const [form, setForm] = useState({ employeeId: '', startDate: '', targetDate: '', ownerId: '', buddyId: '', exitReason: '', notes: '' });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const onboarding = kind === 'ONBOARDING';

  const [prevReset, setPrevReset] = useState<{ open: boolean; employeeId?: string; kind: typeof kind } | null>(null);
  if (!prevReset || prevReset.open !== open || prevReset.employeeId !== employeeId || prevReset.kind !== kind) {
    setPrevReset({ open, employeeId, kind });
    if (open) {
      const emp = employees.find((e) => e.id === employeeId);
      setForm({
        employeeId: employeeId ?? '',
        startDate: onboarding ? toDateInput(emp?.hireDate) || toDateInput(new Date().toISOString()) : toDateInput(new Date().toISOString()),
        targetDate: onboarding ? toDateInput(emp?.trialEndDate) : toDateInput(emp?.exitDate),
        ownerId: me ?? '',
        buddyId: '',
        exitReason: '',
        notes: '',
      });
    }
  }

  // picking the employee pre-fills the dates from their record
  const pickEmployee = (id: string) => {
    const emp = employees.find((e) => e.id === id);
    setForm((f) => ({
      ...f,
      employeeId: id,
      startDate: onboarding ? toDateInput(emp?.hireDate) || f.startDate : f.startDate,
      targetDate: onboarding ? toDateInput(emp?.trialEndDate) || f.targetDate : toDateInput(emp?.exitDate) || f.targetDate,
      buddyId: f.buddyId === id ? '' : f.buddyId,
    }));
  };

  const datesInvalid = !!form.startDate && !!form.targetDate && form.targetDate < form.startDate;
  const valid = !!form.employeeId && !!form.startDate && !datesInvalid && (onboarding || !!form.targetDate);

  const create = useMutation({
    mutationFn: () =>
      apiPost<JourneyDetail>('/hr/journeys', {
        kind,
        employeeId: form.employeeId,
        startDate: form.startDate,
        targetDate: form.targetDate || undefined,
        ownerId: form.ownerId || undefined,
        buddyId: onboarding ? form.buddyId || undefined : undefined,
        exitReason: !onboarding ? form.exitReason.trim() || undefined : undefined,
        notes: form.notes.trim() || undefined,
      }),
    onSuccess: (j) => {
      qc.invalidateQueries({ queryKey: ['hr'] });
      toast.success(t('createdToast', { reference: j.reference }));
      onOpenChange(false);
      router.push(`/hr/journeys/${j.id}`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc('error')),
  });

  const candidates = employees.filter((e) => (onboarding ? true : e.active));

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={onboarding ? t('newOnboarding') : t('newOffboarding')}
      description={onboarding ? t('newOnboardingDesc') : t('newOffboardingDesc')}
      submitLabel={tc('create')}
      onSubmit={() => create.mutate()}
      submitting={create.isPending}
      disabled={!valid}
    >
      <Field label={t('fields.employee')} required>
        <Select value={form.employeeId || undefined} onValueChange={pickEmployee} disabled={!!employeeId}>
          <SelectTrigger size="sm"><SelectValue placeholder={t('chooseEmployee')} /></SelectTrigger>
          <SelectContent>
            {candidates.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.firstName} {e.lastName}
                {e.jobTitle ? ` · ${e.jobTitle}` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <FormGrid>
        <Field label={onboarding ? t('fields.startDate') : t('fields.announcedAt')} required>
          <Input type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
        </Field>
        <Field
          label={onboarding ? t('fields.trialEnd') : t('fields.exitDate')}
          required={!onboarding}
          hint={onboarding ? t('fields.trialEndHint') : undefined}
          error={datesInvalid ? t('datesInvalid') : undefined}
        >
          <Input type="date" value={form.targetDate} min={form.startDate || undefined} onChange={(e) => set('targetDate', e.target.value)} />
        </Field>
        <Field label={t('fields.owner')}>
          <Select value={form.ownerId || NONE} onValueChange={(v) => set('ownerId', v === NONE ? '' : v)}>
            <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>—</SelectItem>
              {members.map((m) => (
                <SelectItem key={m.user.id} value={m.user.id}>{m.user.firstName} {m.user.lastName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {onboarding ? (
          <Field label={t('fields.buddy')} hint={t('fields.buddyHint')}>
            <Select value={form.buddyId || NONE} onValueChange={(v) => set('buddyId', v === NONE ? '' : v)}>
              <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>—</SelectItem>
                {employees
                  .filter((e) => e.active && e.id !== form.employeeId)
                  .map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.firstName} {e.lastName}</SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
        ) : (
          <Field label={t('fields.exitReason')}>
            <Input value={form.exitReason} maxLength={1000} onChange={(e) => set('exitReason', e.target.value)} placeholder={t('fields.exitReasonPlaceholder')} />
          </Field>
        )}
      </FormGrid>
      <Field label={t('fields.notes')}>
        <Textarea rows={3} value={form.notes} maxLength={4000} onChange={(e) => set('notes', e.target.value)} />
      </Field>
      <p className="text-xs text-muted-foreground">{onboarding ? t('templateHint') : t('offboardingHint')}</p>
    </FormDialog>
  );
}
