'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Server-side verification of a stored e-signature (`…Esign` / `esign` / `esignView` fields). */
export interface ESignView {
  signer: { userId: string; name: string; email: string; function: string | null } | null;
  signedAt: string | null;
  scope: string | null;
  verified: boolean;
  legacy: boolean;
  contentMatches?: boolean;
}

/** Who signed, when, in which function — and whether the signature still verifies. */
export function SignatureBadge({ view, className, compact }: { view: ESignView | null | undefined; className?: string; compact?: boolean }) {
  const t = useTranslations('esign');
  const format = useFormatter();
  if (!view) return null;
  const state = view.legacy ? 'legacy' : view.verified ? 'verified' : view.contentMatches === false ? 'modified' : 'invalid';
  const Icon = state === 'verified' ? ShieldCheck : state === 'legacy' ? ShieldQuestion : ShieldAlert;
  const tone =
    state === 'verified'
      ? 'text-success'
      : state === 'legacy'
        ? 'text-muted-foreground'
        : 'text-destructive';
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1 text-[11px]', className)}>
      <Icon className={cn('size-3.5 shrink-0', tone)} />
      <span className={cn('font-medium', tone)}>{t(`state.${state}`)}</span>
      {!compact && view.signer ? (
        <span className="text-muted-foreground">
          · {view.signer.name}
          {view.signer.function ? ` (${view.signer.function})` : ''}
          {view.signedAt ? ` · ${format.dateTime(new Date(view.signedAt), { dateStyle: 'short', timeStyle: 'short' })}` : ''}
        </span>
      ) : null}
    </span>
  );
}
