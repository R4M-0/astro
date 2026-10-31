'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, GitBranch, Home, Inbox, MailPlus, Loader2, Pause, Play, Search, Send, ShieldAlert, Sparkles, Users, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { graphApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { GalaxyCanvas, type GalaxyHandle } from './galaxy-canvas';
import { ComposeMail, MailToasts, useLiveMail, type MailEvent } from './live-mail';
import { ApprovalsDrawer, EmployeePanel, InsightsPanel, TopicChip, glass } from './panels';
import { TOPIC_COLOR, type AskResult, type GEdge, type GNode, type GalaxyData, type Lens, type Signal } from './types';

const LENSES: { key: Lens; label: string }[] = [
  { key: 'department', label: 'Departments' },
  { key: 'manager', label: 'Reporting lines' },
  { key: 'topic', label: 'Topics' },
  { key: 'location', label: 'Locations' },
];
const LOC_COLOR: Record<string, string> = { Lyon: '#5b8cff', Paris: '#ff6fa8', Remote: '#2fd6c3' };
const refOf = (x: string | GNode) => (typeof x === 'string' ? x : x.ref);
const hexA = (hex: string, a: number) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;
const monthLabel = (m: string) => new Date(m + '-01').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });

function useSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ width: 800, height: 600 });
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setSize({ width: e.contentRect.width, height: e.contentRect.height }));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

