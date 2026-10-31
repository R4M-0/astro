'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { EyeOff, Trash2, User } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, apiDelete, apiGet } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useSurveyScope } from './survey-scope';
import { QUESTION_TYPE_ICON } from './survey-builder';
import type { AnswerValue, SurveyDetail, SurveyQuestionType } from './survey-meta';

interface QuestionResult {
  questionId: string;
  type: SurveyQuestionType;
  label: string;
  required: boolean;
  answeredCount: number;
  options?: { id: string; label: string; count: number }[];
  yes?: number;
  no?: number;
  average?: number | null;
  scaleMin?: number;
  scaleMax?: number;
  scaleMinLabel?: string | null;
  scaleMaxLabel?: string | null;
  distribution?: { value: number; count: number }[];
  texts?: { responseId: string; text: string; submittedAt: string }[];
}

interface ResultsPayload {
  anonymous: boolean;
  responseCount: number;
  questions: QuestionResult[];
}

interface ResponseRow {
  id: string;
  submittedAt: string;
  respondentName: string | null;
  respondentEmail: string | null;
  /** false = name/e-mail typed on the public link (a claim); true = answered while signed in */
  verified: boolean | null;
  employee: { id: string; reference: string; firstName: string; lastName: string } | null;
  answers: (AnswerValue & { questionId: string })[];
}

export function SurveyResults({ survey, canDelete }: { survey: SurveyDetail; canDelete: boolean }) {
  const t = useTranslations('hrSurveys.results');
  const [view, setView] = useState<'question' | 'respondent'>('question');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          <span className="text-2xl font-semibold tabular-nums">{survey.responseCount}</span>{' '}
          <span className="text-muted-foreground">{t('responsesCount', { count: survey.responseCount })}</span>
        </p>
        <div role="tablist" className="inline-flex rounded-lg border p-0.5">
          {(['question', 'respondent'] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm transition-colors',
                view === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {v === 'question' ? t('byQuestion') : t('byRespondent')}
            </button>
          ))}
        </div>
      </div>
      {survey.anonymous && (
        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <EyeOff className="size-3.5" /> {t('anonymousNote')}
        </p>
      )}
      {view === 'question' ? <ByQuestion survey={survey} /> : <ByRespondent survey={survey} canDelete={canDelete} />}
    </div>
  );
}

