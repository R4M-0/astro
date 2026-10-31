'use client';

import { use, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, CircleSlash, Lock, SearchX } from 'lucide-react';
import { SurveyRenderer, type SurveySubmission } from '@/components/hr/survey-renderer';
import type { PublicSurvey } from '@/components/hr/survey-meta';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

type Phase = 'loading' | 'notFound' | 'closed' | 'form' | 'done' | 'duplicate' | 'error';

/** Stable per-browser random key — the server only stores its hash (duplicate guard, not identity). */
function respondentKey(token: string) {
  const storageKey = `astro.survey.${token}.key`;
  const fresh = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? `${crypto.randomUUID()}-${crypto.randomUUID()}`
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  try {
    const existing = localStorage.getItem(storageKey);
    if (existing) return existing;
    const key = fresh();
    localStorage.setItem(storageKey, key);
    return key;
  } catch {
    return fresh();
  }
}

export default function PublicSurveyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const t = useTranslations('hrSurveys.public');
  const [phase, setPhase] = useState<Phase>('loading');
  const [survey, setSurvey] = useState<PublicSurvey | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch(`${API_URL}/hr/surveys/public/${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (!alive) return;
        if (r.status === 404) return setPhase('notFound');
        if (r.status === 410) return setPhase('closed');
        if (!r.ok) return setPhase('error');
        const data = (await r.json()) as PublicSurvey;
        setSurvey(data);
        setPhase(data.status === 'CLOSED' ? 'closed' : 'form');
      })
      .catch(() => alive && setPhase('error'));
    return () => {
      alive = false;
    };
  }, [token]);

  const submit = async (body: SurveySubmission) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`${API_URL}/hr/surveys/public/${encodeURIComponent(token)}/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, respondentKey: respondentKey(token) }),
      });
      if (res.ok) {
        setPhase('done');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      if (res.status === 409) return setPhase('duplicate');
      if (res.status === 410) return setPhase('closed');
      if (res.status === 404) return setPhase('notFound');
      if (res.status === 429) return setSubmitError(t('tooMany'));
      let message = t('submitError');
      try {
        const d = (await res.json()) as { message?: string | string[] };
        if (res.status === 400 && d.message) message = Array.isArray(d.message) ? d.message.join(', ') : d.message;
      } catch {
        /* non-JSON */
      }
      setSubmitError(message);
    } catch {
      setSubmitError(t('networkError'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-svh bg-muted/30">
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-8 sm:py-12">
        {phase === 'loading' && (
          <div className="flex flex-col gap-4" aria-busy="true">
            <Skeleton className="h-28" />
            <Skeleton className="h-36" />
            <Skeleton className="h-36" />
          </div>
        )}

        {phase === 'form' && survey && (
          <SurveyRenderer key={round} survey={survey} onSubmit={submit} submitting={submitting} submitError={submitError} />
        )}

        {phase === 'done' && (
          <StateCard icon={<CheckCircle2 className="size-10 text-emerald-600 dark:text-emerald-400" />} title={t('thanksTitle')} body={t('thanksBody')}>
            {survey?.allowMultipleResponses && (
              <Button
                variant="outline"
                onClick={() => {
                  setRound((r) => r + 1);
                  setSubmitError(null);
                  setPhase('form');
                }}
              >
                {t('another')}
              </Button>
            )}
          </StateCard>
        )}
        {phase === 'duplicate' && (
          <StateCard icon={<CircleSlash className="size-10 text-amber-600 dark:text-amber-400" />} title={t('duplicateTitle')} body={t('duplicateBody')} />
        )}
        {phase === 'closed' && (
          <StateCard
            icon={<Lock className="size-10 text-muted-foreground" />}
            title={survey?.title ? t('closedTitleNamed', { title: survey.title }) : t('closedTitle')}
            body={t('closedBody')}
          />
        )}
        {phase === 'notFound' && (
          <StateCard icon={<SearchX className="size-10 text-muted-foreground" />} title={t('notFoundTitle')} body={t('notFoundBody')} />
        )}
        {phase === 'error' && (
          <StateCard icon={<SearchX className="size-10 text-muted-foreground" />} title={t('errorTitle')} body={t('networkError')}>
            <Button variant="outline" onClick={() => window.location.reload()}>
              {t('retry')}
            </Button>
          </StateCard>
        )}

        <p className="pt-2 text-center text-xs text-muted-foreground">{t('poweredBy')}</p>
      </main>
    </div>
  );
}

function StateCard({ icon, title, body, children }: { icon: React.ReactNode; title: string; body: string; children?: React.ReactNode }) {
  return (
    <div role="status" className="flex flex-col items-center gap-3 rounded-xl border bg-card px-6 py-12 text-center">
      {icon}
      <h1 className="text-lg font-semibold text-balance">{title}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{body}</p>
      {children}
    </div>
  );
}
