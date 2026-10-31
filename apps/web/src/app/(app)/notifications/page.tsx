'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  BellDot,
  CheckCheck,
  GraduationCap,
  MailOpen,
  MessageSquareText,
  Search,
  Settings2,
  Trash2,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { format, formatDistanceToNow, isToday, isYesterday } from 'date-fns';
import { enUS, fr as frLocale } from 'date-fns/locale';
import { toast } from 'sonner';
import { EmptyState } from '@/components/layout/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiDelete, apiGet, apiPatch } from '@/lib/api';
import { cn } from '@/lib/utils';

const ALL = '__all__';
const PAGE_SIZE = 30;

type Category = 'people' | 'trainings' | 'surveys' | 'system' | 'other';

const CATEGORIES: { key: Category; icon: LucideIcon; tone: string }[] = [
  { key: 'people', icon: Users, tone: 'bg-violet-500/10 text-violet-600 dark:text-violet-400' },
  { key: 'trainings', icon: GraduationCap, tone: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  { key: 'surveys', icon: MessageSquareText, tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  { key: 'system', icon: Settings2, tone: 'bg-slate-500/10 text-slate-600 dark:text-slate-400' },
  { key: 'other', icon: Bell, tone: 'bg-muted text-muted-foreground' },
];
const CATEGORY_META = Object.fromEntries(CATEGORIES.map((c) => [c.key, c])) as Record<
  Category,
  (typeof CATEGORIES)[number]
>;

interface NotificationRow {
  id: string;
  type: string;
  category: Category;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

interface NotificationPage {
  data: NotificationRow[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
  counts: {
    total: number;
    unread: number;
    categories: Partial<Record<Category, { total: number; unread: number }>>;
  };
}

type Status = 'all' | 'unread' | 'read';

export default function NotificationsPage() {
  const t = useTranslations('notificationsPage');
  const tc = useTranslations('common');
  const locale = useLocale();
  const dateLocale = locale === 'fr' ? frLocale : enUS;
  const router = useRouter();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<Status>('all');
  const [category, setCategory] = useState<string>(ALL);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const id = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), status });
  if (category !== ALL) params.set('category', category);
  if (debounced) params.set('search', debounced);

  // under ['notifications'] so realtime pushes and the topbar bell keep it fresh
  const { data, isLoading } = useQuery({
    queryKey: ['notifications', 'page', status, category, debounced, page],
    queryFn: () => apiGet<NotificationPage>(`/notifications/page?${params}`),
    placeholderData: (prev) => prev,
  });

  // deleting the last rows of the last page: fall back to the new last page
  useEffect(() => {
    if (data && page > data.meta.totalPages) setPage(data.meta.totalPages);
  }, [data, page]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });
  const setRead = useMutation({
    mutationFn: ({ id, read }: { id: string; read: boolean }) =>
      apiPatch(`/notifications/${id}/${read ? 'read' : 'unread'}`),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/notifications/${id}`),
    onSuccess: invalidate,
  });
  const markAllRead = useMutation({
    mutationFn: () => apiPatch('/notifications/read-all'),
    onSuccess: invalidate,
  });
  const clearRead = useMutation({
    mutationFn: () => apiDelete<{ deleted: number }>('/notifications/read'),
    onSuccess: (res) => {
      toast.success(t('clearedToast', { count: res.deleted }));
      if (status === 'read') setPage(1);
      invalidate();
    },
  });

  const open = (n: NotificationRow) => {
    if (!n.readAt) setRead.mutate({ id: n.id, read: true });
    if (n.link) router.push(n.link);
  };

  const groups = useMemo(() => {
    const out: { label: string; items: NotificationRow[] }[] = [];
    for (const n of data?.data ?? []) {
      const d = new Date(n.createdAt);
      const label = isToday(d)
        ? t('today')
        : isYesterday(d)
          ? t('yesterday')
          : format(d, 'EEEE d MMMM yyyy', { locale: dateLocale });
      const last = out[out.length - 1];
      if (last?.label === label) last.items.push(n);
      else out.push({ label, items: [n] });
    }
    return out;
  }, [data, t, dateLocale]);

  const counts = data?.counts;
  const readCount = counts ? counts.total - counts.unread : 0;
  const filtered = status !== 'all' || category !== ALL || !!debounced;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4 sm:p-6">
      <PageHeader
        title={t('title')}
        description={t('desc')}
        actions={
          <>
            {!!counts?.unread && (
              <Button size="sm" variant="outline" disabled={markAllRead.isPending} onClick={() => markAllRead.mutate()}>
                <CheckCheck className="size-4" /> {tc('markAllRead')}
              </Button>
            )}
            {readCount > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={clearRead.isPending}
                onClick={() => {
                  if (confirm(t('clearReadConfirm', { count: readCount }))) clearRead.mutate();
                }}
              >
                <Trash2 className="size-4" /> {t('clearRead')}
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          value={status}
          onValueChange={(v) => {
            setStatus(v as Status);
            setPage(1);
          }}
        >
          <TabsList>
            <TabsTrigger value="all">
              {t('status.all')} <Count n={counts?.total} />
            </TabsTrigger>
            <TabsTrigger value="unread">
              {t('status.unread')} <Count n={counts?.unread} />
            </TabsTrigger>
            <TabsTrigger value="read">
              {t('status.read')} <Count n={counts ? readCount : undefined} />
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Select
          value={category}
          onValueChange={(v) => {
            setCategory(v);
            setPage(1);
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('allCategories')}</SelectItem>
            {CATEGORIES.filter((c) => counts?.categories[c.key]?.total || c.key === category).map((c) => (
              <SelectItem key={c.key} value={c.key}>
                {t(`categories.${c.key}`)}
                <span className="ml-1 text-muted-foreground">
                  {counts?.categories[c.key]?.unread
                    ? t('unreadOf', {
                        unread: counts.categories[c.key]!.unread,
                        total: counts.categories[c.key]!.total,
                      })
                    : `(${counts?.categories[c.key]?.total ?? 0})`}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative w-full sm:ml-auto sm:w-64">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-8 pl-8"
            placeholder={t('search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {isLoading && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}

      {data && !data.data.length && (
        <EmptyState
          icon={filtered ? Search : Bell}
          title={filtered ? t('emptyFiltered') : tc('noNotifications')}
          description={filtered ? undefined : t('emptyDesc')}
        />
      )}

      {groups.map((g) => (
        <section key={g.label} className="flex flex-col gap-1.5">
          <h2 className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground first-letter:uppercase">
            {g.label}
          </h2>
          <div className="overflow-hidden rounded-xl border bg-card">
            {g.items.map((n) => {
              const meta = CATEGORY_META[n.category] ?? CATEGORY_META.other;
              const Icon = meta.icon;
              const unread = !n.readAt;
              return (
                <div
                  key={n.id}
                  className={cn(
                    'group relative flex items-start gap-3 border-b px-4 py-3 last:border-0 transition-colors hover:bg-accent/50',
                    unread && 'bg-primary/5',
                  )}
                >
                  {unread && (
                    <span className="absolute left-1.5 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-primary" aria-hidden />
                  )}
                  <span className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg', meta.tone)}>
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <button
                    type="button"
                    onClick={() => open(n)}
                    className={cn(
                      'flex min-w-0 flex-1 flex-col gap-0.5 text-left focus-visible:outline-none',
                      n.link ? 'cursor-pointer' : 'cursor-default',
                    )}
                  >
                    <span className={cn('text-sm', unread ? 'font-semibold' : 'font-medium')}>{n.title}</span>
                    {n.body && <span className="text-sm text-muted-foreground">{n.body}</span>}
                    <span className="text-xs text-muted-foreground/80">
                      {t(`categories.${n.category}`)} ·{' '}
                      <time dateTime={n.createdAt} title={format(new Date(n.createdAt), 'Pp', { locale: dateLocale })}>
                        {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true, locale: dateLocale })}
                      </time>
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      title={unread ? t('markRead') : t('markUnread')}
                      aria-label={unread ? t('markRead') : t('markUnread')}
                      onClick={() => setRead.mutate({ id: n.id, read: unread })}
                    >
                      {unread ? <MailOpen className="size-3.5" /> : <BellDot className="size-3.5" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground hover:text-destructive"
                      title={tc('delete')}
                      aria-label={tc('delete')}
                      onClick={() => remove.mutate(n.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {data && data.meta.totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            {tc('previous')}
          </Button>
          <span>
            {page} / {data.meta.totalPages}
          </span>
          <Button size="sm" variant="outline" disabled={page >= data.meta.totalPages} onClick={() => setPage(page + 1)}>
            {tc('next')}
          </Button>
        </div>
      )}
    </div>
  );
}

function Count({ n }: { n?: number }) {
  if (n === undefined) return null;
  return <span className="ml-1 text-xs tabular-nums text-muted-foreground">{n}</span>;
}
