import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * Shared dashboard building blocks for the refined-enterprise system.
 * Extracted from the main dashboard so every analytics surface renders the
 * same premium stat tiles, radial gauges and section panels.
 */

export function toneVar(score: number | null): string {
  if (score === null) return 'var(--muted-foreground)';
  if (score >= 75) return 'var(--success)';
  if (score >= 50) return 'var(--warning)';
  return 'var(--destructive)';
}

/** Compact radial gauge driven by a real 0–100 value. */
export function Gauge({
  value,
  size = 48,
  showValue = true,
}: {
  value: number | null;
  size?: number;
  showValue?: boolean;
}) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  const r = 18;
  const circ = 2 * Math.PI * r;
  const stroke = toneVar(value);
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 44 44" className="-rotate-90" style={{ width: size, height: size }}>
        <circle cx="22" cy="22" r={r} fill="none" stroke="var(--muted)" strokeWidth="5" />
        <circle
          cx="22"
          cy="22"
          r={r}
          fill="none"
          stroke={stroke}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - v / 100)}
          style={{ transition: 'stroke-dashoffset 0.6s var(--ease-out)' }}
        />
      </svg>
      {showValue && (
        <span className="absolute text-[11px] font-semibold tabular-nums">
          {value === null ? '—' : value}
        </span>
      )}
    </div>
  );
}

export interface StatDef {
  label: string;
  value: React.ReactNode;
  icon?: React.ElementType;
  href?: string;
  /** accent colour (any CSS colour / oklch). Defaults to the brand primary. */
  accent?: string;
  hint?: React.ReactNode;
  hintTone?: 'warn' | 'muted' | 'success' | 'destructive';
  /** render a radial gauge (0–100) instead of the icon well. */
  gauge?: number | null;
}

const HINT_TONE: Record<NonNullable<StatDef['hintTone']>, string> = {
  warn: 'text-warning-foreground dark:text-warning',
  muted: 'text-muted-foreground',
  success: 'text-success',
  destructive: 'text-destructive',
};

export function StatTile({ s, className }: { s: StatDef; className?: string }) {
  const accent = s.accent ?? 'var(--primary)';
  const Icon = s.icon;
  const inner = (
    <Card
      className={cn('hover-lift relative gap-0 overflow-hidden py-0', className)}
      style={{ '--accent': accent } as React.CSSProperties}
    >
      <span className="absolute inset-y-0 left-0 w-1 bg-[var(--accent)] opacity-70" />
      <CardContent className="flex items-start justify-between gap-3 p-5 pl-6">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-muted-foreground">{s.label}</p>
          <p className="mt-1.5 text-[2rem] font-semibold leading-none tracking-tight tabular-nums">
            {s.value}
          </p>
          {s.hint != null && s.hint !== '' && (
            <p className={cn('mt-2 text-xs font-medium', HINT_TONE[s.hintTone ?? 'muted'])}>
              {s.hint}
            </p>
          )}
        </div>
        {s.gauge !== undefined ? (
          <Gauge value={s.gauge} />
        ) : Icon ? (
          <div className="rounded-xl bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] p-2.5 text-[var(--accent)] ring-1 ring-[color-mix(in_oklab,var(--accent)_22%,transparent)] ring-inset transition-transform duration-200 group-hover:scale-105">
            <Icon className="size-5" />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
  return s.href ? (
    <Link href={s.href} className="group block h-full">
      {inner}
    </Link>
  ) : (
    inner
  );
}

/** Section card with a consistent, quiet uppercase header + divider. */
export function Panel({
  title,
  icon: Icon,
  action,
  className,
  bodyClassName,
  children,
}: {
  title: React.ReactNode;
  icon?: React.ElementType;
  action?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={cn('gap-0 py-0', className)}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 border-b px-5 py-3.5">
        <CardTitle className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
          {Icon && <Icon className="size-4 text-muted-foreground/80" />}
          {title}
        </CardTitle>
        {action}
      </CardHeader>
      <CardContent className={cn('p-5', bodyClassName)}>{children}</CardContent>
    </Card>
  );
}
