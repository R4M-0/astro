'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleSlash, Lock } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import type { PublicSurvey } from './survey-meta';
import { SurveyRenderer, type SurveySubmission } from './survey-renderer';
import { useSurveyScope } from './survey-scope';

type MemberForm = PublicSurvey & { alreadyAnswered: boolean };

/** « Répondre » tab: a signed-in member answers inside the app (same form as the public link). */
export function SurveyAnswer({ surveyId }: { surveyId: string }) {
  const t = useTranslations('hrSurveys');
  const tp = useTranslations('hrSurveys.public');
  const { api, queryKey } = useSurveyScope();
  const queryClient = useQueryClient();
  const [done, setDone] = useState(false);
  const [round, setRound] = useState(0);

  const { data: form, isLoading, error } = useQuery({
    queryKey: [...queryKey, surveyId, 'form'],
    queryFn: () => apiGet<MemberForm>(`${api}/${surveyId}/form`),
  });

  const submit = useMutation({
    mutationFn: (body: SurveySubmission) => apiPost(`${api}/${surveyId}/respond`, { answers: body.answers }),
    onSuccess: () => {
      setDone(true);
      queryClient.invalidateQueries({ queryKey: [...queryKey] });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
  });

  if (isLoading) return <Skeleton className="mx-auto h-80 max-w-2xl" />;
  if (error || !form) {
    return <State icon={<Lock className="size-10 text-muted-foreground" />} title={t('answer.unavailable')} />;
  }
  if (done) {
    return (
      <State
        icon={<CheckCircle2 className="size-10 text-emerald-600 dark:text-emerald-400" />}
        title={tp('thanksTitle')}
        body={tp('thanksBody')}
      >
        {form.allowMultipleResponses && (
          <Button
            variant="outline"
            onClick={() => {
              setRound((r) => r + 1);
              submit.reset();
              setDone(false);
            }}
          >
            {tp('another')}
          </Button>
        )}
      </State>
    );
  }
  if (form.status === 'CLOSED') {
    return <State icon={<Lock className="size-10 text-muted-foreground" />} title={tp('closedTitle')} body={tp('closedBody')} />;
  }
  const duplicate = form.alreadyAnswered || (submit.error instanceof ApiError && submit.error.status === 409);
  if (duplicate) {
    return (
      <State
        icon={<CircleSlash className="size-10 text-amber-600 dark:text-amber-400" />}
        title={tp('duplicateTitle')}
        body={tp('duplicateBody')}
      />
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <SurveyRenderer
        key={round}
        survey={form}
        signedIn
        onSubmit={(body) => submit.mutate(body)}
        submitting={submit.isPending}
        submitError={submit.error ? (submit.error instanceof ApiError ? submit.error.message : tp('submitError')) : null}
      />
    </div>
  );
}

function State({ icon, title, body, children }: { icon: React.ReactNode; title: string; body?: string; children?: React.ReactNode }) {
  return (
    <div role="status" className="mx-auto flex max-w-2xl flex-col items-center gap-3 rounded-xl border bg-card px-6 py-12 text-center">
      {icon}
      <h2 className="text-lg font-semibold text-balance">{title}</h2>
      {body && <p className="max-w-md text-sm text-muted-foreground">{body}</p>}
      {children}
    </div>
  );
}
