'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

export type Severity = 'alert' | 'warn' | 'todo' | 'info' | 'ok';

/**
 * ISO 7010-style sign glyph: the shape carries the meaning before the colour does —
 * triangle = warning (red when overdue), circle = mandatory / to do, square = information / safe.
 */
export function SignGlyph({ severity, className }: { severity: Severity; className?: string }) {
  const cls = cn('size-7 shrink-0', className);
  switch (severity) {
    case 'alert':
    case 'warn': {
      const fill = severity === 'alert' ? 'var(--destructive)' : 'var(--warning)';
      const mark = severity === 'alert' ? 'var(--destructive-foreground)' : 'var(--warning-foreground)';
      return (
        <svg viewBox="0 0 28 28" aria-hidden className={cls}>
          <path d="M14 2.5 26.5 25H1.5Z" fill={fill} stroke="var(--keyline)" strokeWidth="2" strokeLinejoin="round" />
          <rect x="12.6" y="9.5" width="2.8" height="8" fill={mark} />
          <rect x="12.6" y="19.4" width="2.8" height="2.8" fill={mark} />
        </svg>
      );
    }
    case 'todo':
      return (
        <svg viewBox="0 0 28 28" aria-hidden className={cls}>
          <circle cx="14" cy="14" r="12" fill="var(--primary)" stroke="var(--keyline)" strokeWidth="2" />
          <rect x="12.6" y="11.5" width="2.8" height="9" fill="var(--primary-foreground)" />
          <rect x="12.6" y="6.8" width="2.8" height="2.8" fill="var(--primary-foreground)" />
        </svg>
      );
    case 'ok':
      return (
        <svg viewBox="0 0 28 28" aria-hidden className={cls}>
          <rect x="2" y="2" width="24" height="24" rx="2" fill="var(--success)" stroke="var(--keyline)" strokeWidth="2" />
          <path d="m8 14.5 4 4 8-9" fill="none" stroke="var(--success-foreground)" strokeWidth="3" strokeLinecap="square" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 28 28" aria-hidden className={cls}>
          <rect x="2" y="2" width="24" height="24" rx="2" fill="var(--card)" stroke="var(--keyline)" strokeWidth="2" />
          <rect x="12.6" y="11.5" width="2.8" height="9" fill="var(--foreground)" />
          <rect x="12.6" y="6.8" width="2.8" height="2.8" fill="var(--foreground)" />
        </svg>
      );
  }
}

export interface AttentionItem {
  id: string;
  severity: Severity;
  title: string;
  meta?: string;
  detail?: string;
  href: string;
}

// ---- "lit until seen": attention rows keep a lamp on until the user opens them -------------
const SEEN_KEY = 'astro.dashboard.seen';
const seenListeners = new Set<() => void>();
let seenCache: string | null = null;
function readSeen(): string {
  if (seenCache !== null) return seenCache;
  try {
    seenCache = localStorage.getItem(SEEN_KEY) ?? '[]';
  } catch {
    seenCache = '[]';
  }
  return seenCache;
}
export function markSeen(id: string) {
  const list: string[] = JSON.parse(readSeen());
  if (list.includes(id)) return;
  // keep the list bounded: oldest ids fall off
  const next = JSON.stringify([...list, id].slice(-200));
  seenCache = next;
  try {
    localStorage.setItem(SEEN_KEY, next);
  } catch {
    /* in-memory only */
  }
  seenListeners.forEach((l) => l());
}
const subscribeSeen = (l: () => void) => {
  seenListeners.add(l);
  return () => seenListeners.delete(l);
};

const SEVERITY_ROW: Record<Severity, string> = {
  alert: 'text-destructive',
  warn: 'text-warning-ink',
  todo: 'text-primary',
  info: 'text-muted-foreground',
  ok: 'text-success',
};

/** The board of what needs action, most severe first; a hazard band underlines it while anything is pending. */
export function AttentionBoard({ items, className }: { items: AttentionItem[]; className?: string }) {
  const t = useTranslations('dashboard');
  const seenRaw = useSyncExternalStore(subscribeSeen, readSeen, () => null);
  const seen = new Set<string>(seenRaw ? JSON.parse(seenRaw) : []);
  const pending = items.some((i) => i.severity === 'alert' || i.severity === 'warn');
  const onOpen = useCallback((id: string) => markSeen(id), []);

  return (
    <section aria-labelledby="attention-title" className={cn('sign-plate flex flex-col overflow-hidden', className)}>
      <header className="flex items-center justify-between gap-3 border-b-2 border-keyline bg-foreground px-4 py-2.5 text-background">
        <h2 id="attention-title" className="plate-label text-[17px] tracking-[0.06em]">
          {t('attentionTitle')}
        </h2>
        {items.length > 0 && (
          <span className="rounded-[3px] bg-warning px-2 py-0.5 text-xs font-bold tabular-nums text-warning-foreground">
            {t('attentionCount', { count: items.length })}
          </span>
        )}
      </header>

      {items.length === 0 ? (
        <div className="flex flex-1 items-center gap-4 px-5 py-8">
          <SignGlyph severity="ok" className="size-12" />
          <div>
            <p className="text-lg font-bold">{t('allClear')}</p>
            <p className="text-sm text-muted-foreground">{t('allClearHint')}</p>
          </div>
        </div>
      ) : (
        <ul className="flex-1 divide-y divide-border">
          {items.map((item) => {
            const lit = seenRaw !== null && !seen.has(item.id) && (item.severity === 'alert' || item.severity === 'warn');
            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  onClick={() => onOpen(item.id)}
                  className="group flex items-center gap-3.5 px-4 py-3 transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                >
                  <span className={cn('rounded-full', lit && 'lamp-lit')}>
                    <SignGlyph severity={item.severity} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start gap-2 sm:items-center">
                      <span className="line-clamp-2 font-semibold sm:truncate">{item.title}</span>
                      {lit && (
                        <span className="plate-label shrink-0 rounded-[2px] bg-warning px-1 text-[10px] text-warning-foreground">
                          {t('unseen')}
                        </span>
                      )}
                    </span>
                    {item.detail && <span className="block truncate text-[13px] text-muted-foreground">{item.detail}</span>}
                  </span>
                  <span className="hidden shrink-0 text-right sm:block">
                    <span className={cn('plate-label block text-[11px]', SEVERITY_ROW[item.severity])}>
                      {t(`severity.${item.severity}`)}
                    </span>
                    {item.meta && <span className="block text-[13px] font-semibold tabular-nums">{item.meta}</span>}
                  </span>
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <div aria-hidden className={cn('h-2.5 shrink-0 border-t-2 border-keyline', pending ? 'hazard' : 'bg-success')} />
    </section>
  );
}
