import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * Shared dashboard building blocks for the workshop-signage system.
 * Extracted from the main dashboard so every analytics surface renders the
 * same sign-plate stat tiles, gauges and section panels.
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
        <circle cx="22" cy="22" r={r} fill="none" stroke="var(--muted)" strokeWidth="6" />
        <circle
          cx="22"
          cy="22"
          r={r}
          fill="none"
          stroke={stroke}
          strokeWidth="6"
          strokeLinecap="butt"
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
  warn: 'text-warning-ink',
  muted: 'text-muted-foreground',
  success: 'text-success',
  destructive: 'text-destructive',
};

export function StatTile({ s, className }: { s: StatDef; className?: string }) {
  const accent = s.accent ?? 'var(--primary)';
  const Icon = s.icon;
  const inner = (
    <div
      className={cn('sign-plate relative flex h-full flex-col gap-3 p-4', s.href && 'plate-press', className)}
      style={{ '--accent': accent } as React.CSSProperties}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="plate-label min-w-0 text-[13px] leading-tight text-muted-foreground">{s.label}</p>
        {s.gauge !== undefined ? (
          <Gauge value={s.gauge} size={40} showValue={false} />
        ) : Icon ? (
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-[3px] bg-[var(--accent)] text-primary-foreground">
            <Icon className="size-[18px]" />
          </span>
        ) : null}
      </div>
      <p className="figure mt-auto text-[2.6rem]">{s.value}</p>
      {s.hint != null && s.hint !== '' && (
        <p className={cn('-mt-1 text-xs font-semibold', HINT_TONE[s.hintTone ?? 'muted'])}>{s.hint}</p>
      )}
    </div>
  );
  return s.href ? (
    <Link href={s.href} className="group block h-full rounded-[5px] focus-visible:outline-2 focus-visible:outline-ring">
      {inner}
    </Link>
  ) : (
    inner
  );
}

/** Section plate with a condensed caps header strip. */
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
    <section className={cn('sign-plate flex flex-col overflow-hidden', className)}>
      <header className="flex items-center justify-between gap-2 border-b-2 border-keyline px-4 py-2.5">
        <h2 className="plate-label flex items-center gap-2 text-[14px] text-foreground">
          {Icon && <Icon aria-hidden className="size-4" />}
          {title}
        </h2>
        {action}
      </header>
      <div className={cn('flex-1 p-4', bodyClassName)}>{children}</div>
    </section>
  );
}
