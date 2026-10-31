'use client';

import {
  Building2,
  ChevronDown,
  ChevronUp,
  Crown,
  Download,
  FileText,
  Image as ImageIcon,
  Layers,
  Maximize2,
  Minus,
  Plus,
  Search,
  UserMinus,
  Users,
} from 'lucide-react';
import { toPng } from 'html-to-image';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

export interface OrgChartEmployee {
  id: string;
  reference: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  departmentId: string | null;
  managerId: string | null;
  email: string | null;
  contact: string | null;
  active: boolean;
}

interface TreeNode extends OrgChartEmployee {
  children: TreeNode[];
  depth: number;
}

const ALL = '__all__';
const ZOOM_STEPS = [0.5, 0.65, 0.8, 1, 1.15, 1.3, 1.5];

function initials(e: OrgChartEmployee) {
  return `${e.firstName[0] ?? ''}${e.lastName[0] ?? ''}`.toUpperCase();
}

/** Deterministic hue per department so the same team always shares a colour. */
function hueOf(id: string | null) {
  if (!id) return 250;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

function deptStyle(id: string | null) {
  const h = hueOf(id);
  return {
    '--dept-strong': `oklch(0.55 0.16 ${h})`,
    '--dept-soft': `oklch(0.55 0.16 ${h} / 0.12)`,
    '--dept-ring': `oklch(0.55 0.16 ${h} / 0.35)`,
  } as React.CSSProperties;
}

/* ─────────────────────────── Node card ─────────────────────────── */

function NodeCard({
  node,
  deptName,
  collapsed,
  dimmed,
  highlighted,
  onToggle,
  onSelect,
}: {
  node: TreeNode;
  deptName: (id: string | null) => string;
  collapsed: boolean;
  dimmed: boolean;
  highlighted: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations('hr.orgChart');
  const hasReports = node.children.length > 0;
  const dept = node.departmentId ? deptName(node.departmentId) : null;
  const isRoot = node.depth === 0;

  return (
    <div
      style={deptStyle(node.departmentId)}
      className={cn(
        'group relative w-56 rounded-xl border bg-card text-left shadow-sm transition-all duration-200',
        'hover:-translate-y-0.5 hover:shadow-md hover:border-[var(--dept-ring)]',
        highlighted && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
        dimmed && 'opacity-30 grayscale',
        !node.active && 'border-dashed',
      )}
    >
      {/* department accent bar */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-1 rounded-t-xl"
        style={{ background: 'var(--dept-strong)' }}
      />
      <button
        type="button"
        onClick={() => onSelect(node.id)}
        className="flex w-full flex-col items-center gap-2.5 px-4 pb-4 pt-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-xl"
      >
        <span className="relative">
          <span
            className="flex size-14 items-center justify-center rounded-full text-base font-semibold"
            style={{ background: 'var(--dept-soft)', color: 'var(--dept-strong)' }}
          >
            {initials(node)}
          </span>
          {isRoot && (
            <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
              <Crown className="size-3" />
            </span>
          )}
        </span>
        <span className="flex min-w-0 w-full flex-col items-center">
          <span className="w-full truncate text-sm font-semibold leading-tight text-foreground">
            {node.firstName} {node.lastName}
          </span>
          <span className="mt-1 w-full truncate text-xs leading-tight text-muted-foreground">
            {node.jobTitle ?? '—'}
          </span>
        </span>
        <span className="flex flex-wrap items-center justify-center gap-1">
          {dept && (
            <span
              className="max-w-[11rem] truncate rounded-md px-1.5 py-0.5 text-[10px] font-medium"
              style={{ background: 'var(--dept-soft)', color: 'var(--dept-strong)' }}
            >
              {dept}
            </span>
          )}
          {!node.active && (
            <Badge variant="outline" className="h-[18px] px-1.5 text-[10px] text-muted-foreground">
              {t('inactive')}
            </Badge>
          )}
        </span>
      </button>

      {hasReports && (
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            'flex w-full items-center justify-center gap-1.5 border-t px-3 py-1.5 text-[11px] font-medium transition-colors rounded-b-xl',
            collapsed
              ? 'bg-primary/5 text-primary hover:bg-primary/10'
              : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
          )}
        >
          <Users className="size-3" />
          {t('reports', { count: node.children.length })}
          {collapsed ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />}
        </button>
      )}
    </div>
  );
}

/* ─────────────────────────── Tree recursion ─────────────────────────── */

interface RenderCtx {
  deptName: (id: string | null) => string;
  collapsedSet: Set<string>;
  toggle: (id: string) => void;
  onSelect: (id: string) => void;
  matches: Set<string> | null; // null = no filter active
}

function TreeItem({ node, ctx }: { node: TreeNode; ctx: RenderCtx }) {
  const collapsed = ctx.collapsedSet.has(node.id) && !ctx.matches;
  const isMatch = ctx.matches?.has(node.id) ?? false;
  return (
    <li>
      <NodeCard
        node={node}
        deptName={ctx.deptName}
        collapsed={collapsed}
        dimmed={ctx.matches !== null && !isMatch}
        highlighted={isMatch}
        onToggle={() => ctx.toggle(node.id)}
        onSelect={ctx.onSelect}
      />
      {node.children.length > 0 && !collapsed && (
        <ul>
          {node.children.map((c) => (
            <TreeItem key={c.id} node={c} ctx={ctx} />
          ))}
        </ul>
      )}
    </li>
  );
}

function Stat({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: number }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Icon className="size-3.5" />
      <span className="font-semibold tabular-nums text-foreground">{value}</span>
      {label}
    </span>
  );
}

