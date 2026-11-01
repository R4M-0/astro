'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlignLeft,
  ArrowDown,
  ArrowUp,
  CheckSquare,
  CircleDot,
  Lock,
  Plus,
  Star,
  ToggleLeft,
  Trash2,
  Type,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Field, FormGrid } from '@/components/ui/form-dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useNow } from '@/lib/use-now';
import { ApiError, apiDelete, apiPatch, apiPost, apiPut } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useSurveyScope } from './survey-scope';
import { isoToLocal, localToIso, SwitchRow } from './survey-create-dialog';
import {
  CHOICE_TYPES,
  SURVEY_QUESTION_TYPES,
  type SurveyDetail,
  type SurveyQuestion,
  type SurveyQuestionType,
} from './survey-meta';

export const QUESTION_TYPE_ICON: Record<SurveyQuestionType, typeof Type> = {
  SHORT_TEXT: Type,
  LONG_TEXT: AlignLeft,
  SINGLE_CHOICE: CircleDot,
  MULTIPLE_CHOICE: CheckSquare,
  YES_NO: ToggleLeft,
  RATING: Star,
};

function useSurveyMutation<A>(surveyId: string, fn: (a: A) => Promise<unknown>, success?: string) {
  const queryClient = useQueryClient();
  const tc = useTranslations('common');
  const { queryKey } = useSurveyScope();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => {
      if (data && typeof data === 'object' && 'id' in data) {
        queryClient.setQueryData([...queryKey, surveyId], data);
      }
      queryClient.invalidateQueries({ queryKey: [...queryKey] });
      if (success) toast.success(success);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : tc('error')),
  });
}