function Bar({ label, count, total, highlight }: { label: React.ReactNode; count: number; total: number; highlight?: boolean }) {
  const pct = total ? Math.round((count / total) * 100) : 0;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
      <span className="truncate text-sm">{label}</span>
      <span className="text-xs tabular-nums text-muted-foreground">
        {count} · {pct} %
      </span>
      <div className="col-span-2 h-2 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full', highlight ? 'bg-primary' : 'bg-primary/60')} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ByQuestion({ survey }: { survey: SurveyDetail }) {
  const t = useTranslations('hrSurveys');
  const { api, queryKey } = useSurveyScope();
  const { data, isLoading } = useQuery({
    queryKey: [...queryKey, survey.id, 'results'],
    queryFn: () => apiGet<ResultsPayload>(`${api}/${survey.id}/results`),
  });
  if (isLoading || !data) return <Skeleton className="h-60" />;
  if (!data.responseCount) return <EmptyResponses />;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {data.questions.map((q, i) => {
        const Icon = QUESTION_TYPE_ICON[q.type];
        const max = Math.max(0, ...(q.options?.map((o) => o.count) ?? []), ...(q.distribution?.map((d) => d.count) ?? []));
        return (
          <Card key={q.questionId} className={cn((q.type === 'LONG_TEXT' || q.type === 'SHORT_TEXT') && 'lg:col-span-2')}>
            <CardHeader className="gap-1">
              <CardTitle className="text-sm font-medium leading-snug">
                <span className="mr-1.5 text-muted-foreground tabular-nums">{i + 1}.</span>
                {q.label}
              </CardTitle>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Icon className="size-3.5" /> {t(`types.${q.type}`)} · {t('results.answered', { count: q.answeredCount, total: data.responseCount })}
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {q.options?.map((o) => (
                <Bar key={o.id} label={o.label} count={o.count} total={data.responseCount} highlight={o.count === max && max > 0} />
              ))}
              {q.type === 'MULTIPLE_CHOICE' && <p className="text-[11px] text-muted-foreground">{t('results.multipleNote')}</p>}
              {q.type === 'YES_NO' && (
                <>
                  <Bar label={t('renderer.yes')} count={q.yes ?? 0} total={q.answeredCount} highlight={(q.yes ?? 0) >= (q.no ?? 0)} />
                  <Bar label={t('renderer.no')} count={q.no ?? 0} total={q.answeredCount} highlight={(q.no ?? 0) > (q.yes ?? 0)} />
                </>
              )}
              {q.type === 'RATING' && (
                <>
                  <p className="text-sm">
                    <span className="text-2xl font-semibold tabular-nums">{q.average != null ? q.average.toLocaleString() : '—'}</span>
                    <span className="text-muted-foreground"> / {q.scaleMax} · {t('results.average')}</span>
                  </p>
                  <div className="flex h-28 items-end gap-1.5" aria-label={t('results.distribution')}>
                    {q.distribution?.map((d) => (
                      <div key={d.value} className="flex flex-1 flex-col items-center gap-1" title={`${d.value} : ${d.count}`}>
                        <span className="text-[10px] tabular-nums text-muted-foreground">{d.count || ''}</span>
                        <div
                          className={cn('w-full rounded-t', d.count === max && max > 0 ? 'bg-primary' : 'bg-primary/50')}
                          style={{ height: `${max ? Math.max((d.count / max) * 80, d.count ? 4 : 0) : 0}px` }}
                        />
                        <span className="text-xs tabular-nums">{d.value}</span>
                      </div>
                    ))}
                  </div>
                  {(q.scaleMinLabel || q.scaleMaxLabel) && (
                    <div className="flex justify-between text-[11px] text-muted-foreground">
                      <span>{q.scaleMinLabel}</span>
                      <span>{q.scaleMaxLabel}</span>
                    </div>
                  )}
                </>
              )}
              {q.texts &&
                (q.texts.length ? (
                  <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
                    {q.texts.map((x, k) => (
                      <li key={`${x.responseId}-${k}`} className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                        <p className="whitespace-pre-line break-words">{x.text}</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">{format(new Date(x.submittedAt), survey.anonymous ? 'dd/MM/yyyy' : 'dd/MM/yyyy HH:mm')}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">{t('results.noText')}</p>
                ))}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function ByRespondent({ survey, canDelete }: { survey: SurveyDetail; canDelete: boolean }) {
  const t = useTranslations('hrSurveys');
  const { api, queryKey } = useSurveyScope();
  const tc = useTranslations('common');
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: [...queryKey, survey.id, 'responses'],
    queryFn: () => apiGet<{ anonymous: boolean; total: number; data: ResponseRow[] }>(`${api}/${survey.id}/responses`),
  });
  const remove = useMutation({
    mutationFn: (responseId: string) => apiDelete(`${api}/${survey.id}/responses/${responseId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...queryKey] });
      toast.success(t('results.responseDeleted'));
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : tc('error')),
  });

  if (isLoading || !data) return <Skeleton className="h-60" />;
  if (!data.data.length) return <EmptyResponses />;

  const questions = survey.questions;
  const render = (qid: string, a: AnswerValue | undefined) => {
    const q = questions.find((x) => x.id === qid);
    if (!q || !a) return <span className="text-muted-foreground/60">{t('results.noAnswer')}</span>;
    if (a.optionIds?.length) {
      return a.optionIds.map((id) => q.options.find((o) => o.id === id)?.label ?? '?').join(', ');
    }
    if (typeof a.boolValue === 'boolean') return a.boolValue ? t('renderer.yes') : t('renderer.no');
    if (typeof a.numberValue === 'number') return `${a.numberValue} / ${q.scaleMax}`;
    if (a.textValue) return <span className="whitespace-pre-line break-words">{a.textValue}</span>;
    return <span className="text-muted-foreground/60">{t('results.noAnswer')}</span>;
  };

  return (
    <div className="flex flex-col gap-3">
      {data.data.map((r, idx) => {
        const byQ = new Map(r.answers.map((a) => [a.questionId, a]));
        const who = data.anonymous
          ? t('results.anonymous')
          : r.employee
            ? `${r.employee.firstName} ${r.employee.lastName}`
            : r.respondentName ?? t('results.anonymous');
        return (
          <Card key={r.id}>
            <CardHeader className="flex-row items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                  {data.anonymous ? <EyeOff className="size-4 text-muted-foreground" /> : <User className="size-4 text-muted-foreground" />}
                  {who}
                  {!data.anonymous && r.employee && (
                    <span className="rounded border bg-muted/50 px-1 font-mono text-[10px] text-muted-foreground">{r.employee.reference}</span>
                  )}
                  {!data.anonymous && r.verified === false && (
                    <span
                      title={t('results.unverifiedHint')}
                      className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 text-[10px] font-normal text-amber-700 dark:text-amber-400"
                    >
                      {t('results.unverified')}
                    </span>
                  )}
                </CardTitle>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  #{data.data.length - idx} · {format(new Date(r.submittedAt), data.anonymous ? 'dd/MM/yyyy' : 'dd/MM/yyyy HH:mm')}
                  {!data.anonymous && r.respondentEmail ? ` · ${r.respondentEmail}` : ''}
                </p>
              </div>
              {canDelete && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 text-destructive"
                  aria-label={tc('delete')}
                  disabled={remove.isPending}
                  onClick={() => window.confirm(t('results.deleteResponseConfirm')) && remove.mutate(r.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 text-sm">
                {questions.map((q, i) => (
                  <div key={q.id} className="grid gap-0.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-4">
                    <dt className="text-muted-foreground">
                      {i + 1}. {q.label}
                    </dt>
                    <dd>{render(q.id, byQ.get(q.id))}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function EmptyResponses() {
  const t = useTranslations('hrSurveys.results');
  return (
    <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">{t('empty')}</div>
  );
}
