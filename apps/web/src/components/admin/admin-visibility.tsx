'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Eye, Lock, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, apiGet, apiPut } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useHasPermission } from '@/stores/session';

type Mode = 'organization' | 'process' | 'members';

interface RegisterRow {
  model: string;
  resource: string;
  group: string;
  modes: Mode[];
  default: Mode;
  mode: Mode;
  children: string[];
}

const MODE_ICON: Record<Mode, typeof Eye> = { organization: Building2, process: Users, members: Lock };
const GROUP_ORDER = ['hr'];

/**
 * Admin → Visibilité: per register, who sees its records — the whole organization, members of the
 * record's process (for roles limited to their process), or only the people on the record + invited ones.
 */
export function AdminVisibility() {
  const t = useTranslations('admin.visibility');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const canEdit = useHasPermission()('organization:update');

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'visibility'],
    queryFn: () => apiGet<RegisterRow[]>('/visibility'),
  });
  const save = useMutation({
    mutationFn: (policy: Record<string, Mode>) => apiPut<RegisterRow[]>('/visibility', { policy }),
    onSuccess: (rows) => {
      qc.setQueryData(['admin', 'visibility'], rows);
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'admin' }); // every list may change
      toast.success(t('saved'));
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : tc('error')),
  });

  if (isLoading) return <Skeleton className="h-96" />;
  const rows = data ?? [];
  const groups = GROUP_ORDER.filter((g) => rows.some((r) => r.group === g));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {(['organization', 'process', 'members'] as const).map((m) => {
          const Icon = MODE_ICON[m];
          return (
            <div key={m} className="flex gap-3 rounded-lg border bg-card p-3">
              <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-medium">{t(`modes.${m}`)}</p>
                <p className="text-xs text-muted-foreground">{t(`modeHints.${m}`)}</p>
              </div>
            </div>
          );
        })}
      </div>

      {groups.map((g) => (
        <div key={g} className="overflow-hidden rounded-lg border">
          <div className="border-b bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t(`groups.${g}`)}
          </div>
          <ul className="divide-y">
            {rows.filter((r) => r.group === g).map((r) => (
              <li key={r.model} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{t(`registers.${r.model}`)}</p>
                  {r.children.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {t('children', { list: r.children.map((c) => t(`registers.${c}`)).join(', ') })}
                    </p>
                  )}
                </div>
                <div role="radiogroup" aria-label={t(`registers.${r.model}`)} className="inline-flex rounded-md border p-0.5">
                  {(['organization', 'process', 'members'] as const).map((m) => {
                    const allowed = r.modes.includes(m);
                    const active = r.mode === m;
                    const Icon = MODE_ICON[m];
                    return (
                      <button
                        key={m}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        disabled={!canEdit || !allowed || save.isPending}
                        title={allowed ? t(`modeHints.${m}`) : t('notAvailable')}
                        onClick={() => !active && save.mutate({ [r.model]: m })}
                        className={cn(
                          'flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors',
                          active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                          !allowed && 'cursor-not-allowed opacity-35 hover:bg-transparent',
                        )}
                      >
                        <Icon className="size-3.5" />
                        {t(`modes.${m}`)}
                        {r.default === m && !active && <span className="text-[9px] opacity-60">({t('default')})</span>}
                      </button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">{t('footer')}</p>
    </div>
  );
}
