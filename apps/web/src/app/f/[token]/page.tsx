'use client';

import { use, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

interface PublicTraining {
  code: string;
  theme: string;
  startDate: string | null;
  endDate: string | null;
  evaluationType: 'HOT' | 'COLD';
}

export default function PublicTrainingFeedbackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token: rawToken } = use(params);
  // tokens are base64url — anything else can't be a valid link (and must not reach the URL path raw)
  const token = /^[A-Za-z0-9_-]{8,128}$/.test(rawToken) ? rawToken : '';
  const t = useTranslations('hr.publicFeedback');

  const [training, setTraining] = useState<PublicTraining | null>(null);
  const [fetchError, setError] = useState(false);
  const [fetching, setLoading] = useState(true);
  // an invalid token never reaches the API
  const error = !token || fetchError;
  const loading = !!token && fetching;
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`${API_URL}/hr/trainings/public/${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: PublicTraining) => setTraining(data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [token]);

  const submit = async () => {
    if (!training || !score) return;
    setSubmitting(true);
    const res = await fetch(`${API_URL}/hr/trainings/public/${encodeURIComponent(token)}/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        satisfactionScore: score,
        answers: comment.trim() ? { comment: comment.trim() } : undefined,
        respondentName: name.trim() || undefined,
      }),
    });
    setSubmitting(false);
    if (res.ok) setDone(true);
  };

  return (
    <div className="mx-auto flex min-h-svh max-w-xl flex-col justify-center gap-4 p-6">
      {loading && <p className="text-center text-sm text-muted-foreground">…</p>}
      {error && (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">{t('unavailable')}</CardContent></Card>
      )}
      {done && (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-lg font-semibold">{t('thanksTitle')}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t('thanksBody')}</p>
          </CardContent>
        </Card>
      )}

      {training && !done && (
        <Card>
          <CardHeader>
            <CardTitle>{t(training.evaluationType === 'HOT' ? 'hotTitle' : 'coldTitle')}</CardTitle>
            <p className="text-sm text-muted-foreground">{t('subtitle', { theme: training.theme })}</p>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="grid gap-2">
              <Label>{t('satisfactionQuestion')}</Label>
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setScore(n)}
                    className={cn(
                      'flex flex-1 flex-col items-center gap-1 rounded-md border p-2 text-xs transition-colors',
                      score === n ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent',
                    )}
                  >
                    <span className="text-base font-semibold tabular-nums">{n}</span>
                    <span className="text-center leading-tight">{t(`s${n}`)}</span>
                  </button>
                ))}
              </div>
            </div>
            <Field className="grid gap-1.5">
              <Label>{t('commentLabel')}</Label>
              <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('commentPh')} />
            </Field>
            <Field className="grid gap-1.5">
              <Label>{t('nameLabel')}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('namePh')} />
            </Field>
            <Button disabled={!score || submitting} onClick={submit} className="w-full">{t('submit')}</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
