'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Clock, Inbox, Layers, Loader2, MailWarning, RefreshCw, ShieldAlert, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/page-header';
import { Panel, StatTile } from '@/components/layout/stat';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { graphApi } from '@/lib/api';
import { cn } from '@/lib/utils';

type Urgency = 'high' | 'medium' | 'low';
interface Item {
  id: string; thread: string; date: string; from: string; fromName: string; fromDept: string; toNames: string[];
  subject: string; snippet: string; type: string; urgency: Urgency; urgencyReason: string;
  needsAnswer: boolean; waitingDays: number | null; flagged: string | null;
}
interface Digest {
  period: { days: number; from: string; to: string };
  counts: { received: number; needsAnswer: number; high: number; blocked: number };
  needsAnswer: Item[];
  groups: { type: string; label: string; items: Item[] }[];
}
interface Overview { headline: string; bullets: { text: string; ids: string[] }[] }
interface Draft { id: string; subject: string; body: string; status: string }

const URGENCY_CLASS: Record<Urgency, string> = {
  high: 'bg-destructive/10 text-destructive border-destructive/30',
  medium: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30',
  low: 'bg-muted text-muted-foreground border-border',
};

function useFmt() {
  const locale = useLocale();
  return (d: string) => new Date(d).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

function UrgencyBadge({ u }: { u: Urgency }) {
  const t = useTranslations('hrInbox.urgency');
  return <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-medium', URGENCY_CLASS[u])}>{t(u)}</span>;
}

/** One email needing an answer: draft a reply with the AI, a human edits and approves it. */
function NeedsAnswerRow({ item, onDone }: { item: Item; onDone: () => void }) {
  const t = useTranslations('hrInbox');
  const fmt = useFmt();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<'draft' | 'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (kind: 'draft' | 'approve' | 'reject') => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'draft') setDraft(await graphApi<Draft>('/actions/draft', { ref: item.from, intent: `Answer their email "${item.subject}" helpfully, based on the handbook`, replyTo: item.id }));
      else {
        await graphApi(`/actions/${draft!.id}/${kind}`, kind === 'approve' ? { subject: draft!.subject, body: draft!.body } : {});
        setDraft(null);
        onDone();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <UrgencyBadge u={item.urgency} />
            <span className="truncate font-medium">{item.subject}</span>
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">{item.fromName} · {item.fromDept} · {fmt(item.date)}</div>
          {item.snippet && <p className="mt-1.5 text-sm text-muted-foreground">{item.snippet}</p>}
          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="size-3.5" />{item.urgencyReason}{item.waitingDays ? ` · ${t('waiting', { days: item.waitingDays })}` : ''}
          </div>
        </div>
        {!draft && (
          <Button size="sm" variant="outline" onClick={() => run('draft')} disabled={busy !== null}>
            {busy === 'draft' ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}{t('draftReply')}
          </Button>
        )}
      </div>
      {draft && (
        <div className="mt-3 space-y-2 rounded-md bg-muted/40 p-3">
          <div className="text-xs font-medium text-muted-foreground">{t('draftHint')}</div>
          <Input aria-label={t('draftSubject')} value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
          <Textarea aria-label={t('draftBody')} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={6} />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => run('reject')} disabled={busy !== null}><X className="size-4" />{t('reject')}</Button>
            <Button size="sm" onClick={() => run('approve')} disabled={busy !== null}>{busy === 'approve' ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}{t('approveSend')}</Button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function InboxDigest() {
  const t = useTranslations('hrInbox');
  const fmt = useFmt();
  const qc = useQueryClient();
  const [days, setDays] = useState<1 | 7>(7);
  const digest = useQuery({ queryKey: ['graph', 'digest', days], queryFn: () => graphApi<Digest>(`/digest?days=${days}`) });
  const [fresh, setFresh] = useState(0);
  const overview = useQuery({ queryKey: ['graph', 'digest-overview', days, fresh], queryFn: () => graphApi<Overview>(`/digest/overview?days=${days}${fresh ? '&fresh=1' : ''}`), staleTime: 5 * 60_000 });
  const [focus, setFocus] = useState<string | null>(null);
  const d = digest.data;
  const byId = new Map(d ? [...d.needsAnswer, ...d.groups.flatMap((g) => g.items)].map((i) => [i.id, i]) : []);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['graph', 'digest'] });

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-5 p-4 sm:p-6">
      <PageHeader
        title={t('title')}
        description={t('desc')}
        actions={
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border p-0.5">
              {([1, 7] as const).map((n) => (
                <button key={n} type="button" aria-pressed={days === n} onClick={() => setDays(n)} className={cn('rounded-md px-3 py-1 text-sm', days === n ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>{n === 1 ? t('today') : t('last7')}</button>
              ))}
            </div>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile s={{ label: t('tiles.received'), value: d?.counts.received ?? '—', icon: Inbox, hint: days === 1 ? t('tiles.last24h') : t('tiles.last7'), hintTone: 'muted' }} />
        <StatTile s={{ label: t('tiles.toAnswer'), value: d?.counts.needsAnswer ?? '—', icon: MailWarning, hint: t('tiles.toAnswerHint'), hintTone: d?.counts.needsAnswer ? 'warn' : 'muted' }} />
        <StatTile s={{ label: t('tiles.urgent'), value: d?.counts.high ?? '—', icon: AlertTriangle, hintTone: 'destructive', hint: d?.counts.high ? t('tiles.urgentHint') : undefined }} />
        <StatTile s={{ label: t('tiles.blocked'), value: d?.counts.blocked ?? '—', icon: ShieldAlert, hint: t('tiles.blockedHint'), hintTone: 'muted' }} />
      </div>

      <Panel
        title={t('summary')}
        icon={Sparkles}
        action={<Button size="sm" variant="ghost" onClick={() => setFresh((f) => f + 1)} disabled={overview.isFetching}>{overview.isFetching ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}{t('regenerate')}</Button>}
      >
        {overview.isLoading ? (
          <div className="space-y-2"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-5/6" /></div>
        ) : overview.error ? (
          <p className="text-sm text-muted-foreground">{t('summaryUnavailable', { reason: (overview.error as Error).message })}</p>
        ) : (
          <div className="space-y-3">
            <p className="font-medium">{overview.data?.headline}</p>
            <ul className="space-y-2">
              {overview.data?.bullets.map((b, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                  <span>
                    {b.text}{' '}
                    {b.ids.slice(0, 6).map((id) => (
                      <button key={id} onClick={() => setFocus(focus === id ? null : id)} title={byId.get(id)?.subject} className={cn('mr-1 rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground hover:bg-primary/15 hover:text-foreground', focus === id && 'bg-primary/20 text-foreground')}>{id}</button>
                    ))}
                    {b.ids.length > 6 && <span className="text-[10px] text-muted-foreground">+{b.ids.length - 6}</span>}
                  </span>
                </li>
              ))}
            </ul>
            {focus && byId.get(focus) && (
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <div className="flex items-center gap-2"><UrgencyBadge u={byId.get(focus)!.urgency} /><span className="font-medium">{byId.get(focus)!.subject}</span></div>
                <div className="mt-0.5 text-xs text-muted-foreground">{byId.get(focus)!.fromName} · {byId.get(focus)!.fromDept} · {fmt(byId.get(focus)!.date)}</div>
                {byId.get(focus)!.snippet && <p className="mt-1 text-muted-foreground">{byId.get(focus)!.snippet}</p>}
              </div>
            )}
            <p className="text-xs text-muted-foreground">{t('summaryFooter')}</p>
          </div>
        )}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
        <Panel title={t('needsAnswer', { count: d?.needsAnswer.length ?? 0 })} icon={MailWarning} bodyClassName="space-y-2">
          {digest.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : d?.needsAnswer.length ? (
            d.needsAnswer.map((i) => <NeedsAnswerRow key={i.id} item={i} onDone={refresh} />)
          ) : (
            <p className="text-sm text-muted-foreground">{t('inboxZero')}</p>
          )}
        </Panel>

        <Panel title={t('byType')} icon={Layers} bodyClassName="space-y-4">
          {digest.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : !d?.groups.length ? (
            <p className="text-sm text-muted-foreground">{t('noEmail')}</p>
          ) : (
            d.groups.map((g) => (
              <div key={g.type}>
                <div className="mb-1.5 flex items-center justify-between text-sm font-medium">
                  <span className="flex items-center gap-1.5">{g.type === 'security' && <ShieldAlert className="size-4 text-destructive" />}{g.label}</span>
                  <span className="text-xs text-muted-foreground">{g.items.length}</span>
                </div>
                <div className="space-y-1">
                  {g.items.map((i) => (
                    <div key={i.id} className="flex items-center gap-2 text-sm">
                      <span className={cn('size-2 shrink-0 rounded-full', i.urgency === 'high' ? 'bg-destructive' : i.urgency === 'medium' ? 'bg-amber-500' : 'bg-muted-foreground/40')} title={i.urgencyReason} />
                      <span className="min-w-0 flex-1 truncate">{i.flagged ? <span className="text-destructive">{t('blockedSubject', { subject: i.subject })}</span> : i.subject}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{i.fromName.split(' ')[0]} · {fmt(i.date)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </Panel>
      </div>
    </div>
  );
}
