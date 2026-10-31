'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  ArrowRightLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  PencilLine,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { Fragment, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { format, formatDistanceToNow, isToday, isYesterday } from 'date-fns';
import { enUS, fr as frLocale } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { apiGet } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useMembers } from '@/components/hr/use-members';

/** A display value: text, or a date formatted in the viewer's own time zone. */
type Val = { t: string } | { d: string; time: boolean };

type Category = 'create' | 'update' | 'delete' | 'workflow' | 'export' | 'other';

interface AuditEntry {
  id: string;
  createdAt: string;
  actorId: string | null;
  actorName: string | null;
  viaSupport?: boolean;
  category: Category;
  summary: string;
  details: { label: string; value: Val }[];
  changes: { label: string; from: Val; to: Val }[];
  related: string[];
  technical: { method: string; route: string; ip: string | null; device: string | null };
}

const PAGE_SIZE = 25;
const ALL = '__all';

const CATEGORY_META: Record<Category, { icon: typeof Plus; cls: string }> = {
  create: { icon: Plus, cls: 'bg-success/15 text-success' },
  update: { icon: PencilLine, cls: 'bg-info/15 text-info' },
  delete: { icon: Trash2, cls: 'bg-destructive/15 text-destructive' },
  workflow: { icon: ArrowRightLeft, cls: 'bg-chart-4/15 text-chart-4' },
  export: { icon: Download, cls: 'bg-warning/20 text-warning-foreground dark:text-warning' },
  other: { icon: Activity, cls: 'bg-muted text-muted-foreground' },
};

const LOCAL_IPS = new Set(['::1', '127.0.0.1', '::ffff:127.0.0.1']);

