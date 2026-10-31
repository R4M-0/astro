'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, LogIn, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Panel } from '@/components/layout/stat';
import { Button } from '@/components/ui/button';
import { Field, FormDialog } from '@/components/ui/form-dialog';
import { Input } from '@/components/ui/input';
import { ApiError, apiGet, apiPut } from '@/lib/api';
import type { JourneyItemKind } from './hr-meta';
import { EMPTY_ITEM, ITEM_KIND_ICON, itemDraftValid, JourneyItemFields, type JourneyItemDraft } from './journey-item-fields';

interface TemplateItem {
  id?: string;
  kind: JourneyItemKind;
  label: string;
  dueDays: number;
}

/**
 * The job description's standard onboarding checklist — copied into each new hire's plan
 * (documents to read, awareness paths, trainings, tasks) with the trial period length.
 */
export function OnboardingTemplateEditor({ jobDescriptionId, canEdit }: { jobDescriptionId: string; canEdit: boolean }) {
  const t = useTranslations('hr.journeys');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const key = ['hr', 'job-descriptions', 'onboarding', jobDescriptionId];
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => apiGet<{ trialPeriodDays: number | null; items: TemplateItem[] }>(`/hr/job-descriptions/${jobDescriptionId}/onboarding`),
  });
  const [items, setItems] = useState<TemplateItem[]>([]);
  const [trialDays, setTrialDays] = useState('');
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState<{ index: number | null } | null>(null);
  const [draft, setDraft] = useState<JourneyItemDraft>(EMPTY_ITEM);
  const [dueDays, setDueDays] = useState('30');

  // sync from the server copy while there are no local edits
  const [prevSync, setPrevSync] = useState<{ data: typeof data; dirty: boolean } | null>(null);
  if (!prevSync || prevSync.data !== data || prevSync.dirty !== dirty) {
    setPrevSync({ data, dirty });
    if (data && !dirty) {
      setItems(data.items);
      setTrialDays(data.trialPeriodDays ? String(data.trialPeriodDays) : '');
    }
  }

  const openEditing = (index: number | null) => {
    setEditing({ index });
    const i = index != null ? items[index] : null;
    setDraft(i ? { kind: i.kind, label: i.label, trainingId: '' } : EMPTY_ITEM);
    setDueDays(String(i?.dueDays ?? 30));
  };

  const change = (next: TemplateItem[]) => {
    setItems(next);
    setDirty(true);
  };
  const move = (i: number, d: -1 | 1) => {
    const next = [...items];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    change(next);
  };
  const applyDraft = () => {
    const item: TemplateItem = {
      kind: draft.kind,
      label: draft.label.trim(),
      dueDays: Math.min(730, Math.max(0, Number(dueDays) || 0)),
    };
    change(editing?.index != null ? items.map((x, k) => (k === editing.index ? item : x)) : [...items, item]);
    setEditing(null);
  };

  const trialInvalid = !!trialDays && (!Number.isInteger(Number(trialDays)) || Number(trialDays) < 1 || Number(trialDays) > 730);
  const save = useMutation({
    mutationFn: () =>
      apiPut(`/hr/job-descriptions/${jobDescriptionId}/onboarding`, {
        trialPeriodDays: trialDays ? Number(trialDays) : null,
        items: items.map((i) => ({ kind: i.kind, label: i.label, dueDays: i.dueDays })),
      }),
    onSuccess: () => {
      setDirty(false);
      qc.invalidateQueries({ queryKey: key });
      toast.success(t('template.savedToast'));
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc('error')),
  });

  return (
    <Panel
      title={t('template.title')}
      icon={LogIn}
      action={
        canEdit ? (
          <Button size="sm" variant="outline" onClick={() => openEditing(null)}>
            <Plus className="size-4" /> {t('addStep')}
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{t('template.desc')}</p>
        <Field label={t('template.trialDays')} hint={t('template.trialDaysHint')} error={trialInvalid ? t('template.trialDaysInvalid') : undefined} className="max-w-xs">
          <Input type="number" min={1} max={730} disabled={!canEdit} value={trialDays} onChange={(e) => { setTrialDays(e.target.value); setDirty(true); }} />
        </Field>
        {items.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">{t('template.empty')}</p>
        ) : (
          <ol className="divide-y rounded-lg border">
            {items.map((i, k) => {
              const Icon = ITEM_KIND_ICON[i.kind];
              return (
                <li key={k} className="flex items-center gap-3 p-2.5">
                  <span className="w-5 text-right text-xs tabular-nums text-muted-foreground">{k + 1}</span>
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{i.label}</p>
                    <p className="text-xs text-muted-foreground">{t(`kinds.${i.kind}`)} · {t('template.dueAfter', { count: i.dueDays })}</p>
                  </div>
                  {canEdit && (
                    <div className="flex shrink-0 items-center">
                      <Button size="icon" variant="ghost" className="size-7" disabled={k === 0} onClick={() => move(k, -1)} aria-label={t('template.up')}><ArrowUp className="size-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="size-7" disabled={k === items.length - 1} onClick={() => move(k, 1)} aria-label={t('template.down')}><ArrowDown className="size-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="size-7" onClick={() => openEditing(k)} aria-label={tc('edit')}><Pencil className="size-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="size-7 text-destructive" onClick={() => change(items.filter((_, x) => x !== k))} aria-label={tc('delete')}><Trash2 className="size-3.5" /></Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        {canEdit && dirty && (
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={save.isPending || trialInvalid} onClick={() => save.mutate()}>{tc('save')}</Button>
            <Button size="sm" variant="ghost" onClick={() => setDirty(false)}>{tc('cancel')}</Button>
          </div>
        )}
      </div>

      <FormDialog
        open={!!editing}
        onOpenChange={(v) => !v && setEditing(null)}
        title={editing?.index != null ? t('editStep') : t('addStep')}
        description={t('template.stepDesc')}
        submitLabel={editing?.index != null ? tc('save') : tc('create')}
        onSubmit={applyDraft}
        disabled={!itemDraftValid(draft)}
        size="md"
      >
        <JourneyItemFields value={draft} onChange={setDraft} withTraining={false} kindLocked={editing?.index != null} />
        <Field label={t('template.dueDays')} hint={t('template.dueDaysHint')}>
          <Input type="number" min={0} max={730} value={dueDays} onChange={(e) => setDueDays(e.target.value)} />
        </Field>
      </FormDialog>
    </Panel>
  );
}
