'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { EyeOff, Loader2, UserCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  isAnswered,
  TEXT_MAX,
  toAnswerPayload,
  type AnswerMap,
  type AnswerValue,
  type RenderableSurvey,
  type SurveyIdentity,
  type SurveyQuestion,
} from './survey-meta';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SurveySubmission {
  respondentName?: string;
  respondentEmail?: string;
  answers: ReturnType<typeof toAnswerPayload>;
}

/**
 * The employee-facing survey form. Shared by the admin « Aperçu » tab (preview,
 * non-submitting) and the public page /e/[token] so both render exactly the same.
 */
export function SurveyRenderer({
  survey,
  onSubmit,
  submitting,
  submitError,
  preview,
  signedIn,
}: {
  survey: RenderableSurvey;
  onSubmit: (body: SurveySubmission) => void;
  submitting?: boolean;
  submitError?: string | null;
  preview?: boolean;
  /** answering in the app: the session identifies the respondent, no name/e-mail fields */
  signedIn?: boolean;
}) {
  const t = useTranslations('hrSurveys.renderer');
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [identity, setIdentity] = useState<SurveyIdentity>({ name: '', email: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const askIdentity = !survey.anonymous && !signedIn;

  const setAnswer = (id: string, value: AnswerValue) => {
    setAnswers((prev) => ({ ...prev, [id]: value }));
    if (errors[id]) setErrors((prev) => ({ ...prev, [id]: '' }));
  };

  const validate = () => {
    const next: Record<string, string> = {};
    if (askIdentity) {
      if (!identity.name.trim()) next.__name = t('nameRequired');
      if (identity.email.trim() && !EMAIL_RE.test(identity.email.trim())) next.__email = t('emailInvalid');
    }
    for (const q of survey.questions) {
      const a = answers[q.id];
      if (q.required && !isAnswered(q, a)) next[q.id] = t('required');
      else if (a?.textValue && TEXT_MAX[q.type] && a.textValue.trim().length > TEXT_MAX[q.type]) {
        next[q.id] = t('tooLong', { max: TEXT_MAX[q.type] });
      }
    }
    if (!Object.keys(next).length && !survey.questions.some((q) => isAnswered(q, answers[q.id]))) {
      next.__form = t('atLeastOne');
    }
    setErrors(next);
    return next;
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    const first = Object.keys(errs).find((k) => errs[k]);
    if (first) {
      document.getElementById(`sq-${first}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    onSubmit({
      ...(!askIdentity
        ? {}
        : {
            respondentName: identity.name.trim(),
            respondentEmail: identity.email.trim() || undefined,
          }),
      answers: toAnswerPayload(survey.questions, answers),
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <header className="rounded-xl border bg-card p-5 sm:p-6">
        <h1 className="text-xl font-semibold leading-tight tracking-tight text-balance sm:text-2xl">{survey.title}</h1>
        {survey.description && (
          <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{survey.description}</p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {survey.anonymous && (
            <span className="inline-flex items-center gap-1">
              <EyeOff className="size-3.5" /> {t('anonymousNotice')}
            </span>
          )}
          {!survey.anonymous && signedIn && (
            <span className="inline-flex items-center gap-1">
              <UserCheck className="size-3.5" /> {t('signedInNotice')}
            </span>
          )}
          {survey.questions.some((q) => q.required) && (
            <span>
              <span className="text-destructive">*</span> {t('requiredLegend')}
            </span>
          )}
        </div>
      </header>

      {askIdentity && (
        <section className="grid gap-4 rounded-xl border bg-card p-5 sm:grid-cols-2 sm:p-6">
          <div id="sq-__name" className="flex flex-col gap-1.5">
            <Label htmlFor="sv-name">
              {t('name')} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="sv-name"
              autoComplete="name"
              maxLength={200}
              value={identity.name}
              aria-invalid={!!errors.__name}
              onChange={(e) => {
                setIdentity((p) => ({ ...p, name: e.target.value }));
                if (errors.__name) setErrors((p) => ({ ...p, __name: '' }));
              }}
            />
            {errors.__name && <p className="text-xs text-destructive">{errors.__name}</p>}
          </div>
          <div id="sq-__email" className="flex flex-col gap-1.5">
            <Label htmlFor="sv-email">{t('email')}</Label>
            <Input
              id="sv-email"
              type="email"
              autoComplete="email"
              maxLength={320}
              value={identity.email}
              aria-invalid={!!errors.__email}
              onChange={(e) => {
                setIdentity((p) => ({ ...p, email: e.target.value }));
                if (errors.__email) setErrors((p) => ({ ...p, __email: '' }));
              }}
            />
            {errors.__email ? (
              <p className="text-xs text-destructive">{errors.__email}</p>
            ) : (
              <p className="text-xs text-muted-foreground">{t('emailHint')}</p>
            )}
          </div>
        </section>
      )}

      {survey.questions.map((q, i) => (
        <section
          key={q.id}
          id={`sq-${q.id}`}
          className={cn('rounded-xl border bg-card p-5 sm:p-6', errors[q.id] && 'border-destructive/60')}
        >
          <p className="font-medium leading-snug">
            <span className="mr-1.5 text-muted-foreground tabular-nums">{i + 1}.</span>
            {q.label}
            {q.required && <span className="ml-0.5 text-destructive">*</span>}
          </p>
          {q.helpText && <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{q.helpText}</p>}
          <div className="mt-4">
            <QuestionControl question={q} value={answers[q.id]} onChange={(v) => setAnswer(q.id, v)} />
          </div>
          {errors[q.id] && <p className="mt-2 text-xs text-destructive">{errors[q.id]}</p>}
        </section>
      ))}

      {(errors.__form || submitError) && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {errors.__form || submitError}
        </p>
      )}

      <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        {preview ? <p className="text-xs text-muted-foreground">{t('previewNote')}</p> : <span />}
        <Button type="submit" size="lg" disabled={submitting} className="sm:min-w-40">
          {submitting && <Loader2 className="size-4 animate-spin" />}
          {t('submit')}
        </Button>
      </div>
    </form>
  );
}

function QuestionControl({
  question: q,
  value,
  onChange,
}: {
  question: SurveyQuestion;
  value: AnswerValue | undefined;
  onChange: (v: AnswerValue) => void;
}) {
  const t = useTranslations('hrSurveys.renderer');
  const name = `q-${q.id}`;

  switch (q.type) {
    case 'SHORT_TEXT':
      return (
        <Input
          aria-label={q.label}
          maxLength={TEXT_MAX.SHORT_TEXT}
          placeholder={t('textPlaceholder')}
          value={value?.textValue ?? ''}
          onChange={(e) => onChange({ textValue: e.target.value })}
        />
      );
    case 'LONG_TEXT':
      return (
        <div className="flex flex-col gap-1">
          <Textarea
            aria-label={q.label}
            rows={4}
            maxLength={TEXT_MAX.LONG_TEXT}
            placeholder={t('textPlaceholder')}
            value={value?.textValue ?? ''}
            onChange={(e) => onChange({ textValue: e.target.value })}
          />
          <span className="self-end text-[11px] tabular-nums text-muted-foreground">
            {(value?.textValue ?? '').length} / {TEXT_MAX.LONG_TEXT}
          </span>
        </div>
      );
    case 'SINGLE_CHOICE':
      return (
        <div role="radiogroup" aria-label={q.label} className="flex flex-col gap-2">
          {q.options.map((o) => {
            const checked = value?.optionIds?.[0] === o.id;
            return (
              <label
                key={o.id}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors hover:bg-accent/50',
                  checked && 'border-primary bg-primary/5',
                )}
              >
                <input
                  type="radio"
                  name={name}
                  className="size-4 accent-primary"
                  checked={checked}
                  onChange={() => onChange({ optionIds: [o.id] })}
                />
                <span>{o.label}</span>
              </label>
            );
          })}
        </div>
      );
    case 'MULTIPLE_CHOICE': {
      const selected = new Set(value?.optionIds ?? []);
      return (
        <div role="group" aria-label={q.label} className="flex flex-col gap-2">
          {q.options.map((o) => {
            const checked = selected.has(o.id);
            return (
              <label
                key={o.id}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors hover:bg-accent/50',
                  checked && 'border-primary bg-primary/5',
                )}
              >
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={checked}
                  onChange={() => {
                    const next = new Set(selected);
                    if (checked) next.delete(o.id);
                    else next.add(o.id);
                    onChange({ optionIds: q.options.filter((x) => next.has(x.id)).map((x) => x.id) });
                  }}
                />
                <span>{o.label}</span>
              </label>
            );
          })}
          <p className="text-xs text-muted-foreground">{t('multipleHint')}</p>
        </div>
      );
    }
    case 'YES_NO':
      return (
        <div role="radiogroup" aria-label={q.label} className="grid grid-cols-2 gap-2 sm:max-w-xs">
          {[true, false].map((v) => (
            <button
              key={String(v)}
              type="button"
              role="radio"
              aria-checked={value?.boolValue === v}
              onClick={() => onChange({ boolValue: v })}
              className={cn(
                'rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors hover:bg-accent/50',
                value?.boolValue === v && 'border-primary bg-primary text-primary-foreground hover:bg-primary/90',
              )}
            >
              {v ? t('yes') : t('no')}
            </button>
          ))}
        </div>
      );
    case 'RATING': {
      const steps: number[] = [];
      for (let n = q.scaleMin; n <= q.scaleMax; n++) steps.push(n);
      return (
        <div className="flex flex-col gap-2">
          <div role="radiogroup" aria-label={q.label} className="flex flex-wrap gap-1.5">
            {steps.map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={value?.numberValue === n}
                onClick={() => onChange({ numberValue: n })}
                className={cn(
                  'flex h-10 min-w-10 flex-1 items-center justify-center rounded-lg border text-sm font-semibold tabular-nums transition-colors hover:bg-accent/50 sm:flex-none',
                  value?.numberValue === n && 'border-primary bg-primary text-primary-foreground hover:bg-primary/90',
                )}
              >
                {n}
              </button>
            ))}
          </div>
          {(q.scaleMinLabel || q.scaleMaxLabel) && (
            <div className="flex justify-between gap-4 text-xs text-muted-foreground">
              <span>{q.scaleMinLabel ? `${q.scaleMin} = ${q.scaleMinLabel}` : ''}</span>
              <span className="text-right">{q.scaleMaxLabel ? `${q.scaleMax} = ${q.scaleMaxLabel}` : ''}</span>
            </div>
          )}
        </div>
      );
    }
  }
}
