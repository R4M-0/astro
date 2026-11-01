'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, ExternalLink, RotateCcw, Trash2, X } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { DetailPage } from '@/components/layout/detail-page';
import { CV_TONE, DECISION_TONE, type CandidateRow, type Criterion, type Decision } from '@/components/recruiting/recruiting-meta';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/form-dialog';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useHasPermission } from '@/stores/session';

interface Profile {
  skills: string[];
  languages: string[];
  totalYearsExperience: number;
  education: { degree: string; field: string }[];
  experiences: { title: string; durationYears: number; highlights: string }[];
  summary: string;
}

interface CandidateDetail extends CandidateRow {
  jobOpeningId: string;
  jobOpening: { id: string; title: string; criteria: Criterion[]; shortlistSize: number };
  cvText: string | null;
  profile: Profile | null;
  dimsExplained: { dimension: number; contribution: number }[] | null;
  criteriaScores: { id: string; label: string; score: number; evidence: string; verified: boolean }[] | null;
  justification: string | null;
  decisionReason: string | null;
  decidedAt: string | null;
}

export default function CandidatePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('recruiting');
  const tc = useTranslations('common');
  const queryClient = useQueryClient();
  const hasPermission = useHasPermission();
  const canDecide = hasPermission('recruiting:approve');
  const canEdit = hasPermission('recruiting:update');
  const canDelete = hasPermission('recruiting:delete');
  const [reason, setReason] = useState<string | null>(null);

  const { data: c, isLoading } = useQuery({
    queryKey: ['recruiting', 'candidate', id],
    queryFn: () => apiGet<CandidateDetail>(`/recruiting/candidates/${id}`),
    refetchInterval: (q) => (q.state.data?.status === 'RECEIVED' || q.state.data?.status === 'PROCESSING' ? 3000 : false),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['recruiting'] });
  const onError = (err: unknown) => toast.error(err instanceof ApiError ? err.message : tc('error'));

  const decide = useMutation({
    mutationFn: (decision: Decision) => apiPatch(`/recruiting/candidates/${id}/decision`, { decision, reason: reason ?? c?.decisionReason ?? '' }),
    onSuccess: () => {
      refresh();
      setReason(null);
      toast.success(t('candidate.decided'));
    },
    onError,
  });
  const retry = useMutation({
    mutationFn: () => apiPost(`/recruiting/candidates/${id}/retry`),
    onSuccess: () => {
      refresh();
      toast.success(t('candidate.retried'));
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: () => apiDelete(`/recruiting/candidates/${id}`),
    onSuccess: () => {
      refresh();
      toast.success(t('candidate.deleted'));
      router.push(`/recruiting/${c!.jobOpeningId}`);
    },
    onError,
  });
  const openCv = async () => {
    try {
      const { url } = await apiGet<{ url: string }>(`/recruiting/candidates/${id}/file`);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      onError(err);
    }
  };

  const section = (title: string, body: React.ReactNode) => (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
  const maxDim = Math.max(...(c?.dimsExplained ?? []).map((d) => d.contribution), 0) || 1;

  return (
    <DetailPage
      backHref={c ? `/recruiting/${c.jobOpeningId}` : '/recruiting'}
      backLabel={c?.jobOpening.title ?? t('title')}
      loading={isLoading || !c}
      title={c && (c.fullName ?? t('candidate.unnamed'))}
      subtitle={c?.fileName}
      badges={
        c && (
          <>
            <Badge variant="secondary" className={cn('text-[11px]', CV_TONE[c.status])}>{t(`cvStatuses.${c.status}`)}</Badge>
            <Badge variant="secondary" className={cn('text-[11px]', DECISION_TONE[c.decision])}>{t(`decisions.${c.decision}`)}</Badge>
          </>
        )
      }
      actions={
        c && (
          <>
            <Button size="sm" variant="outline" onClick={openCv}>
              <ExternalLink className="size-3.5" /> {t('candidate.download')}
            </Button>
            {canEdit && c.status === 'FAILED' && (
              <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate()}>
                <RotateCcw className="size-3.5" /> {t('candidate.retry')}
              </Button>
            )}
            {canDelete && (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                disabled={remove.isPending}
                onClick={() => confirm(t('candidate.deleteConfirm')) && remove.mutate()}
              >
                <Trash2 className="size-3.5" /> {tc('delete')}
              </Button>
            )}
          </>
        )
      }
    >
      {c && (
        <div className="flex flex-col gap-4">
          {c.error && <p className="rounded-md bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-400">{c.error}</p>}

          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { label: t('candidate.score'), value: c.score ?? '—' },
              { label: t('candidate.rank'), value: c.rank ? `${c.rank} · ${c.shortlisted ? t('candidate.shortlisted') : t('candidate.notShortlisted')}` : '—' },
              { label: t('candidate.retrieval'), value: c.retrievalScore != null ? c.retrievalScore.toFixed(3) : '—' },
            ].map((s) => (
              <Card key={s.label}>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{s.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {canDecide && c.status === 'READY' &&
            section(
              t('candidate.decide'),
              <div className="flex flex-col gap-3">
                <Field label={t('candidate.reason')} hint={t('candidate.reasonHint')}>
                  <Textarea rows={2} maxLength={2000} value={reason ?? c.decisionReason ?? ''} onChange={(e) => setReason(e.target.value)} />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={decide.isPending || c.decision === 'APPROVED'} onClick={() => decide.mutate('APPROVED')}>
                    <Check className="size-3.5" /> {t('candidate.approve')}
                  </Button>
                  <Button size="sm" variant="outline" className="text-destructive" disabled={decide.isPending || c.decision === 'REJECTED'} onClick={() => decide.mutate('REJECTED')}>
                    <X className="size-3.5" /> {t('candidate.reject')}
                  </Button>
                  {c.decision !== 'PENDING' && (
                    <Button size="sm" variant="ghost" disabled={decide.isPending} onClick={() => decide.mutate('PENDING')}>
                      <RotateCcw className="size-3.5" /> {t('candidate.reset')}
                    </Button>
                  )}
                </div>
              </div>,
            )}

          {c.filterReasons && c.filterReasons.length > 0 &&
            section(t('candidate.filterReasons'), <p className="text-sm">{c.filterReasons.join(', ')}</p>)}

          {c.criteriaScores
            ? section(
                t('candidate.criteria'),
                <div className="flex flex-col gap-3">
                  {c.justification && <p className="text-sm">{c.justification}</p>}
                  {c.criteriaScores.map((s) => (
                    <div key={s.id} className="rounded-md border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{s.label}</span>
                        <span className="text-sm font-semibold tabular-nums">{s.score}/3</span>
                      </div>
                      {s.evidence && (
                        <blockquote className={cn('mt-1.5 border-l-2 pl-2 text-sm italic text-muted-foreground', !s.verified && 'line-through')}>
                          {s.evidence}
                        </blockquote>
                      )}
                      {s.evidence && !s.verified && (
                        <p className="mt-1 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                          <AlertTriangle className="size-3" /> {t('candidate.unverified')}
                        </p>
                      )}
                    </div>
                  ))}
                </div>,
              )
            : c.status === 'READY' && <p className="text-sm text-muted-foreground">{t('candidate.notRanked')}</p>}

          {c.status === 'READY' &&
            section(
              t('candidate.guard'),
              c.guardFlags.length ? (
                <ul className="list-disc pl-5 text-sm">
                  {c.guardFlags.map((f, i) => <li key={i}>{f}</li>)}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t('candidate.guardNone')}</p>
              ),
            )}

          {c.profile &&
            section(
              t('candidate.profile'),
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">{t('candidate.summary')}</dt>
                  <dd className="mt-0.5">{c.profile.summary || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t('candidate.skills')}</dt>
                  <dd className="mt-1 flex flex-wrap gap-1">
                    {c.profile.skills.map((s) => <Badge key={s} variant="secondary" className="text-[11px]">{s}</Badge>)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t('candidate.languages')}</dt>
                  <dd className="mt-0.5">{c.profile.languages.join(', ') || '—'}</dd>
                  <dt className="mt-3 text-xs text-muted-foreground">{t('candidate.years')}</dt>
                  <dd className="mt-0.5 tabular-nums">{c.profile.totalYearsExperience}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t('candidate.experiences')}</dt>
                  <dd className="mt-0.5 flex flex-col gap-1">
                    {c.profile.experiences.map((e, i) => (
                      <span key={i}>
                        <span className="font-medium">{e.title}</span> <span className="text-muted-foreground">· {e.durationYears}</span>
                      </span>
                    ))}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t('candidate.education')}</dt>
                  <dd className="mt-0.5 flex flex-col gap-1">
                    {c.profile.education.map((e, i) => <span key={i}>{[e.degree, e.field].filter(Boolean).join(' — ')}</span>)}
                  </dd>
                </div>
              </dl>,
            )}

          {c.dimsExplained && c.dimsExplained.length > 0 &&
            section(
              t('candidate.dims'),
              <div className="flex flex-col gap-1.5">
                <p className="text-xs text-muted-foreground">{t('candidate.dimsHint')}</p>
                {c.dimsExplained.map((d) => (
                  <div key={d.dimension} className="flex items-center gap-2 text-xs">
                    <span className="w-14 font-mono text-muted-foreground">#{d.dimension}</span>
                    <div className="h-2 flex-1 rounded bg-muted">
                      <div className="h-2 rounded bg-primary" style={{ width: `${(d.contribution / maxDim) * 100}%` }} />
                    </div>
                    <span className="w-16 text-right tabular-nums">{d.contribution.toFixed(4)}</span>
                  </div>
                ))}
              </div>,
            )}

          {c.cvText &&
            section(t('candidate.cvText'), <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-xs">{c.cvText}</pre>)}
        </div>
      )}
    </DetailPage>
  );
}
