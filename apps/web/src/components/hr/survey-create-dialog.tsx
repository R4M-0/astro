'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Field, FormDialog } from '@/components/ui/form-dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useNow } from '@/lib/use-now';
import { ApiError, apiPost } from '@/lib/api';
import { useSurveyScope } from './survey-scope';
import type { SurveyDetail } from './survey-meta';

/** `datetime-local` value → ISO string (or null). */
export function localToIso(v: string) {
  return v ? new Date(v).toISOString() : null;
}

/** ISO string → `datetime-local` value in the viewer's timezone. */
export function isoToLocal(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function SwitchRow({
  id,
  label,
  hint,
  checked,
  onCheckedChange,
  disabled,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
      <label htmlFor={id} className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  );
}

export function SurveyCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const t = useTranslations('hrSurveys');
  const tc = useTranslations('common');
  const queryClient = useQueryClient();
  const { api, queryKey } = useSurveyScope();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [anonymous, setAnonymous] = useState(true);
  const [allowMultiple, setAllowMultiple] = useState(false);
  const [closesAt, setClosesAt] = useState('');

  const now = useNow();
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setTitle('');
      setDescription('');
      setAnonymous(true);
      setAllowMultiple(false);
      setClosesAt('');
    }
  }

  const closesInPast = !!closesAt && new Date(closesAt).getTime() <= now;

  const create = useMutation({
    mutationFn: () =>
      apiPost<SurveyDetail>(api, {
        title: title.trim(),
        description: description.trim() || undefined,
        anonymous,
        allowMultipleResponses: allowMultiple,
        closesAt: localToIso(closesAt),
      }),
    onSuccess: (s) => {
      queryClient.invalidateQueries({ queryKey: [...queryKey] });
      toast.success(t('createdToast'));
      onOpenChange(false);
      onCreated(s.id);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : tc('error')),
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('new')}
      description={t('formDesc')}
      submitLabel={t('create')}
      onSubmit={() => create.mutate()}
      submitting={create.isPending}
      disabled={!title.trim() || closesInPast}
      size="md"
    >
      <Field label={t('fields.title')} required htmlFor="sv-title">
        <Input id="sv-title" autoFocus maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('fields.titlePh')} />
      </Field>
      <Field label={t('fields.description')} htmlFor="sv-desc" hint={t('fields.descriptionHint')}>
        <Textarea id="sv-desc" rows={3} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <SwitchRow id="sv-anon" label={t('fields.anonymous')} hint={t('fields.anonymousHint')} checked={anonymous} onCheckedChange={setAnonymous} />
      <SwitchRow id="sv-multi" label={t('fields.allowMultiple')} hint={t('fields.allowMultipleHint')} checked={allowMultiple} onCheckedChange={setAllowMultiple} />
      <Field
        label={t('fields.closesAt')}
        htmlFor="sv-closes"
        hint={closesInPast ? undefined : t('fields.closesAtHint')}
        error={closesInPast ? t('fields.closesAtPast') : undefined}
      >
        <Input id="sv-closes" type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
      </Field>
    </FormDialog>
  );
}
