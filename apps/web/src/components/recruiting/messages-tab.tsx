'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Reply, ShieldAlert, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, apiGet, apiPatch, apiPost } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useHasPermission } from '@/stores/session';
import { MESSAGE_TONE, type CandidateMessage } from './recruiting-meta';

/** Pipeline 2, gate 2: every outbound e-mail is a draft until HR approves it here. Candidate replies are triaged below. */
export function MessagesTab({ openingId }: { openingId: string }) {
  const t = useTranslations('recruiting.messages');
  const tc = useTranslations('common');
  const queryClient = useQueryClient();
  const hasPermission = useHasPermission();
  const canApprove = hasPermission('recruiting:approve');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: messages = [] } = useQuery({
    queryKey: ['recruiting', 'messages', openingId],
    queryFn: () => apiGet<CandidateMessage[]>(`/recruiting/openings/${openingId}/messages`),
    // drafts, sends and triage run in the worker
    refetchInterval: 5000,
  });
  const onError = (err: unknown) => toast.error(err instanceof ApiError ? err.message : tc('error'));
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['recruiting'] });

  const approve = useMutation({
    mutationFn: (ids: string[]) => apiPost<{ approved: number }>('/recruiting/messages/approve', { ids }),
    onSuccess: ({ approved }) => {
      setSelected(new Set());
      refresh();
      toast.success(t('approved', { count: approved }));
    },
    onError,
  });

  const drafts = messages.filter((m) => m.status === 'DRAFT');
  const inbound = messages.filter((m) => m.direction === 'IN');
  const history = messages.filter((m) => m.direction === 'OUT' && m.status !== 'DRAFT');
  const toggle = (id: string, on: boolean) => setSelected((s) => (on ? new Set(s).add(id) : new Set([...s].filter((x) => x !== id))));

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold">{t('drafts', { count: drafts.length })}</h3>
            <p className="max-w-2xl text-sm text-muted-foreground">{t('draftsDesc')}</p>
          </div>
          {canApprove && drafts.length > 0 && (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setSelected(selected.size === drafts.length ? new Set() : new Set(drafts.map((d) => d.id)))}>
                {selected.size === drafts.length ? t('selectNone') : t('selectAll')}
              </Button>
              <Button size="sm" disabled={!selected.size || approve.isPending} onClick={() => approve.mutate([...selected])}>
                <Check className="size-3.5" /> {t('approveSelected', { count: selected.size })}
              </Button>
            </div>
          )}
        </div>
        {!drafts.length ? (
          <p className="rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground">{t('noDrafts')}</p>
        ) : (
          drafts.map((m) => (
            <DraftCard key={m.id} m={m} selected={selected.has(m.id)} onSelect={(on) => toggle(m.id, on)} onApprove={() => approve.mutate([m.id])} approving={approve.isPending} />
          ))
        )}
      </section>

      {inbound.length > 0 && (
        <section className="flex flex-col gap-3">
          <div>
            <h3 className="font-semibold">{t('inbound')}</h3>
            <p className="max-w-2xl text-sm text-muted-foreground">{t('inboundDesc')}</p>
          </div>
          {inbound.map((m) => (
            <InboundCard key={m.id} m={m} />
          ))}
        </section>
      )}

      {history.length > 0 && (
        <section className="flex flex-col gap-3">
          <h3 className="font-semibold">{t('history')}</h3>
          <div className="divide-y rounded-lg border">
            {history.map((m) => (
              <details key={m.id} className="group px-4 py-3">
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                  <Badge variant="secondary" className={cn('text-[11px]', MESSAGE_TONE[m.status])}>{t(`statuses.${m.status}`)}</Badge>
                  <Badge variant="outline" className="text-[11px]">{t(`kinds.${m.kind}`)}</Badge>
                  <span className="font-medium">{m.candidate.fullName ?? m.candidate.fileName}</span>
                  <span className="truncate text-muted-foreground">{m.subject}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{new Date(m.sentAt ?? m.approvedAt ?? m.createdAt).toLocaleString()}</span>
                </summary>
                {m.error && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{m.error}</p>}
                <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{m.body}</p>
              </details>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function CandidateName({ m }: { m: CandidateMessage }) {
  return (
    <Link href={`/recruiting/candidates/${m.candidate.id}`} className="font-medium hover:underline">
      {m.candidate.fullName ?? m.candidate.fileName}
    </Link>
  );
}

function DraftCard({
  m,
  selected,
  onSelect,
  onApprove,
  approving,
}: {
  m: CandidateMessage;
  selected: boolean;
  onSelect: (on: boolean) => void;
  onApprove: () => void;
  approving: boolean;
}) {
  const t = useTranslations('recruiting.messages');
  const tc = useTranslations('common');
  const queryClient = useQueryClient();
  const hasPermission = useHasPermission();
  const canEdit = hasPermission('recruiting:update');
  const canApprove = hasPermission('recruiting:approve');
  const [subject, setSubject] = useState(m.subject);
  const [body, setBody] = useState(m.body);
  const dirty = subject !== m.subject || body !== m.body;
  const onError = (err: unknown) => toast.error(err instanceof ApiError ? err.message : tc('error'));

  const save = useMutation({
    mutationFn: () => apiPatch(`/recruiting/messages/${m.id}`, { subject, body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recruiting', 'messages'] }),
    onError,
  });
  const discard = useMutation({
    mutationFn: () => apiPost(`/recruiting/messages/${m.id}/discard`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recruiting', 'messages'] }),
    onError,
  });
  // edits are saved before approval so HR approves exactly what is sent
  const saveThen = async (then: () => void) => {
    if (dirty) await save.mutateAsync();
    then();
  };

  return (
    <Card className={cn(selected && 'ring-2 ring-primary/40')}>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {canApprove && <Checkbox checked={selected} onCheckedChange={(v) => onSelect(v === true)} aria-label={t('select')} />}
          <Badge variant="outline" className="text-[11px]">{t(`kinds.${m.kind}`)}</Badge>
          <CandidateName m={m} />
          <span className="text-xs text-muted-foreground">→ {m.candidate.email}</span>
        </div>
        <Input value={subject} disabled={!canEdit} maxLength={300} onChange={(e) => setSubject(e.target.value)} onBlur={() => dirty && save.mutate()} />
        <Textarea rows={7} value={body} disabled={!canEdit} maxLength={10000} onChange={(e) => setBody(e.target.value)} onBlur={() => dirty && save.mutate()} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {m.kind === 'INVITATION' || m.kind === 'REMINDER' || (m.kind === 'REPLY' && ['INVITED', 'BOOKED'].includes(m.candidate.inviteStatus))
              ? t('linkAppended')
              : ''}
          </p>
          {canApprove && (
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" className="text-destructive" disabled={discard.isPending} onClick={() => discard.mutate()}>
                <X className="size-3.5" /> {t('discard')}
              </Button>
              <Button size="sm" disabled={approving || save.isPending || !subject.trim() || !body.trim()} onClick={() => saveThen(onApprove)}>
                <Check className="size-3.5" /> {t('approveSend')}
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function InboundCard({ m }: { m: CandidateMessage }) {
  const t = useTranslations('recruiting.messages');
  const tc = useTranslations('common');
  const queryClient = useQueryClient();
  const canEdit = useHasPermission()('recruiting:update');
  const [reply, setReply] = useState<string | null>(null);

  const write = useMutation({
    mutationFn: () => apiPost(`/recruiting/candidates/${m.candidateId}/messages`, { subject: `Re: ${m.subject}`, body: reply, inReplyToId: m.id }),
    onSuccess: () => {
      setReply(null);
      queryClient.invalidateQueries({ queryKey: ['recruiting', 'messages'] });
      toast.success(t('replyDrafted'));
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : tc('error')),
  });

  return (
    <Card className={cn(m.needsHuman && 'border-amber-500/50')}>
      <CardContent className="flex flex-col gap-2 p-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <CandidateName m={m} />
          {m.intent ? (
            <Badge variant="secondary" className="text-[11px]">{t(`intents.${m.intent}`)}</Badge>
          ) : (
            <Badge variant="secondary" className="text-[11px]">{t('triaging')}</Badge>
          )}
          {m.needsHuman && <Badge className="bg-amber-500/15 text-[11px] text-amber-700 dark:text-amber-400">{t('needsHuman')}</Badge>}
          <span className="ml-auto text-xs text-muted-foreground">{new Date(m.createdAt).toLocaleString()}</span>
        </div>
        {m.summary && <p className="text-sm font-medium">{m.summary}</p>}
        {m.flags.length > 0 && (
          <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
            <ShieldAlert className="size-3.5" /> {t('flagged')}
          </p>
        )}
        <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-sm">{m.body}</p>
        {canEdit &&
          (reply === null ? (
            <Button size="sm" variant="outline" className="self-start" onClick={() => setReply('')}>
              <Reply className="size-3.5" /> {t('writeReply')}
            </Button>
          ) : (
            <div className="flex flex-col gap-2">
              <Textarea rows={4} value={reply} maxLength={10000} autoFocus onChange={(e) => setReply(e.target.value)} />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setReply(null)}>
                  {tc('cancel')}
                </Button>
                <Button size="sm" disabled={!reply.trim() || write.isPending} onClick={() => write.mutate()}>
                  {t('saveReplyDraft')}
                </Button>
              </div>
            </div>
          ))}
      </CardContent>
    </Card>
  );
}
