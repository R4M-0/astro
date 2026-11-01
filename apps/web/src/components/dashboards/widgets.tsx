import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

/** Horizontal count bars for a small label → count distribution. */
export function DistributionBars({
  data,
  barClassName = 'bg-chart-1',
}: {
  data: { label: string; count: number }[];
  barClassName?: string;
}) {
  const rows = data.filter((d) => d.count > 0);
  const max = Math.max(1, ...rows.map((d) => d.count));
  if (!rows.length) return <p className="text-sm text-muted-foreground">—</p>;
  return (
    <div className="flex flex-col gap-2">
      {rows.map((d) => (
        <div key={d.label} className="flex items-center gap-2">
          <span className="w-36 shrink-0 truncate text-[13px] text-foreground/80" title={d.label}>{d.label}</span>
          <div className="h-3 flex-1 overflow-hidden rounded-[2px] bg-muted">
            <div className={cn('h-full transition-[width] duration-500 ease-out', barClassName)} style={{ width: `${(d.count / max) * 100}%` }} />
          </div>
          <span className="w-7 shrink-0 text-right text-[13px] font-bold tabular-nums">{d.count}</span>
        </div>
      ))}
    </div>
  );
}

/** Clickable row of a short "needs attention" list inside a Panel. */
export function ListRow({
  href,
  reference,
  title,
  meta,
  metaTone,
  children,
}: {
  href: string;
  reference?: string;
  title: string;
  meta?: React.ReactNode;
  metaTone?: 'destructive' | 'warn';
  children?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-[3px] px-3 py-2 text-sm transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {reference && <span className="shrink-0 rounded-[2px] border border-border px-1 font-mono text-[11px] text-muted-foreground">{reference}</span>}
          <span className="truncate font-medium">{title}</span>
        </div>
        {children}
      </div>
      {meta != null && (
        <span
          className={cn(
            'shrink-0 text-xs tabular-nums text-muted-foreground',
            metaTone === 'destructive' && 'font-medium text-destructive',
            metaTone === 'warn' && 'font-semibold text-warning-ink',
          )}
        >
          {meta}
        </span>
      )}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

export function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-4 text-center text-sm text-muted-foreground">{children}</p>;
}

/** Turns a `{STATUS: count}` map into labelled rows, in the given order. */
export function toRows(
  counts: Record<string, number>,
  order: readonly string[],
  label: (key: string) => string,
): { label: string; count: number }[] {
  return order.map((k) => ({ label: label(k), count: counts[k] ?? 0 }));
}
