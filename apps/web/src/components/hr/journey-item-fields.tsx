'use client';

import { useQuery } from '@tanstack/react-query';
import { CheckSquare, GraduationCap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Field } from '@/components/ui/form-dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { apiGet } from '@/lib/api';
import { useHasPermission } from '@/stores/session';
import { JOURNEY_ITEM_KINDS, type JourneyItemKind, type TrainingRow } from './hr-meta';

export const ITEM_KIND_ICON: Record<JourneyItemKind, React.ElementType> = {
  TRAINING: GraduationCap,
  TASK: CheckSquare,
};

export interface JourneyItemDraft {
  kind: JourneyItemKind;
  label: string;
  trainingId: string;
}

export const EMPTY_ITEM: JourneyItemDraft = { kind: 'TASK', label: '', trainingId: '' };

/** A step needs a label; the training session is optional. */
export const itemDraftValid = (d: JourneyItemDraft) => !!d.label.trim();

/**
 * Kind + label + linked record of an onboarding step. `withTraining` exposes the training
 * session picker (plans only — templates name the training in the label and the session
 * is chosen when the plan is followed).
 */
export function JourneyItemFields({
  value,
  onChange,
  withTraining = true,
  kindLocked = false,
}: {
  value: JourneyItemDraft;
  onChange: (next: JourneyItemDraft) => void;
  withTraining?: boolean;
  /** the kind of an existing step cannot change */
  kindLocked?: boolean;
}) {
  const t = useTranslations('hr.journeys');
  const has = useHasPermission();
  const set = <K extends keyof JourneyItemDraft>(k: K, v: JourneyItemDraft[K]) => onChange({ ...value, [k]: v });

  const { data: trainings } = useQuery({
    queryKey: ['hr', 'trainings', 'journey-picker'],
    queryFn: () => apiGet<{ data: TrainingRow[] }>('/hr/trainings?pageSize=200'),
    enabled: withTraining && value.kind === 'TRAINING' && has('hr-trainings:read'),
  });

  /** picking a record fills an empty label with its name */
  const pick = (k: 'trainingId', id: string, name: string | undefined) =>
    onChange({ ...value, [k]: id, label: value.label.trim() ? value.label : (name ?? '') });

  return (
    <div className="flex flex-col gap-3">
      <Field label={t('item.kind')} required>
        <Select value={value.kind} disabled={kindLocked} onValueChange={(v) => onChange({ ...EMPTY_ITEM, label: value.label, kind: v as JourneyItemKind })}>
          <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            {JOURNEY_ITEM_KINDS.map((k) => {
              const Icon = ITEM_KIND_ICON[k];
              return (
                <SelectItem key={k} value={k}>
                  <Icon className="size-4 text-muted-foreground" /> {t(`kinds.${k}`)}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </Field>

      {value.kind === 'TRAINING' && withTraining && (
        <Field label={t('item.training')} hint={t('item.trainingHint')}>
          <Select value={value.trainingId || undefined} onValueChange={(v) => pick('trainingId', v, trainings?.data.find((x) => x.id === v)?.theme)}>
            <SelectTrigger size="sm"><SelectValue placeholder={t('item.chooseTraining')} /></SelectTrigger>
            <SelectContent>
              {(trainings?.data ?? []).map((x) => (
                <SelectItem key={x.id} value={x.id}>{x.code} · {x.theme}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}

      <Field label={t('item.label')} required>
        <Input value={value.label} maxLength={500} onChange={(e) => set('label', e.target.value)} placeholder={t('item.labelPlaceholder')} />
      </Field>
    </div>
  );
}
