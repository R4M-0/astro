'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, ExternalLink, GitBranch, Loader2, Mail, MessageSquarePlus, ShieldAlert, Sparkles, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { graphApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { TOPIC_COLOR, type Bridge, type EmployeeDetail, type HrAction, type Signal } from './types';

export const glass = 'rounded-2xl border border-white/10 bg-[#0a0d1f]/75 text-slate-100 shadow-2xl backdrop-blur-xl';
const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

export function TopicChip({ concept, label }: { concept: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px]">
      <span className="size-1.5 rounded-full" style={{ background: TOPIC_COLOR[concept] ?? '#fff' }} />
      {label}
    </span>
  );
}

const SEV = { important: 'text-rose-300 border-rose-400/30 bg-rose-500/10', attention: 'text-amber-200 border-amber-300/30 bg-amber-400/10', info: 'text-sky-200 border-sky-300/30 bg-sky-400/10' };

// ───────────────────────── employee file ─────────────────────────
export function EmployeePanel({ refId, onClose, onFly, onAsk, onDrafted, inGroup, onToggleGroup }: { refId: string; onClose: () => void; onFly: (ref: string) => void; onAsk: (ref: string) => void; onDrafted: () => void; inGroup: boolean; onToggleGroup: (ref: string) => void }) {
  const { data: e, isLoading } = useQuery({ queryKey: ['graph', 'employee', refId], queryFn: () => graphApi<EmployeeDetail>(`/employees/${refId}`) });
  const [open, setOpen] = useState<string | null>(null);
  const [intent, setIntent] = useState('');
  const [replyTo, setReplyTo] = useState<string | undefined>();
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doDraft = async () => {
    setDrafting(true);
    setError(null);
    try {
      await graphApi('/actions/draft', { ref: refId, intent: intent || 'Friendly check-in', replyTo });
      setIntent('');
      setReplyTo(undefined);
      onDrafted();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDrafting(false);
    }
  };

  return (
    <div className={cn(glass, 'flex h-full w-[400px] flex-col overflow-hidden')}>
      <div className="flex items-start justify-between gap-2 border-b border-white/10 p-4">
        {e ? (
          <div className="min-w-0">
            <div className="text-lg font-semibold leading-tight">{e.name}</div>
            <div className="text-xs text-slate-400">{e.title} · {e.department} / {e.team}</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-slate-300">{e.ref}</span>
              {!e.active && <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] text-rose-300">Left {fmt(e.exitDate)}</span>}
              {e.bridge > 0.25 && <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] text-violet-200"><GitBranch className="mr-1 inline size-3" />Bridge</span>}
            </div>
          </div>
        ) : (
          <div className="h-12" />
        )}
        <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"><X className="size-4" /></button>
      </div>
      {isLoading || !e ? (
        <div className="flex flex-1 items-center justify-center"><Loader2 className="size-5 animate-spin text-slate-400" /></div>
      ) : (
        <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
          <div className="flex gap-2">
            <Link href={`/hr/employees/${e.id}`} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs hover:bg-white/10"><ExternalLink className="size-3.5" />Astro record</Link>
            <button onClick={() => onAsk(e.ref)} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-indigo-300/30 bg-indigo-500/15 px-2 py-1.5 text-xs text-indigo-100 hover:bg-indigo-500/25"><Sparkles className="size-3.5" />Ask about {e.name.split(' ')[0]}</button>
            <button onClick={() => onToggleGroup(e.ref)} title="Add to the group (or shift-click stars)" className={cn('inline-flex items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-xs', inGroup ? 'border-amber-300/40 bg-amber-400/15 text-amber-100' : 'border-white/10 bg-white/5 hover:bg-white/10')}>{inGroup ? <Check className="size-3.5" /> : '+'} Group</button>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            {[['Hired', fmt(e.hireDate)], ['Contract', e.contract ?? '—'], ['Location', e.location], ['Manager', e.manager?.name ?? '—'], ['Trial ends', fmt(e.trialEndDate)], ['Sick days', String(e.sickDays)]].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-white/[0.04] px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wide text-slate-500">{k}</div><div className="truncate">{k === 'Manager' && e.manager ? <button className="hover:underline" onClick={() => onFly(e.manager!.ref)}>{v}</button> : v}</div></div>
            ))}
          </div>

          <div>
            <div className="mb-1 flex justify-between text-xs"><span className="text-slate-400">Annual leave</span><span>{e.leave.remaining} / {e.leave.annual} days left</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-sky-400 to-indigo-400" style={{ width: `${(e.leave.remaining / e.leave.annual) * 100}%` }} /></div>
          </div>

          {e.topics.length > 0 && (
            <div><div className="mb-1.5 text-xs text-slate-400">What they talk to HR about</div><div className="flex flex-wrap gap-1.5">{e.topics.map((t) => <TopicChip key={t.concept} {...t} />)}</div></div>
          )}

          {e.signals.length > 0 && (
            <div className="space-y-1.5">{e.signals.map((s) => <div key={s.id} className={cn('rounded-lg border px-2.5 py-2 text-xs', SEV[s.severity])}><div className="font-medium">{s.title}</div><div className="opacity-80">{s.reason}</div></div>)}</div>
          )}

          {e.bridgeDepts.length > 0 && (
            <div className="text-xs text-slate-300"><span className="text-slate-400">Connects </span>{e.department} ↔ {e.bridgeDepts.join(', ')}</div>
          )}

          <div>
            <div className="mb-1.5 text-xs text-slate-400">Strongest connections</div>
            <div className="space-y-1">
              {e.neighbors.map((n) => (
                <button key={n.ref} onClick={() => onFly(n.ref)} className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-left text-xs hover:bg-white/5">
                  <span className="truncate">{n.name} <span className="text-slate-500">· {n.department}</span></span>
                  <span className="flex items-center gap-1.5 text-slate-400"><span className="size-1.5 rounded-full" style={{ background: TOPIC_COLOR[n.topic] }} />{n.weight}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium"><MessageSquarePlus className="size-3.5" />Draft an HR email {replyTo && <span className="text-slate-400">(reply to {replyTo})</span>}</div>
            <textarea value={intent} onChange={(ev) => setIntent(ev.target.value)} placeholder="Intent, e.g. propose a check-in about workload" rows={2} className="w-full resize-none rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-xs outline-none placeholder:text-slate-500 focus:border-indigo-300/50" />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[10px] text-slate-500">Goes to the approval queue, nothing is sent.</span>
              <button onClick={doDraft} disabled={drafting} className="inline-flex items-center gap-1 rounded-lg bg-indigo-500 px-2.5 py-1 text-xs font-medium hover:bg-indigo-400 disabled:opacity-50">{drafting ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}Draft</button>
            </div>
            {error && <div className="mt-1 text-[11px] text-rose-300">{error}</div>}
          </div>

          <div>
            <div className="mb-1.5 text-xs text-slate-400">Interaction timeline ({e.timeline.length})</div>
            <div className="relative space-y-1 border-l border-white/10 pl-3">
              {e.timeline.map((m) => (
                <div key={m.id} className="relative">
                  <span className="absolute -left-[17px] top-2 size-2 rounded-full ring-2 ring-[#0a0d1f]" style={{ background: m.flagged ? '#f43f5e' : TOPIC_COLOR[m.topics[0]?.concept] ?? '#94a3b8' }} />
                  <button onClick={() => setOpen(open === m.id ? null : m.id)} className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-white/5">
                    <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500"><span>{fmt(m.date)} · {m.hr ? 'HR' : m.kind}</span><span>{m.id}</span></div>
                    <div className="truncate text-xs">{m.flagged && <ShieldAlert className="mr-1 inline size-3 text-rose-400" />}{m.subject}</div>
                    <div className="truncate text-[11px] text-slate-400">{m.fromName} → {m.toNames.join(', ')}</div>
                  </button>
                  {open === m.id && (
                    <div className="mx-2 mb-2 rounded-lg bg-black/30 p-2.5 text-xs">
                      {m.flagged ? (
                        <div className="flex gap-1.5 text-rose-300"><AlertTriangle className="size-3.5 shrink-0" />Blocked: {m.flagged}. This content is never sent to the AI.</div>
                      ) : m.body ? (
                        <div className="whitespace-pre-wrap text-slate-300">{m.body}</div>
                      ) : (
                        <div className="text-slate-500">Body hidden for your role.</div>
                      )}
                      <div className="mt-2 flex items-center justify-between">
                        <div className="flex flex-wrap gap-1">{m.topics.map((t) => <TopicChip key={t.concept} {...t} />)}</div>
                        {m.hr && m.from === e.ref && !m.flagged && <button onClick={() => { setReplyTo(m.id); setIntent(`Reply to "${m.subject}"`); }} className="text-[11px] text-indigo-300 hover:underline">Draft reply</button>}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── signals & bridges ─────────────────────────
export function InsightsPanel({ onSignal, onFly, activeId }: { onSignal: (s: Signal) => void; onFly: (ref: string) => void; activeId: string | null }) {
  const [tab, setTab] = useState<'signals' | 'bridges'>('signals');
  const signals = useQuery({ queryKey: ['graph', 'signals'], queryFn: () => graphApi<Signal[]>('/signals') });
  const bridges = useQuery({ queryKey: ['graph', 'bridges'], queryFn: () => graphApi<Bridge[]>('/bridges') });
  return (
    <div className={cn(glass, 'flex max-h-full w-[330px] flex-col overflow-hidden')}>
      <div className="flex gap-1 border-b border-white/10 p-2 pr-8">
        {(['signals', 'bridges'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn('flex-1 rounded-lg px-2 py-1 text-xs capitalize', tab === t ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white')}>{t}{t === 'signals' && signals.data ? ` (${signals.data.length})` : ''}</button>
        ))}
      </div>
      <div className="flex-1 space-y-1.5 overflow-y-auto p-2">
        {tab === 'signals' ? (
          <>
            <div className="px-1 pb-1 text-[10px] text-slate-500">Suggestions only. Each one says why. People decide.</div>
            {signals.data?.map((s) => (
              <button key={s.id} onClick={() => onSignal(s)} className={cn('w-full rounded-xl border px-2.5 py-2 text-left text-xs transition', SEV[s.severity], activeId === s.id && 'ring-1 ring-white/40')}>
                <div className="font-medium">{s.title}</div>
                <div className="mt-0.5 opacity-75">{s.reason}</div>
                <div className="mt-1 text-[10px] opacity-60">{s.refs.length} people{s.evidence.length ? ` · ${s.evidence.length} emails` : ''}</div>
              </button>
            ))}
          </>
        ) : (
          <>
            <div className="px-1 pb-1 text-[10px] text-slate-500">People who connect departments (betweenness centrality on work mail, HR excluded).</div>
            {bridges.data?.map((b, i) => (
              <button key={b.ref} onClick={() => onFly(b.ref)} className="w-full rounded-xl border border-violet-300/20 bg-violet-500/10 px-2.5 py-2 text-left text-xs hover:bg-violet-500/20">
                <div className="flex justify-between"><span className="font-medium">{i + 1}. {b.name}</span><span className="text-violet-200">{Math.round(b.score * 100)}</span></div>
                <div className="text-slate-400">{b.title} · {b.department}</div>
                {b.connects.length > 0 && <div className="mt-0.5 text-[10px] text-violet-200/80">↔ {b.connects.join(', ')}</div>}
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ───────────────────────── approvals ─────────────────────────
export function ApprovalsDrawer({ onClose, nameOf }: { onClose: () => void; nameOf: (ref: string) => string }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['graph', 'actions'], queryFn: () => graphApi<HrAction[]>('/actions') });
  const [edits, setEdits] = useState<Record<string, { subject: string; body: string }>>({});
  const decide = async (a: HrAction, decision: 'approve' | 'reject') => {
    await graphApi(`/actions/${a.id}/${decision}`, edits[a.id] ?? {});
    await qc.invalidateQueries({ queryKey: ['graph'] });
  };
  return (
    <div className={cn(glass, 'flex h-full w-[420px] flex-col overflow-hidden')}>
      <div className="flex items-center justify-between border-b border-white/10 p-4">
        <div><div className="font-semibold">Approval queue</div><div className="text-xs text-slate-400">The agent drafts. A human approves before anything is sent or recorded.</div></div>
        <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-white/10"><X className="size-4" /></button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {!data?.length && <div className="p-6 text-center text-xs text-slate-500">No drafts yet. Open an employee and draft an HR email.</div>}
        {data?.map((a) => {
          const v = edits[a.id] ?? { subject: a.subject, body: a.body };
          return (
            <div key={a.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs">
              <div className="mb-2 flex items-center justify-between"><span className="flex items-center gap-1.5"><Mail className="size-3.5" />To {nameOf(a.ref)}</span><span className={cn('rounded-full px-2 py-0.5 text-[10px]', a.status === 'pending' ? 'bg-amber-400/15 text-amber-200' : a.status === 'approved' ? 'bg-emerald-400/15 text-emerald-200' : 'bg-white/10 text-slate-400')}>{a.status}</span></div>
              {a.status === 'pending' ? (
                <>
                  <input value={v.subject} onChange={(ev) => setEdits({ ...edits, [a.id]: { ...v, subject: ev.target.value } })} className="mb-1.5 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1 outline-none" />
                  <textarea value={v.body} onChange={(ev) => setEdits({ ...edits, [a.id]: { ...v, body: ev.target.value } })} rows={7} className="w-full resize-y rounded-lg border border-white/10 bg-black/30 px-2 py-1 outline-none" />
                  <div className="mt-2 flex justify-end gap-2">
                    <button onClick={() => decide(a, 'reject')} className="rounded-lg border border-white/10 px-2.5 py-1 hover:bg-white/10">Reject</button>
                    <button onClick={() => decide(a, 'approve')} className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-2.5 py-1 font-medium text-emerald-950 hover:bg-emerald-400"><Check className="size-3.5" />Approve & send</button>
                  </div>
                </>
              ) : (
                <><div className="font-medium">{a.subject}</div><div className="mt-1 line-clamp-3 whitespace-pre-wrap text-slate-400">{a.body}</div></>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