export function GalaxyView() {
  const wrap = useRef<HTMLDivElement>(null);
  const size = useSize(wrap);
  const fg = useRef<GalaxyHandle>(null);
  const { data, isLoading, error } = useQuery({ queryKey: ['graph', 'galaxy'], queryFn: () => graphApi<GalaxyData>('/galaxy'), staleTime: 60_000 });

  const [lens, setLens] = useState<Lens>('department');
  const [selected, setSelected] = useState<string | null>(null);
  const [group, setGroup] = useState<Set<string>>(new Set());
  const [highlight, setHighlight] = useState<{ refs: Set<string>; label: string; id?: string } | null>(null);
  const [showBridges, setShowBridges] = useState(false);
  const [showApprovals, setShowApprovals] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1400);
  const [month, setMonth] = useState<number | null>(null); // null = all time
  const [playing, setPlaying] = useState(false);

  // stable graph data: force-graph mutates nodes (x/y/z), so build it once per payload
  const graph = useMemo(() => {
    if (!data) return null;
    const nodes = data.nodes.map((n) => ({ ...n }));
    const mail = data.edges.map((e) => ({ ...e }));
    const known = new Set(nodes.map((n) => n.ref));
    const tree: GEdge[] = nodes.filter((n) => n.managerRef && known.has(n.managerRef)).map((n) => ({ source: n.managerRef!, target: n.ref, weight: 1, months: {}, topic: 'project_collab', hr: false, tree: true }));
    return { nodes, links: [...mail, ...tree], byRef: new Map(nodes.map((n) => [n.ref, n])) };
  }, [data]);

  // ── live mail: new beams are added in place (same node objects, so the layout doesn't jump) ──
  const qc = useQueryClient();
  const [linksVersion, setLinksVersion] = useState(0);
  const links = useMemo(() => (graph ? [...graph.links] : []), [graph, linksVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const [toasts, setToasts] = useState<MailEvent[]>([]);
  const [composing, setComposing] = useState(false);
  useLiveMail((e) => {
    if (!graph) return;
    const month = e.at.slice(0, 7);
    for (const t of e.to) {
      const l = graph.links.find((x) => !x.tree && ((refOf(x.source) === e.from && refOf(x.target) === t) || (refOf(x.source) === t && refOf(x.target) === e.from)));
      if (l) { l.weight++; l.months[month] = (l.months[month] ?? 0) + 1; l.hr ||= e.kind.startsWith('hr'); }
      else graph.links.push({ source: e.from, target: t, weight: 2, months: { [month]: 1 }, topic: e.topics[0]?.concept ?? 'project_collab', hr: e.kind.startsWith('hr') });
    }
    setLinksVersion((v) => v + 1);
    setToasts((ts) => [e, ...ts].slice(0, 3));
    setHighlight({ refs: new Set([e.from, ...e.to]), label: `New mail: ${e.subject}` });
    void qc.invalidateQueries({ queryKey: ['graph', 'signals'] });
    void qc.invalidateQueries({ queryKey: ['graph', 'employee'] });
  });
  const deptColor = useMemo(() => new Map(data?.departments.map((d) => [d.name, d.color])), [data]);
  const bridgeSet = useMemo(() => new Set(showBridges && graph ? [...graph.nodes].sort((a, b) => b.bridge - a.bridge).slice(0, 10).map((n) => n.ref) : []), [showBridges, graph]);

  // ── lenses ──
  const headOf = useCallback((n: GNode): string => {
    // reporting-line lens: cluster under the department head (the CEO's direct report)
    let cur: GNode | undefined = n;
    for (let i = 0; i < 6 && cur?.managerRef; i++) {
      const m: GNode | undefined = graph?.byRef.get(cur.managerRef);
      if (!m || !m.managerRef) break;
      cur = m;
    }
    return cur ? cur.name : n.name;
  }, [graph]);
  const clusterOf = useCallback((n: GNode) => {
    if (lens === 'topic') return data?.concepts.find((c) => c.key === n.topic)?.label ?? n.topic;
    if (lens === 'location') return n.location;
    if (lens === 'manager') return headOf(n);
    return n.department;
  }, [lens, data, headOf]);
  const colorOf = useCallback((n: GNode) => {
    if (lens === 'topic') return TOPIC_COLOR[n.topic] ?? '#fff';
    if (lens === 'location') return LOC_COLOR[n.location] ?? '#ffe066';
    return deptColor.get(n.department) ?? '#fff';
  }, [lens, deptColor]);
  const clusterColor = useCallback((k: string) => {
    if (lens === 'topic') return TOPIC_COLOR[data?.concepts.find((c) => c.label === k)?.key ?? ''] ?? '#fff';
    if (lens === 'location') return LOC_COLOR[k] ?? '#ffe066';
    if (lens === 'manager') { const h = graph?.nodes.find((n) => n.name === k); return h ? deptColor.get(h.department) ?? '#fff' : '#fff'; }
    return deptColor.get(k) ?? '#fff';
  }, [lens, data, deptColor, graph]);

  // ── timeline ──
  const months = data?.months ?? [];
  const cur = month === null ? null : months[month];
  const nodeVisible = useCallback((n: GNode) => {
    if (!cur) return true;
    const end = cur + '-31';
    return (!n.hireDate || n.hireDate <= end) && (!n.exitDate || n.exitDate.slice(0, 7) >= cur);
  }, [cur]);
  const window3 = useMemo(() => (month === null ? null : new Set(months.slice(Math.max(0, month - 2), month + 1))), [month, months]);
  const linkVisible = useCallback((l: GEdge) => {
    if (lens === 'manager') return !!l.tree;
    // topic / location lenses: the clusters are the message, beams only around the selected star
    if (lens === 'topic' || lens === 'location') return false;
    if (l.tree) return false;
    if (!window3) return true;
    return Object.keys(l.months).some((m) => window3.has(m));
  }, [lens, window3]);
  // rgba alpha multiplies linkOpacity: HR beams stay faint (everyone is linked to HR), work beams a bit brighter
  const linkColor = useCallback((l: GEdge) => (l.tree ? 'rgba(142,162,255,0.7)' : l.hr ? 'rgba(255,209,102,0.09)' : hexA(TOPIC_COLOR[l.topic] ?? '#8ea2ff', 0.45)), []);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setMonth((m) => {
      const next = (m ?? -1) + 1;
      if (next >= months.length) { setPlaying(false); return null; }
      return next;
    }), 900);
    return () => clearInterval(t);
  }, [playing, months.length]);
  const hiresThisMonth = useMemo(() => (cur && graph ? graph.nodes.filter((n) => n.hireDate?.startsWith(cur)).length : 0), [cur, graph]);

  // ── interactions ──
  const fly = useCallback((ref: string) => { setSelected(ref); fg.current?.flyTo(ref); }, []);
  const toggleGroup = useCallback((ref: string) => setGroup((g) => { const s = new Set(g); if (s.has(ref)) s.delete(ref); else s.add(ref); return s; }), []);
  const onNodeClick = useCallback((n: GNode, additive: boolean) => {
    if (additive) toggleGroup(n.ref);
    else fly(n.ref);
  }, [fly, toggleGroup]);
  const onSignal = (s: Signal) => {
    if (highlight?.id === s.id) return setHighlight(null);
    setHighlight({ refs: new Set(s.refs), label: s.title, id: s.id });
    if (s.refs.length === 1) fly(s.refs[0]);
  };

  // ── search-to-fly ──
  const [q, setQ] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => {
    if (!q.trim() || !graph) return [];
    const s = q.toLowerCase();
    return graph.nodes.filter((n) => n.name.toLowerCase().includes(s) || n.ref.toLowerCase().includes(s) || (n.title ?? '').toLowerCase().includes(s)).slice(0, 7);
  }, [q, graph]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === 'Escape') { setSelected(null); setHighlight(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── ask ──
  const [question, setQuestion] = useState('');
  const [scope, setScope] = useState<{ kind: 'company' } | { kind: 'department'; name: string } | { kind: 'refs'; refs: string[]; label: string }>({ kind: 'company' });
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<AskResult | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  useEffect(() => { if (group.size) setScope({ kind: 'refs', refs: [...group], label: `${group.size} selected` }); }, [group]);
  const askAbout = (ref: string) => { setScope({ kind: 'refs', refs: [ref], label: graph?.byRef.get(ref)?.name ?? ref }); document.getElementById('galaxy-ask')?.focus(); };
  const submit = async () => {
    if (!question.trim() || asking) return;
    setAsking(true);
    setAskError(null);
    try {
      const body = { question, ...(scope.kind === 'department' ? { department: scope.name } : scope.kind === 'refs' ? { refs: scope.refs } : {}) };
      const r = await graphApi<AskResult>('/ask', body);
      setAnswer(r);
      setHighlight({ refs: new Set(r.highlight), label: 'Answer' });
      if (r.highlight.length === 1) fly(r.highlight[0]);
    } catch (e) {
      setAskError((e as Error).message);
    } finally {
      setAsking(false);
    }
  };
  const lit = useMemo(() => new Set([...(highlight?.refs ?? []), ...bridgeSet]), [highlight, bridgeSet]);
  const nameOf = useCallback((r: string) => graph?.byRef.get(r)?.name ?? r, [graph]);

  const renderAnswer = (text: string) =>
    // citations come as [m00123] or lists like [m00123, m00456]
    text.split(/(\[m\d{5}(?:,\s*m\d{5})*\]|\[policy:[^\]]+\])/g).map((part, i) => {
      if (/^\[m\d{5}/.test(part)) {
        return part.match(/m\d{5}/g)!.map((id) => {
          const c = answer?.citations.find((x) => x.id === id);
          return <button key={`${i}-${id}`} title={c ? `${c.subject} — ${c.fromName}` : id} onClick={() => c && fly(c.from)} className="mx-0.5 rounded bg-indigo-400/20 px-1 text-[10px] text-indigo-200 hover:bg-indigo-400/40">{id}</button>;
        });
      }
      const p = part.match(/^\[policy:([^\]]+)\]$/);
      if (p) return <span key={i} className="mx-0.5 rounded bg-emerald-400/15 px-1 text-[10px] text-emerald-200">📘 {p[1]}</span>;
      return <span key={i}>{part}</span>;
    });

  if (error) return <div className="flex h-full items-center justify-center bg-[#03040b] p-6 text-sm text-slate-300">Galaxy service unavailable: {(error as Error).message}. Is apps/graph running on :3012?</div>;

  return (
    // overflow-clip (not hidden): focusing an input must never scroll the canvas sideways
    <div ref={wrap} className="relative h-full w-full overflow-clip bg-[#03040b]">
      {graph && (
        <GalaxyCanvas
          ref={fg}
          nodes={graph.nodes}
          links={links}
          clusterOf={clusterOf}
          clusterColor={clusterColor}
          colorOf={colorOf}
          nodeVisible={nodeVisible}
          linkVisible={linkVisible}
          linkColor={linkColor}
          highlight={lit}
          group={group}
          selected={selected}
          bridges={bridgeSet}
          width={size.width}
          height={size.height}
          onNodeClick={onNodeClick}
          onBackgroundClick={() => setSelected(null)}
        />
      )}
      {isLoading && <div className="absolute inset-0 flex items-center justify-center text-slate-400"><Loader2 className="mr-2 size-5 animate-spin" />Mapping the workforce…</div>}

      {/* top toolbar */}
      <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-start justify-between gap-2">
        <div className="pointer-events-auto flex items-center gap-2">
          <div className={cn(glass, 'relative w-56 2xl:w-72')}>
            <div className="flex items-center gap-2 px-3 py-2">
              <Search className="size-4 text-slate-400" />
              <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && matches[0]) { fly(matches[0].ref); setQ(''); } }} placeholder="Fly to an employee…  ( / )" className="w-full bg-transparent text-sm outline-none placeholder:text-slate-500" />
            </div>
            {matches.length > 0 && (
              <div className="absolute inset-x-0 top-full mt-1 overflow-hidden rounded-xl border border-white/10 bg-[#0a0d1f]/95">
                {matches.map((n) => (
                  <button key={n.ref} onClick={() => { fly(n.ref); setQ(''); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-white/10">
                    <span className="size-2 rounded-full" style={{ background: deptColor.get(n.department) }} />
                    <span className="truncate">{n.name}</span><span className="ml-auto truncate text-slate-500">{n.department}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className={cn(glass, 'flex gap-0.5 p-1')}>
            {LENSES.map((l) => (
              <button key={l.key} onClick={() => setLens(l.key)} className={cn('rounded-lg px-2.5 py-1 text-xs', lens === l.key ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-white')}>{l.label}</button>
            ))}
          </div>
          <button title="Bridges" onClick={() => setShowBridges((b) => !b)} className={cn(glass, 'flex items-center gap-1.5 px-3 py-2 text-xs', showBridges && 'border-violet-300/40 text-violet-200')}><GitBranch className="size-3.5" /><span className="hidden 2xl:inline">Bridges</span></button>
          <button onClick={() => { fg.current?.home(); setSelected(null); }} className={cn(glass, 'p-2')} title="Home"><Home className="size-4" /></button>
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          <button title="Send a company email" onClick={() => setComposing((v) => !v)} className={cn(glass, 'flex items-center gap-1.5 px-3 py-2 text-xs', composing && 'border-indigo-300/40')}><MailPlus className="size-3.5" /><span className="hidden 2xl:inline">Send mail</span></button>
          <button title="Approval queue" onClick={() => setShowApprovals((v) => !v)} className={cn(glass, 'flex items-center gap-1.5 px-3 py-2 text-xs')}><Inbox className="size-3.5" /><span className="hidden 2xl:inline">Approvals</span></button>
        </div>
      </div>

      {/* status chips: what is lit up and who is in the group (own row, centered, so the toolbar never wraps) */}
      <div className="pointer-events-none absolute left-1/2 top-16 z-10 flex -translate-x-1/2 items-center gap-2">
        {highlight && (
          <div className={cn(glass, 'pointer-events-auto flex items-center gap-2 px-3 py-1.5 text-xs')}>
            <span className="size-2 animate-pulse rounded-full bg-amber-300" /><span className="max-w-64 truncate">{highlight.label}</span><span className="text-slate-500">{highlight.refs.size}</span>
            <button onClick={() => setHighlight(null)}><X className="size-3.5 text-slate-400" /></button>
          </div>
        )}
        {group.size > 0 && (
          <div className={cn(glass, 'pointer-events-auto flex items-center gap-2 px-3 py-1.5 text-xs')}><Users className="size-3.5 text-amber-300" />{group.size} selected<button onClick={() => { setGroup(new Set()); setScope({ kind: 'company' }); }}><X className="size-3.5 text-slate-400" /></button></div>
        )}
      </div>

      {/* left: signals & bridges */}
      <div className="pointer-events-auto absolute bottom-40 left-3 top-16 flex">
        {insightsOpen ? (
          <div className="relative flex">
            <InsightsPanel onSignal={onSignal} onFly={fly} activeId={highlight?.id ?? null} />
            <button onClick={() => setInsightsOpen(false)} className="absolute right-2 top-2.5 rounded-md p-0.5 text-slate-400 hover:bg-white/10 hover:text-white" title="Hide"><X className="size-3.5" /></button>
          </div>
        ) : (
          <button onClick={() => setInsightsOpen(true)} className={cn(glass, 'flex h-fit items-center gap-1.5 px-3 py-2 text-xs')}><Activity className="size-3.5 text-amber-300" />Signals & bridges</button>
        )}
      </div>

      {/* right: employee file / approvals */}
      <div className="absolute bottom-40 right-3 top-16 flex gap-2">
        {showApprovals && <ApprovalsDrawer onClose={() => setShowApprovals(false)} nameOf={nameOf} />}
        {selected && !showApprovals && <EmployeePanel key={selected} refId={selected} onClose={() => setSelected(null)} onFly={fly} onAsk={askAbout} onDrafted={() => setShowApprovals(true)} inGroup={group.has(selected)} onToggleGroup={toggleGroup} />}
      </div>

      {/* answer card */}
      {answer && (
        <div
          className={cn(
            glass,
            'absolute bottom-40 max-h-[46%] overflow-y-auto p-4 text-sm',
            // with a panel open on the right, dock the answer on the left so they never overlap
            selected || showApprovals ? 'left-3 w-[min(560px,calc(100%-450px))] min-w-[300px]' : 'left-1/2 w-[min(640px,calc(100%-24px))] -translate-x-1/2',
          )}
        >
          <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
            <span className="flex items-center gap-1.5"><Sparkles className="size-3.5 text-indigo-300" />Answer · {answer.scope}</span>
            <button onClick={() => { setAnswer(null); setHighlight(null); }}><X className="size-3.5" /></button>
          </div>
          <div className="whitespace-pre-wrap leading-relaxed">{renderAnswer(answer.answer)}</div>
          {answer.flaggedWithheld > 0 && <div className="mt-2 flex items-center gap-1.5 text-[11px] text-rose-300"><ShieldAlert className="size-3.5" />{answer.flaggedWithheld} email(s) withheld from the AI: prompt-injection attempt detected.</div>}
          {answer.employees.length > 0 && (
            <div className="mt-3 border-t border-white/10 pt-3">
              <div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-400"><span>Why these people matched</span><span className="rounded-full bg-white/5 px-2 py-0.5">explained by {answer.employees[0].explainedBy === 'xqdrant' ? 'XQdrant dims_explained' : 'concept vectors'}</span></div>
              <div className="space-y-1.5">
                {answer.employees.slice(0, 6).map((e) => {
                  const total = e.reasons.reduce((s, r) => s + r.contribution, 0) || 1;
                  return (
                    <button key={e.ref} onClick={() => fly(e.ref)} className="block w-full rounded-lg px-2 py-1 text-left hover:bg-white/5">
                      <div className="flex justify-between text-xs"><span>{e.name} <span className="text-slate-500">· {e.department}</span></span><span className="text-slate-500">{e.evidence.length} emails</span></div>
                      <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-white/5">{e.reasons.map((r) => <div key={r.concept} style={{ width: `${(r.contribution / total) * 100}%`, background: TOPIC_COLOR[r.concept] }} title={`${r.label} +${r.contribution}`} />)}</div>
                      <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-slate-400">{e.reasons.map((r) => <span key={r.concept}>{r.label} +{r.contribution.toFixed(2)}</span>)}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {answer.queryConcepts.length > 0 && <div className="mt-2 flex flex-wrap items-center gap-1 text-[10px] text-slate-500">Question understood as {answer.queryConcepts.slice(0, 4).map((c) => <TopicChip key={c.concept} concept={c.concept} label={c.label} />)}</div>}
        </div>
      )}

      {/* live mail: composer + incoming toasts (above the right panels) */}
      <div className="pointer-events-none absolute right-3 top-16 z-20 flex flex-col items-end gap-2">
        {composing && graph && <ComposeMail nodes={graph.nodes} onClose={() => setComposing(false)} />}
        <MailToasts items={toasts} nameOf={nameOf} onOpen={(e) => { fly(e.from); setToasts((ts) => ts.filter((x) => x.seq !== e.seq)); }} onDismiss={(s) => setToasts((ts) => ts.filter((x) => x.seq !== s))} />
      </div>

      {/* bottom: ask + timeline */}
      <div className="absolute inset-x-3 bottom-3 flex flex-col items-center gap-2">
        <div className={cn(glass, 'flex w-[min(760px,100%)] items-center gap-2 p-2')}>
          <select
            value={scope.kind === 'department' ? 'd:' + scope.name : scope.kind}
            onChange={(e) => { const v = e.target.value; if (v === 'company') setScope({ kind: 'company' }); else if (v.startsWith('d:')) setScope({ kind: 'department', name: v.slice(2) }); }}
            className="max-w-44 rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs outline-none"
          >
            <option value="company">Whole company</option>
            {scope.kind === 'refs' && <option value="refs">{scope.label}</option>}
            {data?.departments.map((d) => <option key={d.name} value={'d:' + d.name}>{d.name}</option>)}
          </select>
          <input id="galaxy-ask" value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder="Ask the galaxy… e.g. Who raised workload concerns in Production recently?" className="flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-slate-500" maxLength={1000} />
          <button onClick={submit} disabled={asking} className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-500 px-3 py-1.5 text-xs font-medium hover:bg-indigo-400 disabled:opacity-50">{asking ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}Ask</button>
        </div>
        {askError && <div className="text-xs text-rose-300">{askError}</div>}
        <div className={cn(glass, 'flex w-[min(760px,100%)] items-center gap-3 px-3 py-2')}>
          <button onClick={() => { if (!playing && month === null) setMonth(0); setPlaying((p) => !p); }} className="rounded-lg bg-white/10 p-1.5 hover:bg-white/20">{playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}</button>
          <input type="range" min={0} max={months.length} value={month ?? months.length} onChange={(e) => { const v = Number(e.target.value); setMonth(v >= months.length ? null : v); setPlaying(false); }} className="flex-1 accent-indigo-400" />
          <div className="w-36 text-right text-xs">
            {cur ? <><span className="font-medium">{monthLabel(cur)}</span><span className="text-slate-500"> · {hiresThisMonth} joined</span></> : <span className="text-slate-400">All time · {graph?.nodes.length ?? 0} people</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
