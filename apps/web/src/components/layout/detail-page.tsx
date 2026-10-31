'use client';

import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Full-page shell for any record's detail view (the app has no side drawers for viewing):
 * back-link to the register, header (reference chip + title + badges + actions), then content.
 */
export function DetailPage({
  backHref,
  backLabel,
  reference,
  title,
  subtitle,
  badges,
  actions,
  loading,
  children,
  className,
}: {
  backHref: string;
  backLabel: string;
  reference?: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  badges?: React.ReactNode;
  actions?: React.ReactNode;
  loading?: boolean;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mx-auto flex w-full max-w-[1400px] flex-col gap-5 p-4 pb-10 sm:p-6', className)}>
      <Link
        href={backHref}
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> {backLabel}
      </Link>
      {loading ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-48" />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {reference && (
                  <span className="rounded border bg-muted/50 px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                    {reference}
                  </span>
                )}
                {badges}
              </div>
              {title && (
                <h1 className="mt-2 text-2xl font-semibold leading-tight tracking-tight text-balance">{title}</h1>
              )}
              {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
            </div>
            {actions && <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{actions}</div>}
          </div>
          {children}
        </>
      )}
    </div>
  );
}
