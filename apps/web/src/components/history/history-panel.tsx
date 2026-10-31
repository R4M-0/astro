'use client';

import { useQuery } from '@tanstack/react-query';
import { format, formatDistanceToNow } from 'date-fns';
import { enUS, fr as frLocale } from 'date-fns/locale';
import { ArrowRight, FilePlus2, PencilLine, RotateCcw, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { apiGet } from '@/lib/api';
import { cn } from '@/lib/utils';

interface HistoryEntry {
  id: string;
  operation: 'create' | 'update' | 'delete' | 'restore';
  actorId: string | null;
  actor: { id: string; firstName: string; lastName: string; avatarUrl: string | null } | null;
  changes: Record<string, { from: unknown; to: unknown }>;
  createdAt: string;
  /** extra keys some endpoints add (e.g. the document history's version scope) */
  [key: string]: unknown;
}

const OP_META: Record<string, { icon: typeof PencilLine; cls: string }> = {
  create: { icon: FilePlus2, cls: 'text-success bg-success/10' },
  update: { icon: PencilLine, cls: 'text-info bg-info/10' },
  delete: { icon: Trash2, cls: 'text-destructive bg-destructive/10' },
  restore: { icon: RotateCcw, cls: 'text-warning bg-warning/10' },
};

/** Bookkeeping columns that never mean anything to a reader. */
const ALWAYS_HIDDEN = new Set(['updatedById', 'updatedAt', 'createdAt', 'createdById']);

/** camelCase / snake_case → "Human label". */
function humanizeField(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\bId\b/gi, '')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function formatValue(value: unknown, refs: Record<string, string>): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? '✓' : '✕';
  if (Array.isArray(value)) {
    if (!value.length) return '—';
    const named = value.map((v) => (typeof v === 'string' && refs[v]) || null);
    if (named.every(Boolean)) return named.join(', ');
    return `${value.length}`;
  }
  if (typeof value === 'object') return '{…}';
  const s = String(value);
  if (refs[s]) return refs[s];
  // ISO date → short date
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return format(d, 'd MMM yyyy');
  }
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
}

export function HistoryPanel({
  entityType,
  entityId,
  className,
  fieldLabels,
  formatField,
  hiddenFields,
  fieldOrder,
  limit,
  onShowAll,
  endpoint,
  entryTag,
}: {
  entityType: string;
  entityId: string;
  className?: string;
  /** Optional localized labels per field key (falls back to a humanized key). */
  fieldLabels?: Record<string, string>;
  /** Optional per-field value formatter (e.g. enum → translated label); return undefined to fall back. */
  formatField?: (field: string, value: unknown) => string | undefined;
  /** Extra technical fields not to show (e.g. an optimistic-lock `version`). */
  hiddenFields?: string[];
  /** Fields listed first, in this order, inside each change (the rest follow alphabetically by label). */
  fieldOrder?: string[];
  /** Show only the N most recent entries (compact summary); `onShowAll` adds a "see all" link. */
  limit?: number;
  onShowAll?: () => void;
  /** Alternative endpoint returning the same `{ entries, refs }` shape (e.g. a record merged with its child rows). */
  endpoint?: string;
  /** Small label shown before an entry's sentence (e.g. which version it concerns). */
  entryTag?: (entry: HistoryEntry) => React.ReactNode;
}) {
  const t = useTranslations('history');
  const locale = useLocale();
  const dateLocale = locale === 'fr' ? frLocale : enUS;

  const { data, isLoading } = useQuery({
    queryKey: ['history', entityType, entityId, endpoint ?? null],
    queryFn: () =>
      apiGet<{ entries: HistoryEntry[]; refs: Record<string, string> }>(
        endpoint ?? `/history/${entityType}/${entityId}`,
      ),
    enabled: !!entityId,
  });

  const refs = data?.refs ?? {};
  const hidden = new Set([...ALWAYS_HIDDEN, ...(hiddenFields ?? [])]);
  const labelOf = (k: string) => fieldLabels?.[k] ?? humanizeField(k);
  const rank = (k: string) => {
    const i = fieldOrder?.indexOf(k) ?? -1;
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const visibleKeys = (e: HistoryEntry) =>
    Object.keys(e.changes ?? {})
      .filter((k) => !hidden.has(k))
      .sort((a, b) => rank(a) - rank(b) || labelOf(a).localeCompare(labelOf(b), locale));
  // An update that only touched hidden bookkeeping fields says nothing to the reader.
  const all = (data?.entries ?? []).filter((e) => e.operation !== 'update' || visibleKeys(e).length > 0);
  const entries = limit ? all.slice(0, limit) : all;

  if (isLoading) return <p className="p-4 text-center text-sm text-muted-foreground">…</p>;
  if (!entries.length)
    return <p className="p-4 text-center text-sm text-muted-foreground">{t('empty')}</p>;

  const show = (k: string, v: unknown) =>
    (v !== null && v !== undefined && v !== '' && formatField?.(k, v)) || formatValue(v, refs);

  return (
    <div className={cn('flex flex-col', className)}>
      <ol className="relative flex flex-col">
        {entries.map((e, i) => {
          const meta = OP_META[e.operation] ?? OP_META.update;
          const Icon = meta.icon;
          const actorName = e.actor ? `${e.actor.firstName} ${e.actor.lastName}`.trim() : t('system');
          const keys = e.operation === 'update' ? visibleKeys(e) : [];
          const when = new Date(e.createdAt);
          return (
            <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
              {i < entries.length - 1 && <span aria-hidden className="absolute top-7 bottom-0 left-3 w-px bg-border" />}
              <span className={cn('relative mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full', meta.cls)}>
                <Icon className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <p className="text-sm leading-tight">
                    {entryTag?.(e)}
                    <span className="font-medium">{actorName}</span>{' '}
                    <span className="text-muted-foreground">
                      {e.operation === 'update' ? t('changedFields', { count: keys.length }) : t(`op.${e.operation}`)}
                    </span>
                  </p>
                  <time
                    dateTime={e.createdAt}
                    title={format(when, 'PPPPp', { locale: dateLocale })}
                    className="shrink-0 text-xs text-muted-foreground"
                  >
                    {format(when, 'd MMM yyyy · HH:mm', { locale: dateLocale })}
                    <span className="text-muted-foreground/60"> · {formatDistanceToNow(when, { addSuffix: true, locale: dateLocale })}</span>
                  </time>
                </div>
                {keys.length > 0 && (
                  <dl className="mt-2 divide-y rounded-md border bg-muted/20 text-xs">
                    {keys.map((k) => (
                      <div key={k} className="grid gap-1 px-3 py-1.5 sm:grid-cols-[minmax(8rem,12rem)_1fr] sm:gap-3">
                        <dt className="font-medium text-foreground/80">{labelOf(k)}</dt>
                        <dd className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <span className="text-muted-foreground line-through decoration-muted-foreground/50">{show(k, e.changes[k].from)}</span>
                          <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
                          <span className="font-medium text-foreground">{show(k, e.changes[k].to)}</span>
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {limit && onShowAll && all.length > 0 && (
        <Button variant="ghost" size="sm" className="mt-3 self-start" onClick={onShowAll}>
          {t('showAll', { count: all.length })} <ArrowRight className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
