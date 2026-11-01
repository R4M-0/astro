'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, MailX, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field } from '@/components/ui/form-dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ApiError, apiDelete, apiGet, apiPost } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useHasPermission } from '@/stores/session';
import { DECISION_TONE, INVITE_TONE, formatSlot, type CandidateRow, type InterviewSlot } from './recruiting-meta';

const EMPTY = { startsAt: '', durationMinutes: 45, location: '', interviewer: '' };

/** Pipeline 2: interviewer availability, then invitations to the approved shortlist (gate 1 done on the candidate page). */
export function InterviewsTab({ openingId, candidates, onDrafted }: { openingId: string; candidates: CandidateRow[]; onDrafted: () => void }) {
  const t = useTranslations('recruiting.interviews');
  const tr = useTranslations('recruiting');
  const tc = useTranslations('common');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const canEdit = useHasPermission()('recruiting:update');
  const [form, setForm] = useState(EMPTY);

  const { data: slots = [] } = useQuery({
    queryKey: ['recruiting', 'slots', openingId],
    queryFn: () => apiGet<InterviewSlot[]>(`/recruiting/openings/${openingId}/slots`),
  });
  const onError = (err: unknown) => toast.error(err instanceof ApiError ? err.message : tc('error'));
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['recruiting'] });

  const add = useMutation({
    mutationFn: () =>
      apiPost(`/recruiting/openings/${openingId}/slots`, {
        // datetime-local is the viewer's local time: toISOString carries the offset to the server
        slots: [{ ...form, startsAt: new Date(form.startsAt).toISOString() }],
      }),
    onSuccess: () => {
      refresh();
      setForm({ ...EMPTY, durationMinutes: form.durationMinutes, location: form.location, interviewer: form.interviewer });
    },
    onError,
  });
  const remove = useMutation({ mutationFn: (id: string) => apiDelete(`/recruiting/slots/${id}`), onSuccess: refresh, onError });
  const drafts = useMutation({
    mutationFn: (kind: 'INVITATION' | 'REJECTION') => apiPost<{ queued: number }>(`/recruiting/openings/${openingId}/drafts`, { kind }),
    onSuccess: ({ queued }) => {
      if (!queued) return toast.info(t('nothingToDraft'));
      toast.success(t('drafting', { count: queued }));
      onDrafted();
    },
    onError,
  });

  const decided = candidates.filter((c) => c.decision !== 'PENDING');
  const free = slots.filter((s) => !s.candidate && new Date(s.startsAt) > new Date()).length;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-4 p-5">
          <div>
            <h3 className="font-semibold">{t('slots')}</h3>
            <p className="text-sm text-muted-foreground">{t('slotsDesc')}</p>
          </div>
          {canEdit && (
            <form
              className="grid items-end gap-3 sm:grid-cols-[1.4fr_0.6fr_1fr_1fr_auto]"
              onSubmit={(e) => {
                e.preventDefault();
                add.mutate();
              }}
            >
              <Field label={t('startsAt')} required>
                <Input type="datetime-local" required value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
              </Field>
              <Field label={t('duration')}>
                <Input type="number" min={10} max={480} step={5} value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: Number(e.target.value) || 45 })} />
              </Field>
              <Field label={t('location')}>
                <Input value={form.location} maxLength={300} placeholder={t('locationHint')} onChange={(e) => setForm({ ...form, location: e.target.value })} />
              </Field>
              <Field label={t('interviewer')}>
                <Input value={form.interviewer} maxLength={200} onChange={(e) => setForm({ ...form, interviewer: e.target.value })} />
              </Field>
              <Button type="submit" size="sm" disabled={!form.startsAt || add.isPending}>
                <Plus className="size-3.5" /> {t('addSlot')}
              </Button>
            </form>
          )}
          {!slots.length ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{t('noSlots')}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('startsAt')}</TableHead>
                    <TableHead>{t('duration')}</TableHead>
                    <TableHead>{t('location')}</TableHead>
                    <TableHead>{t('interviewer')}</TableHead>
                    <TableHead>{t('bookedBy')}</TableHead>
                    {canEdit && <TableHead className="w-10" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {slots.map((s) => (
                    <TableRow key={s.id} className={cn(new Date(s.startsAt) < new Date() && 'opacity-60')}>
                      <TableCell className="whitespace-nowrap">{formatSlot(s.startsAt, locale)}</TableCell>
                      <TableCell className="tabular-nums">{s.durationMinutes} min</TableCell>
                      <TableCell className="text-sm">{s.location ?? '—'}</TableCell>
                      <TableCell className="text-sm">{s.interviewer ?? '—'}</TableCell>
                      <TableCell>
                        {s.candidate ? (
                          <Link href={`/recruiting/candidates/${s.candidate.id}`} className="font-medium hover:underline">
                            {s.candidate.fullName ?? s.candidate.fileName}
                          </Link>
                        ) : (
                          <span className="text-sm text-muted-foreground">{t('free')}</span>
                        )}
                      </TableCell>
                      {canEdit && (
                        <TableCell>
                          {!s.candidate && (
                            <Button variant="ghost" size="icon" className="size-8 text-destructive" disabled={remove.isPending} onClick={() => remove.mutate(s.id)}>
                              <Trash2 className="size-4" />
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-semibold">{t('invitations')}</h3>
              <p className="max-w-2xl text-sm text-muted-foreground">{t('invitationsDesc')}</p>
            </div>
            {canEdit && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={drafts.isPending || !free} title={!free ? t('needSlots') : undefined} onClick={() => drafts.mutate('INVITATION')}>
                  <Mail className="size-3.5" /> {t('draftInvitations')}
                </Button>
                <Button size="sm" variant="outline" disabled={drafts.isPending} onClick={() => drafts.mutate('REJECTION')}>
                  <MailX className="size-3.5" /> {t('draftRejections')}
                </Button>
              </div>
            )}
          </div>
          {canEdit && !free && decided.some((c) => c.decision === 'APPROVED') && (
            <p className="rounded-md bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">{t('needSlots')}</p>
          )}
          {!decided.length ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{t('noDecisions')}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tr('cols.candidate')}</TableHead>
                    <TableHead>{tr('cols.decision')}</TableHead>
                    <TableHead>{t('invitation')}</TableHead>
                    <TableHead>{t('interview')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {decided.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <Link href={`/recruiting/candidates/${c.id}`} className="font-medium hover:underline">
                          {c.fullName ?? c.fileName}
                        </Link>
                        <p className="text-xs text-muted-foreground">{c.email ?? t('noEmail')}</p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={cn('text-[11px]', DECISION_TONE[c.decision])}>{tr(`decisions.${c.decision}`)}</Badge>
                      </TableCell>
                      <TableCell>
                        {c.decision === 'APPROVED' && (
                          <Badge variant="secondary" className={cn('text-[11px]', INVITE_TONE[c.inviteStatus])}>{t(`inviteStatuses.${c.inviteStatus}`)}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{c.slot ? formatSlot(c.slot.startsAt, locale) : '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
