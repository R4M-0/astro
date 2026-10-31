import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Container({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn('mx-auto w-full max-w-[90rem] px-4 sm:px-6 lg:px-10', className)}>{children}</div>;
}

export function Section({
  children,
  className,
  muted,
  navy,
  rule = true,
  id,
}: {
  children: ReactNode;
  className?: string;
  muted?: boolean;
  /** Deep-navy band (dark tokens) with soft blue glows — use sparingly for rhythm. */
  navy?: boolean;
  /** Hairline rule above the section (the default marketing rhythm). */
  rule?: boolean;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        'relative py-16 sm:py-24',
        rule && !navy && 'border-t',
        muted && 'bg-muted/60',
        navy && 'marketing-navy dark isolate overflow-hidden bg-background text-foreground',
        className,
      )}
    >
      {navy && (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute -left-40 -top-64 -z-10 size-[44rem] rounded-full bg-[radial-gradient(closest-side,oklch(0.55_0.2_258/0.55),transparent)]"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-72 -right-32 -z-10 size-[40rem] rounded-full bg-[radial-gradient(closest-side,oklch(0.65_0.13_200/0.28),transparent)]"
          />
        </>
      )}
      <Container>{children}</Container>
    </section>
  );
}

/** Small-caps label with a short leading rule — replaces the pill badge. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground',
        className,
      )}
    >
      <span aria-hidden className="h-px w-5 bg-primary" />
      {children}
    </span>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  align = 'left',
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  align?: 'center' | 'left';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-4',
        align === 'center' ? 'mx-auto max-w-3xl text-center' : 'max-w-3xl',
        className,
      )}
    >
      {eyebrow ? <div className={align === 'center' ? 'mx-auto' : ''}>{eyebrow}</div> : null}
      <h2 className="text-balance text-3xl font-semibold leading-[1.1] tracking-[-0.02em] text-foreground sm:text-4xl">
        {title}
      </h2>
      {subtitle ? (
        <p className="text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}