// ── settings ─────────────────────────────────────────────────────────────────
export function SurveySettingsCard({ survey, canEdit }: { survey: SurveyDetail; canEdit: boolean }) {
  const t = useTranslations('hrSurveys');
  const { api } = useSurveyScope();
  const tc = useTranslations('common');
  const initial = () => ({
    title: survey.title,
    description: survey.description ?? '',
    anonymous: survey.anonymous,
    allowMultipleResponses: survey.allowMultipleResponses,
    closesAt: isoToLocal(survey.closesAt),
  });
  const [form, setForm] = useState(initial);
  const [prevSurvey, setPrevSurvey] = useState({ id: survey.id, updatedAt: survey.updatedAt });
  if (survey.id !== prevSurvey.id || survey.updatedAt !== prevSurvey.updatedAt) {
    setPrevSurvey({ id: survey.id, updatedAt: survey.updatedAt });
    setForm(initial());
  }
  const now = useNow();

  const base = initial();
  const body: Record<string, unknown> = {};
  if (form.title.trim() !== base.title) body.title = form.title.trim();
  if (form.description.trim() !== base.description.trim()) body.description = form.description.trim() || null;
  if (form.anonymous !== base.anonymous) body.anonymous = form.anonymous;
  if (form.allowMultipleResponses !== base.allowMultipleResponses) body.allowMultipleResponses = form.allowMultipleResponses;
  if (form.closesAt !== base.closesAt) body.closesAt = localToIso(form.closesAt);
  const dirty = Object.keys(body).length > 0;
  const closesInPast = !!form.closesAt && form.closesAt !== base.closesAt && new Date(form.closesAt).getTime() <= now;
  const rulesLocked = survey.responseCount > 0;

  const save = useSurveyMutation(survey.id, () => apiPatch<SurveyDetail>(`${api}/${survey.id}`, body), t('savedToast'));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('settings.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <fieldset disabled={!canEdit} className="flex flex-col gap-4">
          <Field label={t('fields.title')} required htmlFor="ss-title">
            <Input id="ss-title" maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label={t('fields.description')} htmlFor="ss-desc">
            <Textarea id="ss-desc" rows={3} maxLength={5000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <SwitchRow
            id="ss-anon"
            label={t('fields.anonymous')}
            hint={rulesLocked ? t('settings.rulesLocked') : t('fields.anonymousHint')}
            checked={form.anonymous}
            disabled={!canEdit || rulesLocked}
            onCheckedChange={(v) => setForm({ ...form, anonymous: v })}
          />
          <SwitchRow
            id="ss-multi"
            label={t('fields.allowMultiple')}
            hint={rulesLocked ? t('settings.rulesLocked') : t('fields.allowMultipleHint')}
            checked={form.allowMultipleResponses}
            disabled={!canEdit || rulesLocked}
            onCheckedChange={(v) => setForm({ ...form, allowMultipleResponses: v })}
          />
          <Field
            label={t('fields.closesAt')}
            htmlFor="ss-closes"
            hint={closesInPast ? undefined : t('fields.closesAtHint')}
            error={closesInPast ? t('fields.closesAtPast') : undefined}
          >
            <Input id="ss-closes" type="datetime-local" value={form.closesAt} onChange={(e) => setForm({ ...form, closesAt: e.target.value })} />
          </Field>
          {canEdit && (
            <div className="flex justify-end gap-2">
              {dirty && (
                <Button variant="ghost" onClick={() => setForm(initial())}>
                  {tc('cancel')}
                </Button>
              )}
              <Button disabled={!dirty || !form.title.trim() || closesInPast || save.isPending} onClick={() => save.mutate(undefined)}>
                {tc('save')}
              </Button>
            </div>
          )}
        </fieldset>
      </CardContent>
    </Card>
  );
}

// ── question builder ───────────────────────────────────────────────────────
export function SurveyQuestionBuilder({ survey, canEdit }: { survey: SurveyDetail; canEdit: boolean }) {
  const t = useTranslations('hrSurveys');
  const { api } = useSurveyScope();
  const editable = canEdit && survey.status === 'DRAFT';

  const add = useSurveyMutation(survey.id, (type: SurveyQuestionType) =>
    apiPost<SurveyDetail>(`${api}/${survey.id}/questions`, {
      type,
      label: t('builder.newQuestion'),
      required: false,
      ...(CHOICE_TYPES.includes(type)
        ? { options: [{ label: t('builder.optionN', { n: 1 }) }, { label: t('builder.optionN', { n: 2 }) }] }
        : {}),
      ...(type === 'RATING' ? { scaleMin: 1, scaleMax: 5 } : {}),
    }),
  );
  const reorder = useSurveyMutation(survey.id, (ids: string[]) =>
    apiPut<SurveyDetail>(`${api}/${survey.id}/questions/order`, { questionIds: ids }),
  );

  const move = (index: number, dir: -1 | 1) => {
    const ids = survey.questions.map((q) => q.id);
    const target = index + dir;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorder.mutate(ids);
  };

  const addMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={!editable || add.isPending}>
          <Plus className="size-4" /> {t('builder.addQuestion')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {SURVEY_QUESTION_TYPES.map((type) => {
          const Icon = QUESTION_TYPE_ICON[type];
          return (
            <DropdownMenuItem key={type} onSelect={() => add.mutate(type)}>
              <Icon className="size-4" /> {t(`types.${type}`)}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="flex flex-col gap-3">
      {survey.status !== 'DRAFT' && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <Lock className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p>{survey.responseCount > 0 ? t('builder.lockedWithResponses') : t('builder.lockedPublished')}</p>
        </div>
      )}

      {!survey.questions.length ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">{t('builder.empty')}</p>
          {editable && addMenu}
        </div>
      ) : (
        <>
          {survey.questions.map((q, i) => (
            <QuestionCard
              key={q.id}
              surveyId={survey.id}
              question={q}
              index={i}
              total={survey.questions.length}
              editable={editable}
              onMove={(dir) => move(i, dir)}
              moving={reorder.isPending}
            />
          ))}
          {editable && <div>{addMenu}</div>}
        </>
      )}
    </div>
  );
}

interface OptionDraft {
  key: string;
  id?: string;
  label: string;
}
interface QuestionDraft {
  type: SurveyQuestionType;
  label: string;
  helpText: string;
  required: boolean;
  scaleMin: number;
  scaleMax: number;
  scaleMinLabel: string;
  scaleMaxLabel: string;
  options: OptionDraft[];
}

let keySeq = 0;
const newKey = () => `n${++keySeq}`;

function draftOf(q: SurveyQuestion): QuestionDraft {
  return {
    type: q.type,
    label: q.label,
    helpText: q.helpText ?? '',
    required: q.required,
    scaleMin: q.scaleMin,
    scaleMax: q.scaleMax,
    scaleMinLabel: q.scaleMinLabel ?? '',
    scaleMaxLabel: q.scaleMaxLabel ?? '',
    options: q.options.map((o) => ({ key: o.id, id: o.id, label: o.label })),
  };
}

function QuestionCard({
  surveyId,
  question,
  index,
  total,
  editable,
  onMove,
  moving,
}: {
  surveyId: string;
  question: SurveyQuestion;
  index: number;
  total: number;
  editable: boolean;
  onMove: (dir: -1 | 1) => void;
  moving: boolean;
}) {
  const t = useTranslations('hrSurveys');
  const { api } = useSurveyScope();
  const tc = useTranslations('common');
  const [draft, setDraft] = useState<QuestionDraft>(() => draftOf(question));
  const serialized = JSON.stringify(question);
  const [prevSerialized, setPrevSerialized] = useState(serialized);
  if (serialized !== prevSerialized) {
    setPrevSerialized(serialized);
    setDraft(draftOf(question));
  }

  const original = draftOf(question);
  const isChoice = CHOICE_TYPES.includes(draft.type);
  const dirty = JSON.stringify({ ...draft, options: draft.options.map((o) => [o.id, o.label]) }) !==
    JSON.stringify({ ...original, options: original.options.map((o) => [o.id, o.label]) });

  const filledOptions = draft.options.filter((o) => o.label.trim());
  const optionLabels = filledOptions.map((o) => o.label.trim().toLowerCase());
  const errors: string[] = [];
  if (!draft.label.trim()) errors.push(t('builder.errLabel'));
  if (isChoice && filledOptions.length < 2) errors.push(t('builder.errOptions'));
  if (isChoice && new Set(optionLabels).size !== optionLabels.length) errors.push(t('builder.errDuplicate'));
  if (draft.type === 'RATING' && !(draft.scaleMin < draft.scaleMax)) errors.push(t('builder.errScale'));

  const save = useSurveyMutation(
    surveyId,
    () =>
      apiPatch<SurveyDetail>(`${api}/${surveyId}/questions/${question.id}`, {
        type: draft.type,
        label: draft.label.trim(),
        helpText: draft.helpText.trim() || null,
        required: draft.required,
        ...(draft.type === 'RATING'
          ? {
              scaleMin: draft.scaleMin,
              scaleMax: draft.scaleMax,
              scaleMinLabel: draft.scaleMinLabel.trim() || null,
              scaleMaxLabel: draft.scaleMaxLabel.trim() || null,
            }
          : {}),
        options: isChoice ? filledOptions.map((o) => ({ ...(o.id ? { id: o.id } : {}), label: o.label.trim() })) : [],
      }),
    t('builder.savedToast'),
  );
  const remove = useSurveyMutation(surveyId, () => apiDelete<SurveyDetail>(`${api}/${surveyId}/questions/${question.id}`));

  const setType = (type: SurveyQuestionType) => {
    setDraft((d) => ({
      ...d,
      type,
      options:
        CHOICE_TYPES.includes(type) && d.options.length < 2
          ? [
              ...d.options,
              ...Array.from({ length: 2 - d.options.length }, (_, i) => ({
                key: newKey(),
                label: t('builder.optionN', { n: d.options.length + i + 1 }),
              })),
            ]
          : d.options,
    }));
  };

  const Icon = QUESTION_TYPE_ICON[draft.type];
  const scaleValues = Array.from({ length: 11 }, (_, i) => i);

  return (
    // data-survey-unsaved lets the publish button warn about edits not yet saved
    <Card className={cn(dirty && 'ring-1 ring-primary/40')} data-survey-unsaved={dirty || undefined}>
      <CardContent className="flex flex-col gap-4 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="flex size-6 items-center justify-center rounded-md bg-muted text-xs font-semibold tabular-nums text-foreground">
              {index + 1}
            </span>
            <Icon className="size-4" />
            {t(`types.${draft.type}`)}
          </div>
          {editable && (
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="size-8" aria-label={t('builder.moveUp')} disabled={index === 0 || moving} onClick={() => onMove(-1)}>
                <ArrowUp className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" className="size-8" aria-label={t('builder.moveDown')} disabled={index === total - 1 || moving} onClick={() => onMove(1)}>
                <ArrowDown className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-destructive"
                aria-label={tc('delete')}
                disabled={remove.isPending}
                onClick={() => window.confirm(t('builder.deleteConfirm')) && remove.mutate(undefined)}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          )}
        </div>

        <fieldset disabled={!editable} className="flex flex-col gap-4">
          <FormGrid className="sm:grid-cols-[1fr_220px]">
            <Field label={t('builder.label')} required>
              <Input maxLength={500} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
            </Field>
            <Field label={t('builder.type')}>
              <Select value={draft.type} onValueChange={(v) => setType(v as SurveyQuestionType)} disabled={!editable}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SURVEY_QUESTION_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>{t(`types.${type}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FormGrid>
          <Field label={t('builder.helpText')}>
            <Input maxLength={1000} value={draft.helpText} placeholder={t('builder.helpTextPh')} onChange={(e) => setDraft({ ...draft, helpText: e.target.value })} />
          </Field>

          {isChoice && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">{t('builder.options')}</span>
              {draft.options.map((o, i) => (
                <div key={o.key} className="flex items-center gap-2">
                  {draft.type === 'SINGLE_CHOICE' ? (
                    <CircleDot className="size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <CheckSquare className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <Input
                    maxLength={300}
                    value={o.label}
                    aria-label={t('builder.optionN', { n: i + 1 })}
                    onChange={(e) =>
                      setDraft({ ...draft, options: draft.options.map((x) => (x.key === o.key ? { ...x, label: e.target.value } : x)) })
                    }
                  />
                  {editable && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0"
                      aria-label={t('builder.removeOption')}
                      disabled={draft.options.length <= 2}
                      onClick={() => setDraft({ ...draft, options: draft.options.filter((x) => x.key !== o.key) })}
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                </div>
              ))}
              {editable && draft.options.length < 50 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-fit"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      options: [...draft.options, { key: newKey(), label: t('builder.optionN', { n: draft.options.length + 1 }) }],
                    })
                  }
                >
                  <Plus className="size-4" /> {t('builder.addOption')}
                </Button>
              )}
            </div>
          )}

          {draft.type === 'RATING' && (
            <FormGrid cols={2}>
              <Field label={t('builder.scaleMin')}>
                <div className="flex gap-2">
                  <Select value={String(draft.scaleMin)} onValueChange={(v) => setDraft({ ...draft, scaleMin: Number(v) })} disabled={!editable}>
                    <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {scaleValues.slice(0, 10).map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input id="survey-scale-min-label" aria-label={t('builder.scaleMinLabelPh')} maxLength={100} placeholder={t('builder.scaleMinLabelPh')} value={draft.scaleMinLabel} onChange={(e) => setDraft({ ...draft, scaleMinLabel: e.target.value })} />
                </div>
              </Field>
              <Field label={t('builder.scaleMax')}>
                <div className="flex gap-2">
                  <Select value={String(draft.scaleMax)} onValueChange={(v) => setDraft({ ...draft, scaleMax: Number(v) })} disabled={!editable}>
                    <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {scaleValues.slice(1).map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input id="survey-scale-max-label" aria-label={t('builder.scaleMaxLabelPh')} maxLength={100} placeholder={t('builder.scaleMaxLabelPh')} value={draft.scaleMaxLabel} onChange={(e) => setDraft({ ...draft, scaleMaxLabel: e.target.value })} />
                </div>
              </Field>
            </FormGrid>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={draft.required} disabled={!editable} onCheckedChange={(v) => setDraft({ ...draft, required: v })} />
              {t('builder.required')}
            </label>
            {editable && dirty && (
              <div className="flex items-center gap-2">
                {errors[0] && <span className="text-xs text-destructive">{errors[0]}</span>}
                <Button variant="ghost" size="sm" onClick={() => setDraft(original)}>
                  {tc('cancel')}
                </Button>
                <Button size="sm" disabled={!!errors.length || save.isPending} onClick={() => save.mutate(undefined)}>
                  {tc('save')}
                </Button>
              </div>
            )}
          </div>
        </fieldset>
      </CardContent>
    </Card>
  );
}