/* ─────────────────────────── Main component ─────────────────────────── */

/** Canvas size browsers reliably render (Safari caps a canvas around 16 384 px a side). */
const MAX_EXPORT_PX = 16_000;

/** PNG data URL of the rendered tree, on the page background (connector lines included). */
async function renderTree(node: HTMLElement): Promise<string> {
  const bg = getComputedStyle(document.body).backgroundColor || '#ffffff';
  const pad = 32;
  // the canvas must include the padding added to the clone, or the right/bottom edges get cut
  const width = node.scrollWidth + pad * 2;
  const height = node.scrollHeight + pad * 2;
  const pixelRatio = Math.max(0.5, Math.min(2, MAX_EXPORT_PX / Math.max(width, height)));
  return toPng(node, {
    backgroundColor: bg,
    pixelRatio,
    cacheBust: true,
    width,
    height,
    style: { padding: `${pad}px`, margin: '0', width: `${width}px`, height: `${height}px`, boxSizing: 'border-box' },
  });
}

/** A print window holding the image on a landscape page (« Enregistrer au format PDF »). */
function printImage(dataUrl: string, title: string, subtitle: string) {
  const win = window.open('', '_blank', 'width=1200,height=900');
  if (!win) return false;
  const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  win.document.open();
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>@page{size:A4 landscape;margin:12mm}html,body{margin:0;font-family:system-ui,sans-serif;color:#111}
header{display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid #ddd;padding-bottom:6px;margin-bottom:10px}
h1{font-size:16px;margin:0}small{color:#666;font-size:11px}
img{display:block;max-width:100%;max-height:calc(100vh - 60px);margin:0 auto;object-fit:contain}</style></head>
<body><header><h1>${esc(title)}</h1><small>${esc(subtitle)}</small></header><img src="${dataUrl}" alt=""></body></html>`);
  win.document.close();
  win.focus();
  const img = win.document.querySelector('img');
  const go = () => setTimeout(() => win.print(), 200);
  if (img && !img.complete) img.onload = go;
  else go();
  return true;
}

export function OrgChart({
  employees,
  deptName,
  departments,
  onSelect,
}: {
  employees: OrgChartEmployee[];
  deptName: (id: string | null) => string;
  departments: { id: string; name: string }[];
  onSelect: (id: string) => void;
}) {
  const t = useTranslations('hr.orgChart');
  const [collapsedSet, setCollapsedSet] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [dept, setDept] = useState<string>(ALL);
  const [zoomIdx, setZoomIdx] = useState(3);
  const zoom = ZOOM_STEPS[zoomIdx] ?? 1;

  const { trees, isolated, byId, maxDepth, managers } = useMemo(() => {
    const byId = new Map<string, TreeNode>();
    for (const e of employees) byId.set(e.id, { ...e, children: [], depth: 0 });
    const roots: TreeNode[] = [];
    for (const node of byId.values()) {
      const parent = node.managerId ? byId.get(node.managerId) : null;
      if (parent && parent.id !== node.id) parent.children.push(node);
      else roots.push(node);
    }
    let maxDepth = 0;
    let managers = 0;
    const walk = (n: TreeNode, depth: number) => {
      n.depth = depth;
      maxDepth = Math.max(maxDepth, depth);
      if (n.children.length) managers++;
      n.children.sort((a, b) => a.lastName.localeCompare(b.lastName));
      n.children.forEach((c) => walk(c, depth + 1));
    };
    roots.sort((a, b) => b.children.length - a.children.length || a.lastName.localeCompare(b.lastName));
    roots.forEach((r) => walk(r, 0));
    const trees = roots.filter((r) => r.children.length > 0);
    // employees with no manager AND no reports are shown apart (unless nobody has a tree)
    const isolated = trees.length ? roots.filter((r) => r.children.length === 0) : [];
    return { trees: trees.length ? trees : roots, isolated, byId, maxDepth, managers };
  }, [employees]);

  const matches = useMemo<Set<string> | null>(() => {
    const q = query.trim().toLowerCase();
    if (!q && dept === ALL) return null;
    const set = new Set<string>();
    for (const e of byId.values()) {
      const okDept = dept === ALL || e.departmentId === dept;
      const okQ =
        !q ||
        `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) ||
        (e.jobTitle ?? '').toLowerCase().includes(q) ||
        e.reference.toLowerCase().includes(q);
      if (okDept && okQ) set.add(e.id);
    }
    return set;
  }, [query, dept, byId]);

  const toggle = useCallback(
    (id: string) =>
      setCollapsedSet((s) => {
        const next = new Set(s);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );
  const expandAll = () => setCollapsedSet(new Set());
  const collapseAll = () =>
    setCollapsedSet(new Set([...byId.values()].filter((n) => n.depth >= 1 && n.children.length > 0).map((n) => n.id)));

  /* drag-to-pan on the canvas */
  const scrollRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  const onMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const el = scrollRef.current;
    if (!el) return;
    drag.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop };
    el.classList.add('cursor-grabbing');
  };
  const onMouseMove = (e: React.MouseEvent) => {
    const el = scrollRef.current;
    if (!drag.current || !el) return;
    el.scrollLeft = drag.current.sl - (e.clientX - drag.current.x);
    el.scrollTop = drag.current.st - (e.clientY - drag.current.y);
  };
  const endDrag = () => {
    drag.current = null;
    scrollRef.current?.classList.remove('cursor-grabbing');
  };

  const treeRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const exportAs = async (format: 'png' | 'pdf') => {
    if (!treeRef.current || exporting) return;
    setExporting(true);
    try {
      const dataUrl = await renderTree(treeRef.current);
      const date = new Date().toLocaleDateString();
      if (format === 'png') {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `${t('exportFileName')}-${new Date().toISOString().slice(0, 10)}.png`;
        a.click();
      } else if (!printImage(dataUrl, t('title'), t('exportSubtitle', { date, count: employees.length }))) {
        toast.error(t('exportPopupBlocked'));
      }
    } catch {
      toast.error(t('exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  const ctx: RenderCtx = { deptName, collapsedSet, toggle, onSelect, matches };
  const filterActive = matches !== null;

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-xl border bg-card">
        {/* stats strip */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b px-4 py-2">
          <Stat icon={Users} label={t('stats.total')} value={employees.length} />
          <Stat icon={Crown} label={t('stats.managers')} value={managers} />
          <Stat icon={Layers} label={t('stats.levels')} value={maxDepth + 1} />
          <Stat icon={UserMinus} label={t('stats.unassigned')} value={isolated.length} />
        </div>
        {/* toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2">
          <div className="relative w-full sm:w-60">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('search')}
              className="h-8 bg-background pl-8"
            />
          </div>
          <Select value={dept} onValueChange={setDept}>
            <SelectTrigger size="sm" className="w-full bg-background sm:w-52">
              <Building2 className="size-3.5 text-muted-foreground" />
              <SelectValue placeholder={t('allDepartments')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('allDepartments')}</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {filterActive && (
            <Badge variant="secondary" className="tabular-nums">
              {t('results', { count: matches?.size ?? 0 })}
            </Badge>
          )}

          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={expandAll}>
              <ChevronDown className="size-3.5" /> {t('expandAll')}
            </Button>
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={collapseAll}>
              <ChevronUp className="size-3.5" /> {t('collapseAll')}
            </Button>
            <span className="mx-1 h-5 w-px bg-border" />
            <div className="flex items-center rounded-md border bg-background">
              <Button
                variant="ghost"
                size="icon"
                className="size-8 rounded-r-none"
                onClick={() => setZoomIdx((i) => Math.max(0, i - 1))}
                disabled={zoomIdx === 0}
                aria-label={t('zoomOut')}
              >
                <Minus className="size-3.5" />
              </Button>
              <button
                type="button"
                onClick={() => setZoomIdx(3)}
                className="w-12 border-x text-center text-xs tabular-nums text-muted-foreground hover:text-foreground"
                title={t('resetZoom')}
              >
                {Math.round(zoom * 100)}%
              </button>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 rounded-l-none"
                onClick={() => setZoomIdx((i) => Math.min(ZOOM_STEPS.length - 1, i + 1))}
                disabled={zoomIdx === ZOOM_STEPS.length - 1}
                aria-label={t('zoomIn')}
              >
                <Plus className="size-3.5" />
              </Button>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 text-xs" disabled={exporting} title={t('exportHint')}>
                  <Download className="size-3.5" /> {exporting ? t('exporting') : t('export')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => exportAs('png')}><ImageIcon className="size-4" /> {t('exportPng')}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportAs('pdf')}><FileText className="size-4" /> {t('exportPdf')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => {
                setZoomIdx(3);
                scrollRef.current?.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
              }}
              aria-label={t('resetView')}
            >
              <Maximize2 className="size-3.5" />
            </Button>
          </div>
        </div>

        {/* canvas + unassigned side panel */}
        <div className="flex h-[calc(100vh-19rem)] min-h-[32rem]">
          <div
            ref={scrollRef}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={endDrag}
            onMouseLeave={endDrag}
            className="org-canvas relative min-w-0 flex-1 cursor-grab select-none overflow-auto"
          >
            <div
              className="inline-flex min-w-full origin-top justify-center px-16 pb-16 pt-12 transition-transform duration-200"
              style={{ transform: `scale(${zoom})` }}
            >
              <div ref={treeRef} className="flex items-start gap-24">
                {trees.map((r) => (
                  <div key={r.id} className="org-tree">
                    <ul>
                      <TreeItem node={r} ctx={ctx} />
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {isolated.length > 0 && (
            <aside className="flex w-72 shrink-0 flex-col border-l bg-muted/20">
              <div className="border-b px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <UserMinus className="size-4 text-muted-foreground" />
                  {t('unassignedTitle')}
                  <Badge variant="secondary" className="ml-auto tabular-nums">{isolated.length}</Badge>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t('unassignedDesc')}</p>
              </div>
              <ul className="flex-1 space-y-1.5 overflow-auto p-3">
                {isolated.map((n) => {
                  const d = n.departmentId ? deptName(n.departmentId) : null;
                  const dim = filterActive && !matches!.has(n.id);
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(n.id)}
                        style={deptStyle(n.departmentId)}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-lg border bg-card px-3 py-2 text-left transition-colors hover:border-[var(--dept-ring)] hover:bg-accent/40',
                          dim && 'opacity-30 grayscale',
                          !n.active && 'border-dashed',
                        )}
                      >
                        <span
                          className="flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                          style={{ background: 'var(--dept-soft)', color: 'var(--dept-strong)' }}
                        >
                          {initials(n)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {n.firstName} {n.lastName}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {[n.jobTitle, d].filter(Boolean).join(' · ') || '—'}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </aside>
          )}
        </div>

        {/* legend */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-3 py-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Crown className="size-2.5" />
            </span>
            {t('legend.root')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="flex h-4 items-center gap-0.5 rounded border bg-card px-1.5 text-[9px]">
              <Users className="size-2.5" /> n <ChevronUp className="size-2.5" />
            </span>
            {t('legend.reports')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded-full border border-dashed" />
            {t('legend.inactive')}
          </span>
          <span className="ml-auto">{t('legend.hint')}</span>
        </div>
      </div>
    </div>
  );
}