export function AdminAudit() {
  const t = useTranslations('admin.audit');
  const locale = useLocale();
  const dateLocale = locale === 'fr' ? frLocale : enUS;
  const { members } = useMembers();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [actorId, setActorId] = useState(ALL);
  const [category, setCategory] = useState(ALL);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), locale });
  if (search) params.set('search', search);
  if (actorId !== ALL) params.set('actorId', actorId);
  if (category !== ALL) params.set('category', category);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'audit', params.toString()],
    queryFn: () => apiGet<{ data: AuditEntry[]; meta: { total: number; totalPages: number } }>(`/audit-log?${params.toString()}`),
  });

  const rows = data?.data ?? [];
  const totalPages = data?.meta.totalPages ?? 1;

  const withTime = locale === 'fr' ? "d MMMM yyyy 'à' HH:mm" : "d MMMM yyyy 'at' HH:mm";
  const fmt = (v: Val) => ('t' in v ? v.t : format(new Date(v.d), v.time ? withTime : 'd MMMM yyyy', { locale: dateLocale }));

  const dayLabel = (iso: string) => {
    const d = new Date(iso);
    if (isToday(d)) return t('today');
    if (isYesterday(d)) return t('yesterday');
    return format(d, 'EEEE d MMMM yyyy', { locale: dateLocale });
  };

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const resetPage = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{t('intro')}</p>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder={t('search')}
            value={search}
            onChange={(e) => resetPage(setSearch)(e.target.value)}
          />
        </div>
        <Select value={actorId} onValueChange={resetPage(setActorId)}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('allPeople')}</SelectItem>
            {members.map((m) => (
              <SelectItem key={m.user.id} value={m.user.id}>
                {m.user.firstName} {m.user.lastName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={category} onValueChange={resetPage(setCategory)}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('allTypes')}</SelectItem>
            {(['create', 'update', 'delete', 'workflow', 'export'] as const).map((c) => (
              <SelectItem key={c} value={c}>{t(`categories.${c}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs tabular-nums text-muted-foreground">
          {data?.meta.total ?? '…'} {t('events')}
        </span>
      </div>

      {isLoading ? (
        <Skeleton className="h-80" />
      ) : !rows.length ? (
        <p className="rounded-lg border py-10 text-center text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          {rows.map((e, i) => {
            const meta = CATEGORY_META[e.category] ?? CATEGORY_META.other;
            const Icon = meta.icon;
            const expanded = open.has(e.id);
            const hasMore = e.details.length + e.changes.length + e.related.length > 0;
            const newDay = i === 0 || dayLabel(rows[i - 1].createdAt) !== dayLabel(e.createdAt);
            const sentence = e.actorName ? e.summary.charAt(0).toLowerCase() + e.summary.slice(1) : e.summary;
            const ip = e.technical.ip ? (LOCAL_IPS.has(e.technical.ip) ? t('localNetwork') : e.technical.ip) : null;
            return (
              <Fragment key={e.id}>
                {newDay && (
                  <div className="border-b bg-muted/40 px-4 py-1.5 text-xs font-medium capitalize text-muted-foreground">
                    {dayLabel(e.createdAt)}
                  </div>
                )}
                <div className={cn('border-b last:border-b-0', expanded && 'bg-muted/20')}>
                  <button
                    type="button"
                    onClick={() => toggle(e.id)}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/30"
                  >
                    <span className={cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full', meta.cls)}>
                      <Icon className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm leading-snug">
                        {e.actorName ? <span className="font-semibold">{e.actorName}</span> : null}
                        {e.actorName ? ' ' : null}
                        {sentence}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                        <span className="tabular-nums">{format(new Date(e.createdAt), 'HH:mm:ss')}</span>
                        <span>·</span>
                        <span>{formatDistanceToNow(new Date(e.createdAt), { addSuffix: true, locale: dateLocale })}</span>
                        <span>·</span>
                        <span>{t(`categories.${e.category}`)}</span>
                        {e.viaSupport && (
                          <>
                            <span>·</span>
                            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-medium text-amber-700 dark:text-amber-400">{t('viaSupport')}</span>
                          </>
                        )}
                        {e.changes.length > 0 && (
                          <>
                            <span>·</span>
                            <span>{t('fieldsChanged', { count: e.changes.length })}</span>
                          </>
                        )}
                      </span>
                    </span>
                    <ChevronDown className={cn('mt-1 size-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
                  </button>

                  {expanded && (
                    <div className="flex flex-col gap-4 px-4 pb-4 pl-14">
                      {e.changes.length > 0 && (
                        <section>
                          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('whatChanged')}</h4>
                          <div className="overflow-x-auto rounded-md border">
                            <table className="w-full text-sm">
                              <thead className="bg-muted/40 text-xs text-muted-foreground">
                                <tr>
                                  <th className="px-3 py-1.5 text-left font-medium">{t('field')}</th>
                                  <th className="px-3 py-1.5 text-left font-medium">{t('before')}</th>
                                  <th className="px-3 py-1.5 text-left font-medium">{t('after')}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {e.changes.map((c, k) => (
                                  <tr key={k} className="border-t align-top">
                                    <td className="px-3 py-1.5 font-medium">{c.label}</td>
                                    <td className="px-3 py-1.5 text-muted-foreground line-through decoration-muted-foreground/40">{fmt(c.from)}</td>
                                    <td className="px-3 py-1.5">{fmt(c.to)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </section>
                      )}

                      {e.details.length > 0 && (
                        <section>
                          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {e.category === 'delete' ? t('deletedContent') : t('recordedInfo')}
                          </h4>
                          <dl className="grid gap-x-6 gap-y-1.5 rounded-md border p-3 text-sm sm:grid-cols-[max-content_1fr]">
                            {e.details.map((d, k) => (
                              <Fragment key={k}>
                                <dt className="text-muted-foreground">{d.label}</dt>
                                <dd className="break-words">{fmt(d.value)}</dd>
                              </Fragment>
                            ))}
                          </dl>
                        </section>
                      )}

                      {e.related.length > 0 && (
                        <section>
                          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('alsoAffected')}</h4>
                          <ul className="list-inside list-disc text-sm text-muted-foreground">
                            {e.related.map((r, k) => <li key={k}>{r}</li>)}
                          </ul>
                        </section>
                      )}

                      {!hasMore && <p className="text-sm text-muted-foreground">{t('noDetails')}</p>}

                      <section className="text-xs text-muted-foreground">
                        <h4 className="mb-1 font-semibold uppercase tracking-wide">{t('context')}</h4>
                        <p>
                          {format(new Date(e.createdAt), locale === 'fr' ? "EEEE d MMMM yyyy 'à' HH:mm:ss" : "EEEE d MMMM yyyy 'at' HH:mm:ss", { locale: dateLocale })}
                          {e.technical.device && <> · {t('device')} : {e.technical.device}</>}
                          {ip && <> · {t('ip')} : {ip}</>}
                        </p>
                        <p className="mt-0.5 font-mono text-[10px] opacity-60">
                          {t('technicalRef')} : {e.technical.method} {e.technical.route}
                        </p>
                      </section>
                    </div>
                  )}
                </div>
              </Fragment>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
          <Button variant="outline" size="icon" className="size-7" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="tabular-nums">{page} / {totalPages}</span>
          <Button variant="outline" size="icon" className="size-7" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
